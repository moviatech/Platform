export const requestTypes = ["schedule", "extend", "driver", "childSeat", "pickupReturn", "accessibility", "special", "issue", "other"] as const;
export type RequestType = (typeof requestTypes)[number];
export type RequestState = { ok?: boolean; error?: string; score?: number };

export const requestSubjects: Record<RequestType, { zh: string; en: string }> = {
  schedule: { zh: "调整租期", en: "Change rental dates" },
  extend: { zh: "延长租期", en: "Extend rental" },
  driver: { zh: "添加驾驶人", en: "Add a driver" },
  childSeat: { zh: "儿童座椅", en: "Child seat" },
  pickupReturn: { zh: "取还车安排", en: "Pickup / return arrangements" },
  accessibility: { zh: "无障碍需求", en: "Accessibility accommodation" },
  special: { zh: "特殊需求", en: "Special request" },
  issue: { zh: "问题反馈", en: "Report an issue" },
  other: { zh: "其他问题", en: "Question" },
};
