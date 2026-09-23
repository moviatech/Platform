import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ opsOrigin: "https://ops.moviatech.ai", websiteOrigin: "https://www.moviatech.ai" }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: (value: string) => value, encryptSecret: (value: string) => value }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { value: { access: "token", refresh: "refresh", expiresAt: new Date(Date.now() + 3600000).toISOString() } } }),
        }),
      }),
    }),
  }),
}));

const { TeslaError, vehicleProfile, vehicleSnapshot } = await import("./client");

type Fetch = (url: string) => Promise<Response>;
const reply = (status: number, body: unknown) => ({ ok: status === 200, status, json: async () => body }) as Response;
const awake = { response: { state: "online", charge_state: { battery_level: 81 }, vehicle_state: { odometer: 1234.6, locked: true }, vehicle_config: { exterior_color: "PearlWhite" }, drive_state: { latitude: 33.6, longitude: -117.8 } } };

describe("vehicle data", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads odometer, charge and colour", async () => {
    const fetchMock = vi.fn<Fetch>(async () => reply(200, awake));
    vi.stubGlobal("fetch", fetchMock);
    await expect(vehicleProfile("7SAYGDEE0TA000001")).resolves.toEqual({ odometer: 1235, battery: 81, color: "PearlWhite" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/1/vehicles/7SAYGDEE0TA000001/vehicle_data?endpoints=charge_state%3Bvehicle_state%3Bvehicle_config");
  });

  it("does not wake a sleeping car unless asked", async () => {
    const fetchMock = vi.fn<Fetch>(async () => reply(408, null));
    vi.stubGlobal("fetch", fetchMock);
    await expect(vehicleProfile("7SAYGDEE0TA000001")).rejects.toMatchObject({ code: "asleep" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("wakes the car and reads again", async () => {
    const replies = [reply(408, null), reply(200, {}), reply(408, null), reply(200, awake)];
    const fetchMock = vi.fn<Fetch>(async () => replies.shift() ?? reply(500, null));
    vi.stubGlobal("fetch", fetchMock);
    const pending = vehicleSnapshot("7SAYGDEE0TA000001", { wake: true });
    await vi.advanceTimersByTimeAsync(7000);
    await expect(pending).resolves.toMatchObject({ odometer: 1235, battery: 81, locked: true, latitude: 33.6 });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/wake_up");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reports other failures with the status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(404, { error: "not_found" })));
    await expect(vehicleProfile("7SAYGDEE0TA000001")).rejects.toBeInstanceOf(TeslaError);
    await expect(vehicleProfile("7SAYGDEE0TA000001")).rejects.toMatchObject({ code: "http_404" });
  });
});
