import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-ip";

const head = (entries: Record<string, string>) => new Headers(entries);

describe("clientIpFrom", () => {
  it("trusts cf-connecting-ip only when the hop before CloudFront is a Cloudflare edge", () => {
    expect(clientIpFrom(head({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9, 172.69.65.59, 64.252.74.159" }))).toBe("203.0.113.9");
    expect(clientIpFrom(head({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 198.51.100.7, 64.252.74.159" }))).toBe("198.51.100.7");
  });

  it("drops the CloudFront hop and ignores client-supplied prefixes", () => {
    expect(clientIpFrom(head({ "x-forwarded-for": "8.8.8.8, 198.51.100.7, 64.252.74.159" }))).toBe("198.51.100.7");
    expect(clientIpFrom(head({ "x-forwarded-for": "198.51.100.7, 10.0.0.5, 64.252.74.159" }))).toBe("198.51.100.7");
    expect(clientIpFrom(head({ "x-forwarded-for": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("returns null without forwarding headers", () => {
    expect(clientIpFrom(head({}))).toBeNull();
  });
});
