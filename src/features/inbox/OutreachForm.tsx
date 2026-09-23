"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { FieldWrap, Input, Select, Textarea } from "@/components/ui/Field";
import { sendOutreach, type OutreachState } from "./outreach-actions";

type Customer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
};
type Props = {
  customers: Customer[];
  totalCustomers: number;
  canBroadcast: boolean;
  query: string;
};

export function OutreachForm({
  customers,
  totalCustomers,
  canBroadcast,
  query,
}: Props) {
  const t = useTranslations("inbox.outreach");
  const [state, action, pending] = useActionState<OutreachState, FormData>(
    sendOutreach,
    {},
  );
  const value = (key: string, fallback = "") => state.values?.[key] ?? fallback;
  const selected = new Set(state.selected ?? []);

  if (state.ok) {
    return (
      <div className="card p-6 text-sm">
        <p className="font-medium text-status-available">
          {t("sent", { count: state.sent ?? 0 })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action="/inbox/new" method="get" className="flex gap-2">
        <Input
          name="q"
          defaultValue={query}
          placeholder={t("search")}
          className="h-9"
        />
        <Button type="submit" size="sm" variant="secondary">
          {t("find")}
        </Button>
      </form>
      <form action={action} className="card flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-charcoal">
            {t("recipients")}
          </p>
          {customers.length === 0 ? (
            <p className="text-[13px] text-muted">
              {query ? t("empty") : t("hint")}
            </p>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {customers.map((customer) => (
                <li key={customer.id}>
                  <label className="flex items-center gap-2 rounded-lg border border-ink/[0.08] px-3 py-2 text-[13px] hover:border-ink/25">
                    <input
                      type="checkbox"
                      name="customerIds"
                      value={customer.id}
                      defaultChecked={selected.has(customer.id)}
                      className="size-4 accent-[#b58b4b]"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {customer.full_name}
                      <span className="text-muted">
                        {" "}
                        · {customer.email ?? customer.phone ?? ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {canBroadcast && (
            <label className="flex items-center gap-2 text-[13px] text-charcoal">
              <input
                type="checkbox"
                name="audience"
                value="all"
                defaultChecked={value("audience") === "all"}
                className="size-4 accent-[#b58b4b]"
              />
              {t("all", { count: totalCustomers })}
            </label>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <FieldWrap label={t("channel")} htmlFor="channel">
            <Select
              id="channel"
              name="channel"
              defaultValue={value("channel", "portal")}
            >
              <option value="portal">{t("portal")}</option>
              <option value="email">{t("email")}</option>
            </Select>
          </FieldWrap>
          <FieldWrap label={t("subject")} htmlFor="subject">
            <Input
              id="subject"
              name="subject"
              required
              maxLength={200}
              defaultValue={value("subject")}
            />
          </FieldWrap>
        </div>
        <FieldWrap label={t("body")} htmlFor="body">
          <Textarea
            id="body"
            name="body"
            required
            maxLength={20000}
            defaultValue={value("body")}
            className="min-h-40"
          />
        </FieldWrap>
        <div className="flex flex-wrap items-center gap-3">
          {state.confirm ? (
            <>
              <input type="hidden" name="confirm" value="yes" />
              <Button type="submit" variant="danger" disabled={pending}>
                {t("confirm", { count: state.confirm })}
              </Button>
            </>
          ) : (
            <Button type="submit" disabled={pending}>
              {t("send")}
            </Button>
          )}
          {state.error && (
            <span className="text-[13px] text-status-danger">
              {t.has(`errors.${state.error}`)
                ? t(`errors.${state.error}`)
                : state.error}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
