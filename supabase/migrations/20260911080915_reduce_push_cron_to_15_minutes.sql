-- Deploy the sender's 15-minute due window before applying this migration.
-- Preserve the existing job's command, credentials, and enabled state.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not configured; create the push job with schedule */15 * * * * when enabling notifications.';
    return;
  end if;

  perform cron.alter_job(job_id := jobid, schedule := '*/15 * * * *')
  from cron.job
  where jobname = 'dispatch-daily-push-notifications';

  if not found then
    raise notice 'Push job is not configured; use schedule */15 * * * * when creating it.';
  end if;
end;
$$;
