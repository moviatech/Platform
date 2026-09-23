"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const startEvent = "movia:navigate";

export function startNavigation() {
  window.dispatchEvent(new Event(startEvent));
}

export function useOptimisticPath() {
  const pathname = usePathname();
  const [picked, setPicked] = useState<{ href: string; from: string } | null>(null);
  if (picked && picked.from !== pathname) setPicked(null);
  useEffect(() => {
    if (!picked) return;
    const timer = setTimeout(() => setPicked(null), 12000);
    return () => clearTimeout(timer);
  }, [picked]);
  const pick = (event: ReactMouseEvent, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setPicked({ href, from: pathname });
  };
  return { pathname: picked && picked.from === pathname ? picked.href : pathname, pick };
}

function clearMarks() {
  document.querySelectorAll("a[data-pending]").forEach((node) => node.removeAttribute("data-pending"));
  document.querySelectorAll("button[data-native-busy]").forEach((node) => {
    node.removeAttribute("data-native-busy");
    node.removeAttribute("aria-busy");
  });
}

export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = `${pathname}?${search}`;
  const [from, setFrom] = useState<string | null>(null);
  if (from !== null && from !== here) setFrom(null);
  const active = from !== null && from === here;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!event.defaultPrevented || !(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("data-no-progress")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      anchor.setAttribute("data-pending", "");
      setFrom(here);
    };
    const onSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
      if (event.target.target && event.target.target !== "_self") return;
      if (event.submitter instanceof HTMLButtonElement) {
        event.submitter.setAttribute("data-native-busy", "");
        event.submitter.setAttribute("aria-busy", "true");
      }
      setFrom(here);
    };
    const onStart = () => setFrom(here);
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      clearMarks();
      setFrom(null);
    };
    window.addEventListener("click", onClick);
    window.addEventListener("submit", onSubmit);
    window.addEventListener(startEvent, onStart);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("submit", onSubmit);
      window.removeEventListener(startEvent, onStart);
      window.removeEventListener("pageshow", onShow);
    };
  }, [here]);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-navigating", active);
    if (!active) {
      clearMarks();
      return;
    }
    const timer = setTimeout(() => setFrom(null), 10000);
    return () => clearTimeout(timer);
  }, [active]);

  return <div aria-hidden="true" data-active={active ? "" : undefined} className="nav-progress" />;
}
