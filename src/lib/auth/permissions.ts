export const staffRoles = ["SUPER_ADMIN", "STAFF"] as const;

export type StaffRole = (typeof staffRoles)[number];

export const permissions = [
  "lead.view",
  "lead.edit",
  "inbox.view",
  "inbox.reply",
  "inbox.manage",
  "reservation.view",
  "reservation.create",
  "reservation.edit",
  "reservation.cancel",
  "reservation.assign_vehicle",
  "customer.view_basic",
  "customer.view_sensitive",
  "customer.edit",
  "vehicle.view",
  "vehicle.edit",
  "vehicle.inspect",
  "handover.override",
  "payment.view",
  "payment.capture",
  "payment.refund",
  "pricing.view",
  "pricing.edit",
  "staff.view",
  "staff.manage",
  "settings.manage",
  "audit.view",
  "ratings.view",
] as const;

export type Permission = (typeof permissions)[number];

const staffBundle: Permission[] = [
  "lead.view",
  "lead.edit",
  "inbox.view",
  "inbox.reply",
  "inbox.manage",
  "reservation.view",
  "reservation.create",
  "reservation.edit",
  "reservation.cancel",
  "reservation.assign_vehicle",
  "customer.view_basic",
  "customer.view_sensitive",
  "customer.edit",
  "vehicle.view",
  "vehicle.edit",
  "vehicle.inspect",
  "payment.view",
  "pricing.view",
];

const rolePermissions: Record<StaffRole, readonly Permission[]> = {
  SUPER_ADMIN: permissions,
  STAFF: staffBundle,
};

export function permissionsFor(roles: StaffRole[]) {
  return new Set(roles.flatMap((role) => rolePermissions[role] ?? []));
}
