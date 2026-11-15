-- Nightly clean-up so the free tier never fills up:
--   * rooms with no activity for 7 days (their players, secrets and log go with them)
--   * anonymous players who haven't opened the game for 30 days and aren't in any room
-- The app signs in again automatically if its old anonymous player was removed.
-- Run once in Supabase → SQL Editor → New query → Run (after 004).
-- Supabase will warn that this contains "destructive operations" (the DELETEs below): that's expected.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public._cleanup_old_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rooms
  where updated_at < now() - interval '7 days';

  delete from auth.users u
  where u.is_anonymous
    and u.created_at < now() - interval '30 days'
    and not exists (select 1 from public.room_players p where p.user_id = u.id)
    and not exists (
      select 1 from auth.sessions s
      where s.user_id = u.id and s.updated_at > now() - interval '30 days'
    );
end;
$$;

revoke execute on function public._cleanup_old_data() from public, anon, authenticated;

-- Every night at 04:00 UTC. Re-running this file just updates the schedule.
select cron.schedule('guess-who-cleanup', '0 4 * * *', $$select public._cleanup_old_data()$$);
