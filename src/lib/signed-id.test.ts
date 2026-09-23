import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { signedId } = await import("./signed-id");

const id = "3f2a9c1e-7b64-4d0a-9e51-0c8d7a6b5e4f";

describe("signedId", () => {
  it("round-trips an id through a token of fixed length", () => {
    const long = signedId("agreement-link", 20);
    const short = signedId("pay-link", 8);
    expect(long.token(id)).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(short.token(id)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(long.id(long.token(id))).toBe(id);
    expect(short.id(short.token(id))).toBe(id);
  });

  it("matches the tokens issued before the helper was shared", () => {
    const raw = Buffer.from(id.replace(/-/g, ""), "hex");
    const key = createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "movia").update("agreement-link").digest();
    const expected = Buffer.concat([raw, createHmac("sha256", key).update(raw).digest().subarray(0, 20)]).toString("base64url");
    expect(signedId("agreement-link", 20).token(id)).toBe(expected);
  });

  it("refuses a changed, shortened or foreign token", () => {
    const pay = signedId("pay-link", 8);
    const token = pay.token(id);
    const flipped = `${token.slice(0, 5)}${token[5] === "A" ? "B" : "A"}${token.slice(6)}`;
    const tail = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(pay.id(flipped)).toBeNull();
    expect(pay.id(tail)).toBeNull();
    expect(pay.id(token.slice(0, -1))).toBeNull();
    expect(pay.id(`${token}A`)).toBeNull();
    expect(pay.id("")).toBeNull();
    expect(pay.id(`${token.slice(0, 31)}=`)).toBeNull();
    expect(pay.id(signedId("other", 8).token(id))).toBeNull();
    expect(pay.id(signedId("agreement-link", 20).token(id))).toBeNull();
  });
});
