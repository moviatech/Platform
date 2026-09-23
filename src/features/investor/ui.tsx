import type { BadgeTone } from "@/components/ui/Badge";
import type { InvestorStatus } from "@/lib/auth/investor";

export const statusTone: Record<InvestorStatus, BadgeTone> = { PENDING: "warning", ACTIVE: "success", SUSPENDED: "neutral", REJECTED: "danger", CLOSED: "neutral" };
