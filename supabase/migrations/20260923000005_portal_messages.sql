alter type public.message_channel add value if not exists 'PORTAL';

alter table public.conversations add column customer_notified_at timestamptz;
