select cron.schedule(
  'movia-warm',
  '*/4 * * * *',
  $job$
  select net.http_get(url := 'https://api.moviatech.ai/health');
  select net.http_get(url := 'https://ops.moviatech.ai/login');
  select net.http_get(url := 'https://account.moviatech.ai/login');
  $job$
);
