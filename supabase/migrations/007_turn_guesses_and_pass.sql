-- New guessing rules + "end my turn" for playing in person:
--   * You can only guess on your own turn (instead of asking).
--   * A wrong guess ends your turn. Three wrong guesses in a round and you lose.
--   * pass_turn: end your turn without asking in the app (the question was asked out loud).
-- Replaces the "miss your next turn" penalty from 006.
-- Run once in Supabase → SQL Editor → New query → Run (after 006).

alter table public.room_players
  add column if not exists wrong_guesses int not null default 0 check (wrong_guesses >= 0);

-- Round start: clean slate for both players.
create or replace function public._begin_play(p_room_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_players set skip_turns = 0, wrong_guesses = 0 where room_id = p_room_id;

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

-- Guess the opponent's secret actor on your turn. Returns true if correct.
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
  v_name     text;
  v_wrong    int;
  v_correct  boolean;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not public.is_room_member(p_room_id) then raise exception 'Room not found.'; end if;
  if v_room.status <> 'playing' then raise exception 'The game is not in progress.'; end if;
  if v_room.current_turn is distinct from v_uid or v_room.phase <> 'ask' then
    raise exception 'You can only guess on your turn.';
  end if;
  if not (p_character_id = any (v_room.board_ids)) then raise exception 'That actor is not on the board.'; end if;

  select user_id into v_opponent from public.room_players where room_id = p_room_id and user_id <> v_uid;
  select character_id into v_secret from public.room_secrets where room_id = p_room_id and user_id = v_opponent;
  v_correct := (v_secret = p_character_id);

  insert into public.room_events (room_id, round, user_id, kind, body, correct)
  values (p_room_id, v_room.round, v_uid, 'guess', p_character_id, v_correct);

  if v_correct then
    update public.rooms set status = 'finished', winner_id = v_uid, updated_at = now() where id = p_room_id;
    return true;
  end if;

  update public.room_players set wrong_guesses = wrong_guesses + 1
  where room_id = p_room_id and user_id = v_uid
  returning wrong_guesses, name into v_wrong, v_name;

  if v_wrong >= 3 then
    insert into public.room_events (room_id, round, kind, body)
    values (p_room_id, v_room.round, 'system', v_name || ' made 3 wrong guesses and loses the round.');
    update public.rooms set status = 'finished', winner_id = v_opponent, updated_at = now() where id = p_room_id;
  else
    update public.rooms set current_turn = v_opponent, phase = 'ask', updated_at = now() where id = p_room_id;
  end if;

  return false;
end;
$$;

-- End your turn without asking in the app (for questions asked out loud).
create or replace function public.pass_turn(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_room     public.rooms%rowtype;
  v_opponent uuid;
  v_name     text;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not public.is_room_member(p_room_id) then raise exception 'Room not found.'; end if;
  if v_room.status <> 'playing' then raise exception 'The game is not in progress.'; end if;
  if v_room.current_turn is distinct from v_uid or v_room.phase <> 'ask' then
    raise exception 'It is not your turn.';
  end if;

  select user_id into v_opponent from public.room_players where room_id = p_room_id and user_id <> v_uid;
  select name into v_name from public.room_players where room_id = p_room_id and user_id = v_uid;

  insert into public.room_events (room_id, round, kind, body)
  values (p_room_id, v_room.round, 'system', v_name || ' asked in person and ended their turn.');

  update public.rooms set current_turn = v_opponent, phase = 'ask', updated_at = now() where id = p_room_id;
end;
$$;

revoke execute on function public._begin_play(uuid, text) from public, anon, authenticated;
revoke execute on function public.make_guess(uuid, text) from public, anon;
revoke execute on function public.pass_turn(uuid) from public, anon;
grant  execute on function public.make_guess(uuid, text) to authenticated;
grant  execute on function public.pass_turn(uuid) to authenticated;
