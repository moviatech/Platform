import { useEffect, useEffectEvent, useState } from "react";
import { intakeMaxFiles } from "./intake";

async function entryFiles(entry: FileSystemEntry, depth: number): Promise<File[]> {
  if (entry.isFile) return new Promise((resolve) => (entry as FileSystemFileEntry).file((file) => resolve([file]), () => resolve([])));
  if (!entry.isDirectory || depth > 3) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const found: File[] = [];
  while (found.length <= intakeMaxFiles) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    for (const child of batch) found.push(...(await entryFiles(child, depth + 1)));
  }
  return found;
}

export function droppedFiles(data: DataTransfer): Promise<File[]> {
  const plain = Array.from(data.files);
  const entries = Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null));
  if (!entries.some(Boolean)) return Promise.resolve(plain);
  return Promise.all(entries.map((entry) => (entry ? entryFiles(entry, 0) : Promise.resolve<File[]>([])))).then((nested) => {
    const found = nested.flat();
    return found.length ? found : plain;
  });
}

export function useFileDrop(onDrop: (files: File[], target: EventTarget | null) => void) {
  const [over, setOver] = useState(false);
  const handle = useEffectEvent(onDrop);
  useEffect(() => {
    let timer = 0;
    const carries = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes("Files"));
    const hover = (event: DragEvent) => {
      if (!carries(event)) return;
      event.preventDefault();
      setOver(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setOver(false), 200);
    };
    const drop = (event: DragEvent) => {
      if (!carries(event) || !event.dataTransfer) return;
      event.preventDefault();
      window.clearTimeout(timer);
      setOver(false);
      const target = event.target;
      void droppedFiles(event.dataTransfer).then((files) => handle(files, target));
    };
    window.addEventListener("dragover", hover);
    window.addEventListener("drop", drop);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("dragover", hover);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return over;
}
