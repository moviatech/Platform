import { guardedJson } from "@/features/booking/public-api";
import { listClasses, loadActiveConfig, loadPrimaryLocation } from "@/features/booking/service";
import { isAcceptingBookings } from "@/features/booking/status";

export async function GET(request: Request) {
  return guardedJson(request, async () => {
    const [classes, config, location, acceptingBookings] = await Promise.all([listClasses(), loadActiveConfig(), loadPrimaryLocation(), isAcceptingBookings()]);
    return {
      acceptingBookings,
      currency: "usd",
      pricingVersion: config.version,
      taxRateBps: location.tax_rate_bps,
      classes: classes.map((item) => ({
        slug: item.slug,
        name: item.name,
        nameZh: item.name_zh,
        model: item.model,
        dailyRateCents: item.base_daily_rate_cents,
        securityHoldCents: item.security_hold_cents,
        seats: item.seats,
        rangeMiles: item.range_miles,
      })),
      rules: {
        rateTiers: config.data.rateTiers,
        protectionPlans: config.data.protectionPlans,
        protectionChargeCapDays: config.data.protectionChargeCapDays,
        addOns: config.data.addOns,
        payNowDiscountBps: config.data.payNowDiscountBps,
        youngDriver: config.data.youngDriver,
        deliveryFeeCents: config.data.deliveryFeeCents,
        maxRentalDays: config.data.maxRentalDays,
        minLeadHours: config.data.minLeadHours,
        bookingWindow: config.data.bookingWindow,
      },
    };
  });
}
