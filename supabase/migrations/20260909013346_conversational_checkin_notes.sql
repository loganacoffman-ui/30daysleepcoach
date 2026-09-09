-- Conversational check-ins retain full replies, including context beyond the
-- structured answers. The column is already text; only the old form limit changes.
alter table public.daily_checkins drop constraint if exists daily_checkins_note_check;
