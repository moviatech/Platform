alter table public.vehicle_classes add column model_year integer check (model_year between 2015 and 2035);
