-- Guess Who multiplayer schema.
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- Safe to run once on a fresh project.
--
-- Security model:
--   * Every visitor signs in anonymously (no email/password), so each phone has a user id.
--   * Players can READ only the rooms they belong to (row level security).
--   * Each player can read ONLY their own secret character until the game ends.
--   * All writes go through the functions below, which enforce turns and rules.
--     There are no insert/update/delete policies, so the browser cannot cheat
--     by writing to the tables directly.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table public.rooms (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  host_id      uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  phase        text not null default 'ask' check (phase in ('ask', 'answer')),
  board_ids    text[] not null,
  deck         text not null default 'famous' check (deck in ('famous', 'random')),
  round        int  not null default 1,
  current_turn uuid,
  winner_id    uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.room_players (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  name      text not null check (char_length(name) between 1 and 30),
  seat      smallint not null check (seat in (1, 2)),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);

create table public.room_secrets (
  room_id      uuid not null references public.rooms(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  character_id text not null,
  primary key (room_id, user_id)
);

create table public.room_events (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  round      int  not null,
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null check (kind in ('question', 'answer', 'guess', 'system')),
  body       text not null check (char_length(body) between 1 and 200),
  correct    boolean,
  created_at timestamptz not null default now()
);

create index room_events_room_round_idx on public.room_events (room_id, round, id);
create index room_players_user_idx on public.room_players (user_id);

------------------------------------------------------------------------------
-- Row level security (read access only)
------------------------------------------------------------------------------

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

alter table public.rooms        enable row level security;
alter table public.room_players enable row level security;
alter table public.room_secrets enable row level security;
alter table public.room_events  enable row level security;

create policy "members can read their rooms"
  on public.rooms for select to authenticated
  using (public.is_room_member(id));

create policy "members can read players in their rooms"
  on public.room_players for select to authenticated
  using (public.is_room_member(room_id));

create policy "members can read events in their rooms"
  on public.room_events for select to authenticated
  using (public.is_room_member(room_id));

create policy "own secret, or every secret once the game is over"
  on public.room_secrets for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.rooms r
      where r.id = room_id and r.status = 'finished' and public.is_room_member(r.id)
    )
  );

------------------------------------------------------------------------------
-- Internal helpers (not callable from the browser)
------------------------------------------------------------------------------

create or replace function public._validate_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 30 then
    raise exception 'Your name must be 1–30 characters long.';
  end if;
  return v_name;
end;
$$;

create or replace function public._validate_board(p_board_ids text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_len int := coalesce(array_length(p_board_ids, 1), 0);
begin
  if v_len not between 12 and 80 then
    raise exception 'A board must have between 12 and 80 characters.';
  end if;
  if (select count(distinct x) from unnest(p_board_ids) as x) <> v_len then
    raise exception 'The board contains duplicate characters.';
  end if;
end;
$$;

-- Deal secrets and start a round. Called when the second player joins and on rematch.
create or replace function public._deal_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board text[];
  v_round int;
begin
  select board_ids, round into v_board, v_round from public.rooms where id = p_room_id;

  delete from public.room_secrets where room_id = p_room_id;

  -- Two different random characters from the shared board, one per player.
  insert into public.room_secrets (room_id, user_id, character_id)
  select p_room_id, pl.user_id, pk.character_id
  from (
    select user_id, row_number() over (order by seat) as rn
    from public.room_players where room_id = p_room_id
  ) as pl
  join (
    select character_id, row_number() over () as rn
    from (select unnest(v_board) as character_id order by random() limit 2) as shuffled
  ) as pk using (rn);

  update public.rooms
  set status = 'playing',
      phase = 'ask',
      winner_id = null,
      current_turn = (select user_id from public.room_players where room_id = p_room_id order by random() limit 1),
      updated_at = now()
  where id = p_room_id;

  insert into public.room_events (room_id, round, kind, body)
  values (p_room_id, v_round, 'system', 'Round ' || v_round || ' started. Good luck!');
end;
$$;

------------------------------------------------------------------------------
-- Game actions (called from the browser with supabase.rpc)
------------------------------------------------------------------------------

-- Create a room. Returns the new room id.
-- p_deck is 'famous' (curated list) or 'random' (big pool); rematches reuse it.
-- p_code is optional (e.g. 'LOVE2026'); a random 6-character code is used otherwise.
-- A custom code that belongs to a room older than 12 hours is recycled.
create or replace function public.create_room(
  p_name text,
  p_board_ids text[],
  p_code text default null,
  p_deck text default 'famous'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_name     text;
  v_code     text;
  v_deck     text := coalesce(p_deck, 'famous');
  v_room_id  uuid;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then raise exception 'You are not signed in.'; end if;
  v_name := public._validate_name(p_name);
  perform public._validate_board(p_board_ids);
  if v_deck not in ('famous', 'random') then raise exception 'Unknown actor pool.'; end if;

  if p_code is not null and btrim(p_code) <> '' then
    v_code := upper(btrim(p_code));
    if v_code !~ '^[A-Z0-9]{4,12}$' then
      raise exception 'Room codes must be 4–12 letters or digits.';
    end if;
    delete from public.rooms where code = v_code and created_at < now() - interval '12 hours';
    if exists (select 1 from public.rooms where code = v_code) then
      raise exception 'Room code % is already in use. Try another one.', v_code;
    end if;
  else
    loop
      v_code := '';
      for i in 1..6 loop
        v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
      end loop;
      exit when not exists (select 1 from public.rooms where code = v_code);
    end loop;
  end if;

  insert into public.rooms (code, host_id, board_ids, deck)
  values (v_code, v_uid, p_board_ids, v_deck)
  returning id into v_room_id;

  insert into public.room_players (room_id, user_id, name, seat)
  values (v_room_id, v_uid, v_name, 1);

  return v_room_id;
end;
$$;

-- Join a room by code. Returns the room id. Re-joining a room you are already in is allowed.
create or replace function public.join_room(p_code text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_room public.rooms%rowtype;
begin
  if v_uid is null then raise exception 'You are not signed in.'; end if;

  select * into v_room from public.rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then
    raise exception 'There is no room with code %.', upper(btrim(coalesce(p_code, '')));
  end if;

  if exists (select 1 from public.room_players where room_id = v_room.id and user_id = v_uid) then
    return v_room.id;
  end if;

  if v_room.status <> 'waiting' then
    raise exception 'This room already has two players.';
  end if;

  v_name := public._validate_name(p_name);
  insert into public.room_players (room_id, user_id, name, seat)
  values (v_room.id, v_uid, v_name, 2);

  perform public._deal_round(v_room.id);
  return v_room.id;
end;
$$;

-- Ask a yes/no question. Only the player whose turn it is can ask.
create or replace function public.ask_question(p_room_id uuid, p_question text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_text text := btrim(coalesce(p_question, ''));
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not public.is_room_member(p_room_id) then raise exception 'Room not found.'; end if;
  if v_room.status <> 'playing' then raise exception 'The game is not in progress.'; end if;
  if v_room.current_turn <> v_uid or v_room.phase <> 'ask' then raise exception 'It is not your turn to ask.'; end if;
  if char_length(v_text) not between 1 and 200 then raise exception 'Questions must be 1–200 characters.'; end if;

  insert into public.room_events (room_id, round, user_id, kind, body)
  values (p_room_id, v_room.round, v_uid, 'question', v_text);

  update public.rooms set phase = 'answer', updated_at = now() where id = p_room_id;
end;
$$;

-- Answer the pending question ('yes', 'no' or 'unsure'). The answerer asks next.
create or replace function public.answer_question(p_room_id uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_body text;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not public.is_room_member(p_room_id) then raise exception 'Room not found.'; end if;
  if v_room.status <> 'playing' then raise exception 'The game is not in progress.'; end if;
  if v_room.phase <> 'answer' or v_room.current_turn = v_uid then raise exception 'There is no question for you to answer.'; end if;

  v_body := case lower(p_answer)
    when 'yes' then 'Yes'
    when 'no' then 'No'
    when 'unsure' then 'Not sure'
    else null
  end;
  if v_body is null then raise exception 'Answer must be yes, no or unsure.'; end if;

  insert into public.room_events (room_id, round, user_id, kind, body)
  values (p_room_id, v_room.round, v_uid, 'answer', v_body);

  update public.rooms set phase = 'ask', current_turn = v_uid, updated_at = now() where id = p_room_id;
end;
$$;

-- Guess the opponent's secret character on your turn. Returns true if correct.
-- A wrong guess passes the turn to the opponent.
create or replace function public.make_guess(p_room_id uuid, p_character_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_room     public.rooms%rowtype;
  v_opponent uuid;
  v_secret   text;
  v_correct  boolean;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not public.is_room_member(p_room_id) then raise exception 'Room not found.'; end if;
  if v_room.status <> 'playing' then raise exception 'The game is not in progress.'; end if;
  if v_room.current_turn <> v_uid or v_room.phase <> 'ask' then raise exception 'You can only guess on your turn.'; end if;
  if not (p_character_id = any (v_room.board_ids)) then raise exception 'That character is not on the board.'; end if;

  select user_id into v_opponent from public.room_players where room_id = p_room_id and user_id <> v_uid;
  select character_id into v_secret from public.room_secrets where room_id = p_room_id and user_id = v_opponent;
  v_correct := (v_secret = p_character_id);

  insert into public.room_events (room_id, round, user_id, kind, body, correct)
  values (p_room_id, v_room.round, v_uid, 'guess', p_character_id, v_correct);

  if v_correct then
    update public.rooms set status = 'finished', winner_id = v_uid, updated_at = now() where id = p_room_id;
  else
    update public.rooms set current_turn = v_opponent, phase = 'ask', updated_at = now() where id = p_room_id;
  end if;

  return v_correct;
end;
$$;

-- Start another round in the same room with a fresh board, after a game has finished.
create or replace function public.rematch(p_room_id uuid, p_board_ids text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not public.is_room_member(p_room_id) then raise exception 'Room not found.'; end if;
  if v_room.status <> 'finished' then return; end if; -- the other player already started it
  perform public._validate_board(p_board_ids);

  update public.rooms set board_ids = p_board_ids, round = round + 1 where id = p_room_id;
  perform public._deal_round(p_room_id);
end;
$$;

------------------------------------------------------------------------------
-- Permissions: only signed-in (incl. anonymous) users may call the game actions
------------------------------------------------------------------------------

revoke execute on function public._validate_name(text)   from public, anon, authenticated;
revoke execute on function public._validate_board(text[]) from public, anon, authenticated;
revoke execute on function public._deal_round(uuid)       from public, anon, authenticated;

revoke execute on function public.is_room_member(uuid)                  from public, anon;
revoke execute on function public.create_room(text, text[], text, text) from public, anon;
revoke execute on function public.join_room(text, text)                 from public, anon;
revoke execute on function public.ask_question(uuid, text)              from public, anon;
revoke execute on function public.answer_question(uuid, text)           from public, anon;
revoke execute on function public.make_guess(uuid, text)                from public, anon;
revoke execute on function public.rematch(uuid, text[])                 from public, anon;

grant execute on function public.is_room_member(uuid)            to authenticated;
grant execute on function public.create_room(text, text[], text, text) to authenticated;
grant execute on function public.join_room(text, text)           to authenticated;
grant execute on function public.ask_question(uuid, text)        to authenticated;
grant execute on function public.answer_question(uuid, text)     to authenticated;
grant execute on function public.make_guess(uuid, text)          to authenticated;
grant execute on function public.rematch(uuid, text[])           to authenticated;

------------------------------------------------------------------------------
-- Realtime: push changes to both phones (secrets are deliberately NOT published)
------------------------------------------------------------------------------

alter publication supabase_realtime add table public.rooms, public.room_players, public.room_events;
