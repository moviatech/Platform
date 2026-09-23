import { describe, expect, it } from "vitest";
import { citedSources, outputText, type AiOutputItem } from "./sources";

const cite = (url: string, title?: string) => ({ type: "url_citation", url, title });

const output: AiOutputItem[] = [
  { type: "reasoning" },
  { type: "web_search_call" },
  {
    type: "message",
    content: [
      { type: "output_text", text: "First point. ", annotations: [cite("https://example.org/a?utm_source=openai", " A story "), cite("https://example.org/a", "Same page again"), { type: "file_citation" }] },
      { type: "output_text", text: "Second point.", annotations: [cite("https://example.org/b?x=1&utm_source=openai"), cite("javascript:alert(1)", "bad"), cite("not a url")] },
    ],
  },
];

const sourcesOf = (urls: string[]) => citedSources([{ type: "message", content: [{ type: "output_text", text: "x", annotations: urls.map((url) => cite(url)) }] }]).map((source) => source.url);

describe("ai sources", () => {
  it("joins the text of every message part", () => {
    expect(outputText(output)).toBe("First point. Second point.");
  });

  it("returns each cited page once, without the tracking parameter", () => {
    expect(citedSources(output)).toEqual([
      { url: "https://example.org/a", title: "A story" },
      { url: "https://example.org/b?x=1", title: "" },
    ]);
  });

  it("leaves the rest of the query exactly as it was", () => {
    expect(sourcesOf(["https://example.org/index.php?/2026/11/ev-rentals&utm_source=openai", "https://example.org/s?q=tesla%20rental&y&utm_source=openai", "https://example.org/t?utm_source=openai&q=a+b"])).toEqual([
      "https://example.org/index.php?/2026/11/ev-rentals",
      "https://example.org/s?q=tesla%20rental&y",
      "https://example.org/t?q=a+b",
    ]);
  });

  it("treats text-highlight links and other anchors of one page as the same page", () => {
    expect(sourcesOf(["https://example.org/a?utm_source=openai#:~:text=first%20quote", "https://example.org/a#:~:text=second", "https://example.org/a#part-2", "https://example.org/c#part-1"])).toEqual(["https://example.org/a", "https://example.org/c#part-1"]);
  });

  it("is empty when nothing was cited", () => {
    expect(citedSources([{ type: "message", content: [{ type: "output_text", text: "plain", annotations: null }] }])).toEqual([]);
    expect(citedSources(undefined)).toEqual([]);
    expect(outputText(undefined)).toBe("");
  });
});
