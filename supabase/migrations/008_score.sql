-- Running score per room: each player's number of rounds won.
-- Run once in Supabase → SQL Editor → New query → Run (after 007).

alter table public.room_players
  add column if not exists wins int not null default 0 check (wins >= 0);

-- Count past wins in existing rooms (from correct guesses).
update public.room_players p
set wins = (
  select count(*) from public.room_events e
  where e.room_id = p.room_id and e.user_id = p.user_id and e.kind = 'guess' and e.correct
);

-- Whenever a round finishes with a winner, add one to their score.
-- (Covers both a correct guess and the opponent running out of guesses.)
create or replace function public._count_win()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'finished' and new.winner_id is not null and old.status is distinct from 'finished' then
    update public.room_players set wins = wins + 1
    where room_id = new.id and user_id = new.winner_id;
  end if;
  return new;
end;
$$;

revoke execute on function public._count_win() from public, anon, authenticated;

drop trigger if exists rooms_count_win on public.rooms;
create trigger rooms_count_win
  after update of status on public.rooms
  for each row execute function public._count_win();
