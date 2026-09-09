-- Match the mobile check-in's aggregate journal limit while allowing rich replies.
alter table public.daily_checkins drop constraint if exists daily_checkins_note_check;
alter table public.daily_checkins add constraint daily_checkins_note_check
  check (char_length(note) <= 20000);
