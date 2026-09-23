insert into public.locations (code, name, name_zh, address, timezone, tax_rate_bps, pickup_instructions, pickup_instructions_zh)
values (
  'IRV', 'Irvine Hub', '尔湾门店', '780 Roosevelt, Irvine, CA 92620', 'America/Los_Angeles', 775,
  'Pickup is by appointment between 8:00 AM and 8:00 PM. We will confirm the exact meeting point before your trip.',
  '取车需预约，时间为每天 8:00–20:00。出行前我们会与您确认具体交接地点。'
)
on conflict (code) do nothing;

insert into public.vehicle_classes (slug, name, name_zh, model, base_daily_rate_cents, security_hold_cents, buffer_hours, seats, range_miles, sort_order)
values
  ('model-y-basic', 'Model Y Basic', 'Model Y 基础版', 'model-y', 9900, 50000, 3, 5, 260, 10),
  ('model-y-premium', 'Model Y Premium', 'Model Y 高级版', 'model-y', 12900, 50000, 3, 5, 320, 20),
  ('model-y-l', 'Model Y L', 'Model Y L 六座版', 'model-y', 17900, 50000, 3, 6, 323, 30),
  ('cybertruck-basic', 'Cybertruck Basic', 'Cybertruck 基础版', 'cybertruck', 17900, 100000, 3, 5, 250, 40),
  ('cybertruck-premium', 'Cybertruck Premium', 'Cybertruck 高级版', 'cybertruck', 22900, 100000, 3, 5, 320, 50)
on conflict (slug) do nothing;

insert into public.pricing_configs (version, data)
values (1, '{
  "rateTiers": [
    {"id": "monthly", "minDays": 30, "multiplierBps": 5500},
    {"id": "weekly", "minDays": 7, "multiplierBps": 7500},
    {"id": "daily", "minDays": 1, "multiplierBps": 10000}
  ],
  "maxRentalDays": 90,
  "minLeadHours": 2,
  "bookingWindow": {"start": "08:00", "end": "20:00", "stepMinutes": 30},
  "protectionChargeCapDays": 14,
  "protectionPlans": [
    {"id": "none", "dailyCents": 0, "monthlyCents": 0, "deductibleCents": null},
    {"id": "basic", "dailyCents": 1900, "monthlyCents": 27000, "deductibleCents": 250000},
    {"id": "standard", "dailyCents": 3200, "monthlyCents": 45000, "deductibleCents": 50000},
    {"id": "premier", "dailyCents": 4500, "monthlyCents": 63000, "deductibleCents": 0}
  ],
  "addOns": [
    {"id": "charging", "kind": "perDay", "priceCents": 990},
    {"id": "driver", "kind": "perDay", "priceCents": 500},
    {"id": "childSeat", "kind": "free", "depositCents": 10000},
    {"id": "unlimitedMiles", "kind": "rentPercent", "percentBps": 5000}
  ],
  "payNowDiscountBps": 200,
  "youngDriver": {"minAge": 21, "maxAge": 24, "feeDailyCents": 2500},
  "deliveryFeeCents": 0,
  "returnGraceMinutes": 29,
  "holdRenewDays": 7,
  "citationHoldCents": 20000,
  "mileage": {
    "allowance": {"daily": 200, "weekly": 1400, "monthly": 6000},
    "excessRateCents": {"model-y": 99, "cybertruck": 149}
  },
  "charge": {"minReturnLevel": 80, "lowChargeFeeCentsPerPercent": 50},
  "cancelPolicy": {
    "short": {"freeHours": 24, "lateDays": 1, "noShowMaxDays": 3},
    "monthly": {"freeHours": 72, "feeHours": 48, "feeCents": 10000, "lateHours": 24, "lateDays": 1, "finalDays": 2, "noShowDays": 3}
  },
  "requestHoldHours": 24,
  "checkoutHoldMinutes": 30
}'::jsonb)
on conflict (version) do nothing;

insert into public.vehicles (class_id, location_id, fleet_number, year, exterior_color, battery_level, odometer, is_placeholder, notes)
select c.id, l.id, v.fleet_number, 2026, v.color, 90, 1200, true, 'Placeholder vehicle. Replace with real fleet data.'
from (values
  ('model-y-basic', 'MY-001', 'Pearl White'),
  ('model-y-basic', 'MY-002', 'Pearl White'),
  ('model-y-premium', 'MY-003', 'Stealth Grey'),
  ('model-y-premium', 'MY-004', 'Stealth Grey'),
  ('model-y-l', 'MY-005', 'Deep Blue'),
  ('cybertruck-basic', 'CT-001', 'Stainless'),
  ('cybertruck-premium', 'CT-002', 'Stainless')
) as v (slug, fleet_number, color)
join public.vehicle_classes c on c.slug = v.slug
cross join (select id from public.locations where code = 'IRV') l
on conflict (fleet_number) do nothing;
