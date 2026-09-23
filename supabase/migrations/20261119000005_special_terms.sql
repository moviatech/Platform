alter table public.reservations
  add column special_terms text check (special_terms is null or char_length(special_terms) <= 2000),
  add column special_terms_zh text check (special_terms_zh is null or char_length(special_terms_zh) <= 2000);
