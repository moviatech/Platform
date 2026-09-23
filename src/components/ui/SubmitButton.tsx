"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

type Submitter = Pick<ComponentProps<"button">, "type" | "name" | "value" | "formAction" | "disabled">;

export function useSubmitState({ type, name, value, formAction, disabled }: Submitter) {
  const status = useFormStatus();
  const pending = status.pending && (type ?? "submit") === "submit";
  const mine = pending && (formAction ? status.action === formAction : name ? status.data?.get(name) === String(value ?? "") : true);
  return { disabled: disabled || pending, "aria-busy": mine || undefined };
}

export function SubmitButton(props: Omit<ComponentProps<"button">, "type">) {
  const state = useSubmitState(props);
  return <button {...props} type="submit" {...state} />;
}
