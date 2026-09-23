"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function TitleGuard() {
  const pathname = usePathname();
  useEffect(() => {
    const expected = document.querySelector("head > title")?.textContent?.trim();
    if (expected && document.title !== expected) document.title = expected;
    else if (!expected || !/Movia/.test(expected)) document.title = "Movia";
  }, [pathname]);
  return null;
}
