alter table public.blog_posts add column featured_at timestamptz;

update public.blog_posts set featured_at = coalesce(published_at, now()) where featured;
