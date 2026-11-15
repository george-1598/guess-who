-- Either player may guess at any time while a round is being played.
--   * Correct guess → that player wins immediately.
--   * Wrong guess on your own turn (before asking) → your turn passes, as before.
--   * Wrong guess at any other time → you miss your next turn (penalties add up).
-- Run once in Supabase → SQL Editor → New query → Run (after 005).

alter table public.room_players
  add column if not exists skip_turns int not null default 0 check (skip_turns >= 0);

-- Hands the turn to p_to, unless they owe a missed turn: then one penalty is used up
-- and the turn goes to the other player instead. Returns who actually gets the turn.
create or replace function public._give_turn(p_room_id uuid, p_to uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_skips int;
  v_name  text;
  v_other uuid;
begin
  select skip_turns, name into v_skips, v_name
  from public.room_players where room_id = p_room_id and user_id = p_to;

  if coalesce(v_skips, 0) = 0 then
    return p_to;
  end if;

  update public.room_players set skip_turns = skip_turns - 1
  where room_id = p_room_id and user_id = p_to;

  select user_id into v_other from public.room_players where room_id = p_room_id and user_id <> p_to;

  insert into public.room_events (room_id, round, kind, body)
  select p_room_id, round, 'system', v_name || ' misses this turn (wrong guess).'
  from public.rooms where id = p_room_id;

  return v_other;
end;
$$;

-- Round start: also clears any leftover penalties.
create or replace function public._begin_play(p_room_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_players set skip_turns = 0 where room_id = p_room_id;

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

-- Answer the pending question. The answerer asks next — unless they owe a missed turn.
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
  v_next uuid;
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

  v_next := public._give_turn(p_room_id, v_uid);
  update public.rooms set phase = 'ask', current_turn = v_next, updated_at = now() where id = p_room_id;
end;
$$;

-- Guess the opponent's secret actor — any time during play. Returns true if correct.
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
  v_correct  boolean;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not public.is_room_member(p_room_id) then raise exception 'Room not found.'; end if;
  if v_room.status <> 'playing' then raise exception 'The game is not in progress.'; end if;
  if not (p_character_id = any (v_room.board_ids)) then raise exception 'That actor is not on the board.'; end if;

  select user_id into v_opponent from public.room_players where room_id = p_room_id and user_id <> v_uid;
  select character_id into v_secret from public.room_secrets where room_id = p_room_id and user_id = v_opponent;
  v_correct := (v_secret = p_character_id);

  insert into public.room_events (room_id, round, user_id, kind, body, correct)
  values (p_room_id, v_room.round, v_uid, 'guess', p_character_id, v_correct);

  if v_correct then
    update public.rooms set status = 'finished', winner_id = v_uid, updated_at = now() where id = p_room_id;
  elsif v_room.current_turn = v_uid and v_room.phase = 'ask' then
    -- Wrong guess instead of asking: the turn passes, as before.
    update public.rooms
    set current_turn = public._give_turn(p_room_id, v_opponent), phase = 'ask', updated_at = now()
    where id = p_room_id;
  else
    -- Wrong guess out of turn: miss your next turn.
    update public.room_players set skip_turns = skip_turns + 1 where room_id = p_room_id and user_id = v_uid;
    select name into v_name from public.room_players where room_id = p_room_id and user_id = v_uid;
    insert into public.room_events (room_id, round, kind, body)
    values (p_room_id, v_room.round, 'system', v_name || ' guessed out of turn and will miss their next turn.');
    update public.rooms set updated_at = now() where id = p_room_id;
  end if;

  return v_correct;
end;
$$;

revoke execute on function public._give_turn(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._begin_play(uuid, text) from public, anon, authenticated;
revoke execute on function public.answer_question(uuid, text) from public, anon;
revoke execute on function public.make_guess(uuid, text) from public, anon;
grant  execute on function public.answer_question(uuid, text) to authenticated;
grant  execute on function public.make_guess(uuid, text) to authenticated;
