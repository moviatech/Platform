import "server-only";
import Stripe from "stripe";

let client: Stripe | undefined;

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("stripe_not_configured");
  if (!client) client = new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: "Movia Platform" } });
  return client;
}
