import { guardedJson } from "@/features/booking/public-api";
import { listWebLocations } from "@/features/booking/service";

export async function GET(request: Request) {
  return guardedJson(request, async () => {
    const rows = await listWebLocations();
    return {
      locations: rows.map((row, index) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        nameZh: row.name_zh,
        address: row.address,
        timezone: row.timezone,
        taxRateBps: row.tax_rate_bps,
        supportPhone: row.support_phone,
        supportHours: row.support_hours,
        supportHoursZh: row.support_hours_zh,
        pickupInstructions: row.pickup_instructions,
        pickupInstructionsZh: row.pickup_instructions_zh,
        primary: index === 0,
      })),
    };
  });
}
