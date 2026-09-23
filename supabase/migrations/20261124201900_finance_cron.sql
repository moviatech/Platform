select cron.schedule(
  'movia-finance',
  '23 * * * *',
  $job$
  select net.http_post(
    url := 'https://api.moviatech.ai/internal/finance/tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-internal-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'internal_tick_key' limit 1), '')
    ),
    timeout_milliseconds := 55000
  );
  $job$
);
