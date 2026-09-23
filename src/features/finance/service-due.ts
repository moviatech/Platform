import { isTestOrder } from "./test-orders";

export type ServiceCar = { fleet_number: string; is_placeholder: boolean; vehicle_class: { slug: string } | null } | null;

export type ServiceLogFacts = { id: string; vehicle_id: string; cost_cents: number; vehicle: ServiceCar };

export const isTestCar = (vehicle: ServiceCar) => isTestOrder({ classSlug: vehicle?.vehicle_class?.slug ?? null, fleetNumber: vehicle?.fleet_number ?? null, placeholder: vehicle?.is_placeholder ?? null });

export const unbookedLogs = <T extends ServiceLogFacts>(logs: T[], booked: Set<string>, skipped: Set<string>) =>
  logs.filter((log) => log.cost_cents > 0 && !booked.has(log.id) && !skipped.has(log.id) && !isTestCar(log.vehicle));

export const openServiceCosts = <T extends { id: string }>(logs: T[], booked: Set<string>, skipped: Set<string>) => logs.filter((log) => !booked.has(log.id) && !skipped.has(log.id));

export function serviceLogError(log: { vehicle_id: string } | null, vehicleId: string | undefined): "serviceGone" | "vehicle" | null {
  if (!log) return "serviceGone";
  if (vehicleId !== undefined && vehicleId !== log.vehicle_id) return "vehicle";
  return null;
}
