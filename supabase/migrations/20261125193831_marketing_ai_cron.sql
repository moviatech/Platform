select cron.schedule(
  'movia-marketing-weekly-brief',
  '10 15 * * 3',
  $job$
  select net.http_post(
    url := 'https://api.moviatech.ai/internal/marketing/brief',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-internal-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'internal_tick_key' limit 1), '')
    ),
    timeout_milliseconds := 25000
  );
  $job$
);
