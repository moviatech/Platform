const waiting = new Map<string, File[]>();

export function holdFiles(slug: string, files: File[]) {
  if (files.length) waiting.set(slug, files);
}

export function takeFiles(slug: string) {
  const files = waiting.get(slug) ?? [];
  waiting.delete(slug);
  return files;
}
