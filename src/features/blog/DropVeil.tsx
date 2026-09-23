"use client";

import { useRouter } from "next/navigation";
import { startNavigation } from "@/components/ui/NavigationProgress";
import { useFileDrop } from "./file-drop";
import { fileKind } from "./intake";
import { holdFiles } from "./pending";

export const newArticleKey = "new";

export function DropVeil({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-2 border-dashed border-gold bg-gold/5">
      <span className="rounded-pill bg-ink px-4 py-2 text-sm text-white">{label}</span>
    </div>
  );
}

export function ListDrop({ label }: { label: string }) {
  const router = useRouter();
  const over = useFileDrop((files) => {
    const wanted = files.filter((file) => fileKind(file.name, file.type) !== "other");
    if (!wanted.length) return;
    holdFiles(newArticleKey, wanted);
    startNavigation();
    router.push("/marketing/blog/new");
  });
  return <DropVeil show={over} label={label} />;
}
