export const vehicleConditions = ["IN_SERVICE", "MAINTENANCE", "OUT_OF_SERVICE", "ACCIDENT_HOLD"] as const;
export type VehicleCondition = (typeof vehicleConditions)[number];

export const cleanStates = ["READY", "NEEDS_CLEANING", "NEEDS_CHARGING", "NEEDS_BOTH"] as const;
export type CleanState = (typeof cleanStates)[number];

export const blockTypes = ["MAINTENANCE", "OWNER_USE", "HOLD", "OTHER"] as const;
export type BlockType = (typeof blockTypes)[number];

export type VehicleRow = {
  id: string;
  class_id: string;
  location_id: string;
  fleet_number: string;
  vin: string | null;
  license_plate: string | null;
  year: number | null;
  exterior_color: string | null;
  condition: VehicleCondition;
  clean_state: CleanState;
  battery_level: number | null;
  odometer: number | null;
  is_placeholder: boolean;
  notes: string | null;
  vehicle_class: { id: string; slug: string; name: string; name_zh: string | null } | null;
};

export type VehicleTrip = { id: string; number: string; status: string; pickup_at: string; return_at: string; customer: { full_name: string } | null };

export type BlockRow = { id: string; vehicle_id: string; starts_at: string; ends_at: string; type: BlockType; reason: string | null };

export type ClassOption = { id: string; slug: string; name: string; name_zh: string | null; active: boolean };
