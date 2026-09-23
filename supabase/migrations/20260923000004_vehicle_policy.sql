drop policy vehicles_customer_read on public.vehicles;

create policy vehicles_customer_read on public.vehicles
for select to authenticated using (
  exists (select 1 from public.reservations r where r.assigned_vehicle_id = vehicles.id and r.customer_id = (select public.current_customer_id()) and r.status in ('CONFIRMED', 'ACTIVE'))
);
