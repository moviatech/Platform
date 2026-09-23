alter table public.conversations alter column customer_email drop not null;

create index conversations_token_idx on public.conversations (token);
