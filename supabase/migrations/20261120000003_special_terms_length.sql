alter table public.reservations
  drop constraint reservations_special_terms_check,
  drop constraint reservations_special_terms_zh_check,
  add constraint reservations_special_terms_check check (special_terms is null or char_length(special_terms) <= 10000),
  add constraint reservations_special_terms_zh_check check (special_terms_zh is null or char_length(special_terms_zh) <= 10000);
