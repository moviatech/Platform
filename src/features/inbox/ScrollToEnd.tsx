"use client";

import { useEffect, useRef } from "react";

export function ScrollToEnd({ dep }: { dep: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (parent) parent.scrollTop = parent.scrollHeight;
  }, [dep]);
  return <div ref={ref} aria-hidden="true" />;
}
