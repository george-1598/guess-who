-- Fix: in Classic mode the secrets were always the 1st and 2nd actors on the board.
-- `select unnest(arr) ... order by random()` evaluates random() once for all rows, so the
-- "shuffle" kept the original order. Unnesting in FROM gives every actor its own random value.
-- Run once in Supabase → SQL Editor → New query → Run (after 003_secret_mode.sql).

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

  -- Two different actors picked at random from the whole board, one per player.
  insert into public.room_secrets (room_id, user_id, character_id)
  select p_room_id, pl.user_id, pk.character_id
  from (
    select user_id, row_number() over (order by random()) as rn
    from public.room_players where room_id = p_room_id
  ) as pl
  join (
    select character_id, row_number() over () as rn
    from (
      select b.character_id
      from unnest(v_board) as b(character_id)
      order by random()
      limit 2
    ) as shuffled
  ) as pk using (rn);

  perform public._begin_play(p_room_id, 'Round ' || v_round || ' started. Good luck!');
end;
$$;

revoke execute on function public._deal_round(uuid) from public, anon, authenticated;
