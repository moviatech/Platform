export const RULES_VERSION = 4;

export type Reason = "NEW" | "REPRICE" | "STATUS" | "RULE" | "SOURCE_DELETED" | "CORRECTION" | "MANUAL";

export type Tags = {
  reservation_id?: string | null;
  vehicle_id?: string | null;
  location_id?: string | null;
  investor_id?: string | null;
  expense_id?: string | null;
  stripe_id?: string | null;
  revenue_class?: string | null;
};

export type Target = Tags & { account: string; amount: number };

export type PostingItem = {
  source_type: string;
  source_id: string;
  source_key: string;
  economic_date: string;
  rule_version: number;
  reason: Reason;
  inputs: Record<string, unknown>;
  memo?: string | null;
  targets: Target[];
};

export type Issue = {
  kind: string;
  dedupeKey: string;
  reservationId?: string | null;
  investorId?: string | null;
  sourceKey?: string | null;
  detail?: Record<string, unknown>;
};

export type Built = { items: PostingItem[]; issues: Issue[] };

export const debitCredit = (debit: string, credit: string, amount: number, tags: Tags = {}, creditTags: Tags = tags): Target[] =>
  amount === 0 ? [] : [{ account: debit, amount, ...tags }, { account: credit, amount: -amount, ...creditTags }];

export const netOf = (targets: Target[]) => targets.reduce((sum, target) => sum + target.amount, 0);

export function item(input: { sourceType: string; sourceId: string; key: string; date: string; inputs?: Record<string, unknown>; memo?: string | null; targets: Target[] }): PostingItem {
  return {
    source_type: input.sourceType,
    source_id: input.sourceId,
    source_key: input.key,
    economic_date: input.date,
    rule_version: RULES_VERSION,
    reason: "NEW",
    inputs: input.inputs ?? {},
    memo: input.memo ?? null,
    targets: input.targets.filter((target) => target.amount !== 0),
  };
}
