const stop = new Set(["the", "and", "for", "you", "your", "with", "that", "this", "are", "can", "have", "has", "will", "our", "not", "but", "from", "what", "how", "when", "there", "would", "could", "about", "please", "thanks", "thank", "hello", "movia", "tesla", "any", "all", "was", "were", "they", "them", "their", "does", "did", "just", "also", "need", "want", "like", "get", "let", "know"]);

export function terms(text: string) {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z][a-z0-9]{2,}/g) ?? []) if (!stop.has(word)) found.add(word);
  for (const run of lower.match(/[一-鿿]{2,}/g) ?? []) for (let index = 0; index < run.length - 1; index += 1) found.add(run.slice(index, index + 2));
  return found;
}

export function rankByRelevance<T>(items: T[], haystack: (item: T) => string, query: string, limit: number): T[] {
  const wanted = [...terms(query)];
  if (!wanted.length || !items.length) return [];
  const texts = items.map((item) => haystack(item).toLowerCase());
  const scores = new Array<number>(items.length).fill(0);
  for (const term of wanted) {
    const hits = texts.map((text) => text.includes(term));
    const count = hits.filter(Boolean).length;
    if (!count) continue;
    const weight = Math.log(1 + items.length / count);
    hits.forEach((hit, index) => {
      if (hit) scores[index] += weight;
    });
  }
  const floor = Math.max(...scores) * 0.3;
  return items
    .map((item, index) => ({ item, index, score: scores[index] }))
    .filter((entry) => entry.score > 0 && entry.score >= floor)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}
