export const selfServiceStates = ["NONE", "REQUESTED", "APPROVED", "DECLINED", "FALLBACK", "STARTED", "RETURNED"] as const;

export type SelfServiceState = (typeof selfServiceStates)[number];

export type SelfServiceChecklist = { payment: boolean; paid: boolean; license: boolean; agreement: boolean; hold: boolean; complete: boolean };

export const selfServicePhotoBucket = "inspection-photos";
export const minSelfServicePhotos = 4;
export const maxSelfServicePhotos = 12;
export const startWindowMinutes = 60;
