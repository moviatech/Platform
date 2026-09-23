import { moved, type SearchParams } from "@/features/finance/moved";

export default async function MovedPage({ searchParams }: { searchParams: SearchParams }) {
  return moved("/finance/books/stripe", searchParams);
}
