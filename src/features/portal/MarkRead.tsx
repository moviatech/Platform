"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function MarkRead({ id, unread }: { id: string; unread: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (unread) router.refresh();
  }, [id, unread, router]);
  return null;
}
