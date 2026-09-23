import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export function signedId(label: string, macBytes: number) {
  const size = 16 + macBytes;
  const pattern = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((size * 4) / 3)}}$`);
  const mac = (raw: Buffer) => {
    const key = createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "movia").update(label).digest();
    return createHmac("sha256", key).update(raw).digest().subarray(0, macBytes);
  };
  return {
    token(id: string) {
      const raw = Buffer.from(id.replace(/-/g, ""), "hex");
      return Buffer.concat([raw, mac(raw)]).toString("base64url");
    },
    id(token: string) {
      if (!pattern.test(token)) return null;
      const bytes = Buffer.from(token, "base64url");
      if (bytes.length !== size) return null;
      const raw = bytes.subarray(0, 16);
      if (!timingSafeEqual(bytes.subarray(16), mac(raw))) return null;
      const hex = raw.toString("hex");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  };
}
