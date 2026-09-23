select cron.schedule(
  'movia-marketing-google-sync',
  '17 11 * * *',
  $job$
  select net.http_post(
    url := 'https://api.moviatech.ai/internal/marketing/sync',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-internal-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'internal_tick_key' limit 1), '')
    ),
    timeout_milliseconds := 25000
  );
  $job$
);
