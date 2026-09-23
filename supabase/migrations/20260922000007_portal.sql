create table public.vehicle_media (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  kind text not null check (kind in ('IMAGE', 'VIDEO')),
  storage_path text not null,
  mime_type text not null,
  caption text,
  sort_order integer not null default 0,
  created_by uuid references public.staff_members (user_id) on delete set null,
  created_at timestamptz not null default now()
);

create index vehicle_media_vehicle_idx on public.vehicle_media (vehicle_id, sort_order);

alter table public.vehicle_media enable row level security;
revoke all on public.vehicle_media from anon;

create policy vehicle_media_authenticated_read on public.vehicle_media
for select to authenticated using (true);

insert into storage.buckets (id, name, public, file_size_limit)
values ('vehicle-media', 'vehicle-media', true, 52428800)
on conflict (id) do nothing;

create policy vehicle_media_public_read on storage.objects
for select to public using (bucket_id = 'vehicle-media');

alter table public.customers add column referral_code text unique;

alter table public.conversations add column customer_id uuid references public.customers (id) on delete set null;
create index conversations_customer_idx on public.conversations (customer_id);

create policy conversations_customer_read on public.conversations
for select to authenticated using (customer_id = (select public.current_customer_id()));

create policy messages_customer_read on public.messages
for select to authenticated using (
  direction <> 'INTERNAL'
  and exists (select 1 from public.conversations c where c.id = conversation_id and c.customer_id = (select public.current_customer_id()))
);

insert into public.settings (key, value) values
  ('portal', '{"announcements":[{"title":{"zh":"欢迎来到 Movia 客户中心","en":"Welcome to your Movia account"},"body":{"zh":"活动、优惠和新车上线会在这里第一时间更新。","en":"Events, offers and new vehicles will be posted here first."},"url":""}],"links":[{"label":{"zh":"Full Self-Driving (Supervised) 使用说明","en":"Full Self-Driving (Supervised) guide"},"url":"https://www.moviatech.ai","kind":"site"}],"referral":{"headline":{"zh":"推荐好友","en":"Refer a friend"},"body":{"zh":"把你的推荐码分享给朋友，奖励规则公布后会在这里更新。","en":"Share your code with friends. Reward details will be posted here."}},"contact":{"phone":"+1 (626) 390-4721","wechat":"MoviaTech","email":"contact@moviatech.ai","hours":{"zh":"每天 7:00–21:00（美西时间）","en":"7 a.m.–9 p.m. Pacific, every day"}}}'::jsonb)
on conflict (key) do nothing;
