-- Make the native client access contract explicit. Earlier policies already
-- isolate rows with auth.uid(); restricting them to authenticated removes any
-- ambiguity about anonymous access and the grants document intended usage.

alter policy "Users can read their daily checkins"
  on public.daily_checkins to authenticated;
alter policy "Users can create their daily checkins"
  on public.daily_checkins to authenticated;
alter policy "Users can update their daily checkins"
  on public.daily_checkins to authenticated;
alter policy "Users can delete their daily checkins"
  on public.daily_checkins to authenticated;

revoke all on public.daily_checkins from anon;
grant select, insert, update, delete on public.daily_checkins to authenticated;

alter policy "Users can read their coach recommendations"
  on public.coach_recommendations to authenticated;
alter policy "Users can create their coach recommendations"
  on public.coach_recommendations to authenticated;
alter policy "Users can update their coach recommendations"
  on public.coach_recommendations to authenticated;
alter policy "Users can delete their coach recommendations"
  on public.coach_recommendations to authenticated;

revoke all on public.coach_recommendations from anon;
grant select, insert, update, delete on public.coach_recommendations to authenticated;
