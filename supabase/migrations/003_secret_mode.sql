-- Adds the "secret mode": secrets dealt at random (Blind Draw) or picked by each player (Director's Cut).
-- Run once in Supabase → SQL Editor → New query → Run (after 002_deck.sql).
-- (schema.sql already includes this for brand-new projects.)

alter table public.rooms
  add column if not exists secret_mode text not null default 'random'
  check (secret_mode in ('random', 'choose'));

-- New room status 'choosing': both players are picking their secret actor.
alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check
  check (status in ('waiting', 'choosing', 'playing', 'finished'));

-- Starts play: random first player, clean slate.
create or replace function public._begin_play(p_room_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rooms
  set status = 'playing',
      phase = 'ask',
      winner_id = null,
      current_turn = (select user_id from public.room_players where room_id = p_room_id order by random() limit 1),
      updated_at = now()
  where id = p_room_id;

  insert into public.room_events (room_id, round, kind, body)
  select p_room_id, round, 'system', p_message from public.rooms where id = p_room_id;
end;
$$;

-- Starts a round: deals random secrets, or waits for both players to pick theirs.
create or replace function public._deal_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board text[];
  v_round int;
  v_mode  text;
begin
  select board_ids, round, secret_mode into v_board, v_round, v_mode from public.rooms where id = p_room_id;

  delete from public.room_secrets where room_id = p_room_id;

  if v_mode = 'choose' then
    update public.rooms
    set status = 'choosing', phase = 'ask', winner_id = null, current_turn = null, updated_at = now()
    where id = p_room_id;
    insert into public.room_events (room_id, round, kind, body)
    values (p_room_id, v_round, 'system', 'Round ' || v_round || ': pick the actor your opponent has to find.');
    return;
  end if;

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

  perform public._begin_play(p_room_id, 'Round ' || v_round || ' started. Good luck!');
end;
$$;

-- Replace create_room with a version that accepts the secret mode.
drop function if exists public.create_room(text, text[], text, text);

create or replace function public.create_room(
  p_name text,
  p_board_ids text[],
  p_code text default null,
  p_deck text default 'famous',
  p_secret_mode text default 'random'
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
  v_mode     text := coalesce(p_secret_mode, 'random');
  v_room_id  uuid;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then raise exception 'You are not signed in.'; end if;
  v_name := public._validate_name(p_name);
  perform public._validate_board(p_board_ids);
  if v_deck not in ('famous', 'random') then raise exception 'Unknown actor pool.'; end if;
  if v_mode not in ('random', 'choose') then raise exception 'Unknown secret mode.'; end if;

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

  insert into public.rooms (code, host_id, board_ids, deck, secret_mode)
  values (v_code, v_uid, p_board_ids, v_deck, v_mode)
  returning id into v_room_id;

  insert into public.room_players (room_id, user_id, name, seat)
  values (v_room_id, v_uid, v_name, 1);

  return v_room_id;
end;
$$;

-- Director's Cut: pick (or change) the actor your opponent has to find.
-- When both players have picked, the round starts.
create or replace function public.choose_secret(p_room_id uuid, p_character_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_had  boolean;
  v_name text;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not public.is_room_member(p_room_id) then raise exception 'Room not found.'; end if;
  if v_room.status <> 'choosing' then raise exception 'Secrets can only be picked before the round starts.'; end if;
  if not (p_character_id = any (v_room.board_ids)) then raise exception 'That actor is not on the board.'; end if;

  select exists (select 1 from public.room_secrets where room_id = p_room_id and user_id = v_uid) into v_had;

  insert into public.room_secrets (room_id, user_id, character_id)
  values (p_room_id, v_uid, p_character_id)
  on conflict (room_id, user_id) do update set character_id = excluded.character_id;

  if not v_had then
    select name into v_name from public.room_players where room_id = p_room_id and user_id = v_uid;
    insert into public.room_events (room_id, round, user_id, kind, body)
    values (p_room_id, v_room.round, v_uid, 'system', v_name || ' picked a secret actor.');
  end if;

  if (select count(*) from public.room_secrets where room_id = p_room_id) = 2 then
    perform public._begin_play(p_room_id, 'Both secrets are set. Round ' || v_room.round || ' started. Good luck!');
  end if;
end;
$$;

revoke execute on function public._begin_play(uuid, text) from public, anon, authenticated;
revoke execute on function public._deal_round(uuid) from public, anon, authenticated;
revoke execute on function public.create_room(text, text[], text, text, text) from public, anon;
revoke execute on function public.choose_secret(uuid, text) from public, anon;
grant  execute on function public.create_room(text, text[], text, text, text) to authenticated;
grant  execute on function public.choose_secret(uuid, text) to authenticated;
