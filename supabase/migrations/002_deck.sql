-- Adds the "deck" choice (famous / random actors) to rooms.
-- Run once in Supabase → SQL Editor → New query → Run, if you already ran schema.sql before.
-- (schema.sql already includes this for brand-new projects.)

alter table public.rooms
  add column if not exists deck text not null default 'famous'
  check (deck in ('famous', 'random'));

-- Replace create_room with a version that accepts the deck.
drop function if exists public.create_room(text, text[], text);

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

revoke execute on function public.create_room(text, text[], text, text) from public, anon;
grant  execute on function public.create_room(text, text[], text, text) to authenticated;
