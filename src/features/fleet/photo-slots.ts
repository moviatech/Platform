export type PhotoGroup = "showcase" | "archive";
export type PhotoSlot = { key: string; group: PhotoGroup };

export const flawSlot = "flaw";

const exterior: PhotoSlot[] = [
  { key: "front_left", group: "showcase" },
  { key: "front", group: "showcase" },
  { key: "left", group: "showcase" },
  { key: "right", group: "showcase" },
  { key: "rear", group: "showcase" },
  { key: "cabin_front", group: "showcase" },
  { key: "cabin_rear", group: "showcase" },
];

const thirdRow: PhotoSlot[] = [
  { key: "third_row", group: "showcase" },
  { key: "third_row_folded", group: "showcase" },
];

const trunk: PhotoSlot[] = [{ key: "trunk", group: "showcase" }];

const bed: PhotoSlot[] = [
  { key: "bed", group: "showcase" },
  { key: "tailgate", group: "showcase" },
  { key: "tonneau", group: "showcase" },
];

const frunk: PhotoSlot[] = [{ key: "frunk", group: "showcase" }];

const archive: PhotoSlot[] = [
  { key: "wheel_fl", group: "archive" },
  { key: "wheel_fr", group: "archive" },
  { key: "wheel_rl", group: "archive" },
  { key: "wheel_rr", group: "archive" },
  { key: "roof", group: "archive" },
  { key: "windshield", group: "archive" },
  { key: "screen", group: "archive" },
  { key: "charge_port", group: "archive" },
  { key: "accessories", group: "archive" },
];

export function slotsFor(vehicleClass: { model?: string | null; slug?: string | null } | null | undefined): PhotoSlot[] {
  const truck = vehicleClass?.model === "cybertruck";
  return [...exterior, ...(vehicleClass?.slug === "model-y-l" ? thirdRow : []), ...(truck ? bed : trunk), ...frunk, ...archive];
}

export const allSlotKeys = [...new Set([...exterior, ...thirdRow, ...trunk, ...bed, ...frunk, ...archive].map((slot) => slot.key))];

export const slotVisibility = (key: string, slots: PhotoSlot[]) => (key === flawSlot || slots.find((slot) => slot.key === key)?.group === "showcase" ? "CUSTOMER" : "INTERNAL");
