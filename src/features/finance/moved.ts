import { redirect } from "next/navigation";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function moved(path: string, searchParams: SearchParams): Promise<never> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of [value].flat()) if (typeof item === "string") search.append(key, item);
  }
  const query = search.toString();
  redirect(query ? `${path}?${query}` : path);
}
