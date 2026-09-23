"use client";

import { useState, type ComponentProps } from "react";
import { Input } from "./Field";

export function formatMoneyInput(raw: string) {
  const negative = raw.trim().startsWith("-");
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return negative ? "-" : "";
  const [whole, ...rest] = cleaned.split(".");
  const decimals = rest.join("").slice(0, 2);
  const grouped = (whole.replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}${rest.length ? `.${decimals}` : ""}`;
}

export function formatPhoneInput(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (digits.length > 11 || (digits.length === 11 && !digits.startsWith("1"))) return `+${digits}`;
  const area = national.slice(0, 3);
  const prefix = national.slice(3, 6);
  const line = national.slice(6, 10);
  if (national.length <= 3) return `+1 (${area}`;
  if (national.length <= 6) return `+1 (${area}) ${prefix}`;
  return `+1 (${area}) ${prefix}-${line}`;
}

type Props = Omit<ComponentProps<"input">, "value" | "onChange" | "defaultValue"> & { value?: string; defaultValue?: string; onValueChange?: (value: string) => void };

export function MoneyInput({ value, defaultValue, onValueChange, ...props }: Props) {
  const [inner, setInner] = useState(() => formatMoneyInput(defaultValue ?? ""));
  const current = value !== undefined ? value : inner;
  return (
    <Input
      {...props}
      inputMode="decimal"
      value={current}
      onChange={(event) => {
        const next = formatMoneyInput(event.target.value);
        if (value === undefined) setInner(next);
        onValueChange?.(next);
      }}
    />
  );
}

export function PhoneInput({ value, defaultValue, onValueChange, ...props }: Props) {
  const [inner, setInner] = useState(() => formatPhoneInput(defaultValue ?? ""));
  const current = value !== undefined ? value : inner;
  return (
    <Input
      {...props}
      type="tel"
      inputMode="tel"
      value={current}
      onChange={(event) => {
        const next = formatPhoneInput(event.target.value);
        if (value === undefined) setInner(next);
        onValueChange?.(next);
      }}
    />
  );
}
