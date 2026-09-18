import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The data access layer's contract (SECURITY §3), without a network:
 *   - a user is resolved with getUser(), never getSession()
 *   - no valid credential means Unauthorized, and nothing about why
 *   - a bearer token is checked for shape before any client is built
 */

const getUser = vi.fn();
const getSession = vi.fn(() => {
  throw new Error("getSession() trusts the cookie; the DAL must never call it");
});
const rpc = vi.fn();
const fakeClient = { auth: { getUser, getSession }, rpc };

type ClientFactory = (...args: unknown[]) => typeof fakeClient;
const createServerClient = vi.fn<ClientFactory>(() => fakeClient);
const createClient = vi.fn<ClientFactory>(() => fakeClient);

vi.mock("@supabase/ssr", () => ({ createServerClient: (...a: unknown[]) => createServerClient(...a) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (...a: unknown[]) => createClient(...a) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

// Obviously fake: long enough for the schema, nothing like a real key.
const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://unit-test.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "unit-test-anon-key-".padEnd(48, "x"),
  SUPABASE_SERVICE_ROLE_KEY: "unit-test-service-key-".padEnd(48, "x"),
};

const TOKEN = "header.payload.signature-long-enough";
const someone = { id: "00000000-0000-4000-8000-00000000000a", email: "a@test.local" };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const dal = () => import("../../src/lib/dal");

describe("requireUser (session cookie)", () => {
  test("returns the verified user and a client acting as them", async () => {
    getUser.mockResolvedValue({ data: { user: someone }, error: null });
    const { requireUser } = await dal();
    const authed = await requireUser();
    expect(authed.user).toEqual(someone);
    expect(authed.supabase).toBe(fakeClient);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getSession).not.toHaveBeenCalled();
  });

  test("is built on the anon key, never the service role key", async () => {
    getUser.mockResolvedValue({ data: { user: someone }, error: null });
    const { requireUser } = await dal();
    await requireUser();
    expect(createServerClient.mock.calls[0][1]).toBe(ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    expect(JSON.stringify(createServerClient.mock.calls)).not.toContain(ENV.SUPABASE_SERVICE_ROLE_KEY);
  });

  test.each([
    ["no user", { data: { user: null }, error: null }],
    ["an auth error", { data: { user: null }, error: { message: "invalid JWT" } }],
  ])("throws Unauthorized on %s", async (_label, result) => {
    getUser.mockResolvedValue(result);
    const { requireUser, Unauthorized } = await dal();
    await expect(requireUser()).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe("requireBearerUser (sync endpoint)", () => {
  const req = (auth?: string) =>
    new Request("http://localhost/api/sync", { method: "POST", headers: auth ? { authorization: auth } : {} });

  test.each([
    ["no header", undefined],
    ["a different scheme", `Basic ${TOKEN}`],
    ["an empty token", "Bearer "],
    ["a token too short to be a JWT", "Bearer abc"],
    ["a token with spaces", "Bearer abc def ghi jkl mno pqr"],
  ])("refuses %s without building a client", async (_label, header) => {
    const { requireBearerUser, Unauthorized } = await dal();
    await expect(requireBearerUser(req(header))).rejects.toBeInstanceOf(Unauthorized);
    expect(createClient).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  test("verifies the token with the auth server and sends it on every query", async () => {
    getUser.mockResolvedValue({ data: { user: someone }, error: null });
    const { requireBearerUser } = await dal();
    const authed = await requireBearerUser(req(`Bearer ${TOKEN}`));

    expect(authed.user).toEqual(someone);
    expect(getUser).toHaveBeenCalledWith(TOKEN);
    const options = createClient.mock.calls[0][2] as { global: { headers: Record<string, string> } };
    expect(options.global.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(createClient.mock.calls[0][1]).toBe(ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  });

  test("throws Unauthorized when the auth server rejects the token", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    const { requireBearerUser, Unauthorized } = await dal();
    await expect(requireBearerUser(req(`Bearer ${TOKEN}`))).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe("requirePremium", () => {
  test("asks the database, and only a literal true passes", async () => {
    const { requirePremium, PremiumRequired } = await dal();
    const authed = { user: someone, supabase: fakeClient } as never;

    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(requirePremium(authed)).resolves.toBe(authed);
    expect(rpc).toHaveBeenCalledWith("my_premium");

    for (const result of [
      { data: false, error: null },
      { data: "true", error: null },
      { data: null, error: { message: "boom" } },
    ]) {
      rpc.mockResolvedValueOnce(result);
      await expect(requirePremium(authed)).rejects.toBeInstanceOf(PremiumRequired);
    }
  });
});

describe("authErrorResponse", () => {
  test("says only the status, and rethrows anything else", async () => {
    const { authErrorResponse, Unauthorized, PremiumRequired } = await dal();

    const r401 = authErrorResponse(new Unauthorized());
    expect(r401.status).toBe(401);
    expect(await r401.json()).toEqual({ error: "Unauthorized" });

    expect(authErrorResponse(new PremiumRequired()).status).toBe(403);

    const other = new Error("database down");
    expect(() => authErrorResponse(other)).toThrow(other);
  });
});

describe("server environment", () => {
  test("a missing key names the variable and never prints a value", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { supabaseAdminEnv, MissingEnv } = await import("../../src/lib/env.server");
    let thrown: unknown;
    try {
      supabaseAdminEnv();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingEnv);
    expect((thrown as Error).message).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect((thrown as Error).message).not.toContain(ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  });

  test("a malformed URL is refused", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    const { supabaseEnv, MissingEnv } = await import("../../src/lib/env.server");
    expect(() => supabaseEnv()).toThrow(MissingEnv);
  });
});
