import { createVerify, generateKeyPairSync } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { isValidCronAuth } from "../../src/lib/push/cron-auth";
import { isDue, localClock, WINDOW_MINUTES } from "../../src/lib/push/schedule";

/**
 * Reminders (ARCHITECTURE §6, Phase 11): who is reminded when, the scheduler's
 * credential, and the signature that authorises sending.
 */

/*
 * This file generates a 2048-bit RSA keypair and signs with it, which is real
 * work rather than a slow test. On its own it finishes in about two seconds;
 * sharing four cores with two dozen other workers it crossed the 5s default and
 * failed as a timeout, which reads like a broken signature rather than a busy
 * laptop. Scoped to this file so a genuine hang anywhere else is still caught in
 * five seconds.
 */
vi.setConfig({ testTimeout: 30_000 });

describe("the local clock", () => {
  const instant = new Date("2026-09-10T15:40:00Z");

  test.each([
    ["Asia/Kolkata", "2026-09-10", 21 * 60 + 10], // UTC+5:30
    ["America/New_York", "2026-09-10", 11 * 60 + 40], // UTC-4 in September
    ["Pacific/Kiritimati", "2026-09-11", 5 * 60 + 40], // UTC+14: already tomorrow
    ["UTC", "2026-09-10", 15 * 60 + 40],
  ])("%s", (zone, day, minute) => {
    expect(localClock(instant, zone)).toEqual({ day, minute });
  });
});

describe("isDue", () => {
  const row = { userId: "u", zone: "Asia/Kolkata", remindAt: 21 * 60, lastSentDay: null };
  const ist = (hhmm: string) => new Date(`2026-09-10T${hhmm}:00+05:30`);

  test("due from the reminder time until the window closes", () => {
    expect(isDue(row, ist("20:59")).due).toBe(false);
    expect(isDue(row, ist("21:00"))).toEqual({ due: true, day: "2026-09-10" });
    expect(isDue(row, ist("21:14")).due).toBe(true);
    expect(isDue(row, ist(`21:${WINDOW_MINUTES}`)).due).toBe(false);
  });

  test("never twice on the same local day", () => {
    expect(isDue({ ...row, lastSentDay: "2026-09-10" }, ist("21:05")).due).toBe(false);
    expect(isDue({ ...row, lastSentDay: "2026-09-09" }, ist("21:05")).due).toBe(true);
  });

  test("a reminder just after local midnight belongs to the new day", () => {
    const early = { ...row, remindAt: 5 };
    expect(isDue(early, new Date("2026-09-10T18:35:00Z"))).toEqual({ due: true, day: "2026-09-11" });
  });

  test("an unknown zone is never due rather than crashing the run", () => {
    expect(isDue({ ...row, zone: "Mars/Olympus_Mons" }, ist("21:00"))).toEqual({ due: false, day: "" });
  });
});

describe("the scheduler's secret", () => {
  const secret = "a-long-cron-secret-for-unit-tests-only-0123456789";

  test("the exact bearer secret passes", () => {
    expect(isValidCronAuth(`Bearer ${secret}`, secret)).toBe(true);
  });

  test.each([
    ["nothing", null],
    ["no scheme", secret],
    ["another scheme", `Basic ${secret}`],
    ["a prefix of it", `Bearer ${secret.slice(0, 20)}`],
    ["it with a suffix", `Bearer ${secret}x`],
    ["a different secret of equal length", `Bearer ${"z".repeat(secret.length)}`],
  ])("refuses %s", (_label, header) => {
    expect(isValidCronAuth(header, secret)).toBe(false);
  });

  test("an unset secret refuses everything", () => {
    expect(isValidCronAuth("Bearer ", "")).toBe(false);
  });
});

describe("the FCM assertion", () => {
  test("is an RS256 JWT for the messaging scope, signed by the service account's key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { signAssertion } = await import("../../src/lib/push/fcm");
    const sa = {
      project_id: "unit-test",
      client_email: "sender@unit-test.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };

    const jwt = signAssertion(sa, 1_800_000_000);
    const [header, claims, signature] = jwt.split(".");
    const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(claims)).toEqual({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });
});

describe("which FCM failures delete a device", () => {
  const TOKEN_URL = "https://oauth2.googleapis.com/token";
  const message = { title: "t", body: "b", link: "http://127.0.0.1/" };

  /* One key for every case: a 2048-bit RSA key per call took over 5 s under load
     (the pre-push check timed out on the third case). */
  let privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"] | undefined;
  async function sendWith(reply: Response) {
    privateKey ??= generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const sa = {
      project_id: "unit-test",
      client_email: "sender@unit-test.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT", Buffer.from(JSON.stringify(sa)).toString("base64"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === TOKEN_URL ? Response.json({ access_token: "unit-access", expires_in: 3600 }) : reply,
      ),
    );
    const { sendPush, clearFcmTokenCache } = await import("../../src/lib/push/fcm");
    clearFcmTokenCache();
    try {
      return await sendPush("device-token-for-unit-tests", message);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  }

  test("a delivered message is sent", async () => {
    expect(await sendWith(new Response("{}", { status: 200 }))).toBe("sent");
  });

  test("a token FCM no longer knows is stale", async () => {
    expect(await sendWith(new Response("{}", { status: 404 }))).toBe("stale");
    expect(
      await sendWith(
        Response.json(
          { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } },
          { status: 400 },
        ),
      ),
    ).toBe("stale");
  });

  test("INVALID_ARGUMENT is a failure, not a stale token — a payload bug must not wipe every device", async () => {
    expect(
      await sendWith(Response.json({ error: { status: "INVALID_ARGUMENT" } }, { status: 400 })),
    ).toBe("failed");
  });

  test("a server error is a failure", async () => {
    expect(await sendWith(new Response("{}", { status: 503 }))).toBe("failed");
  });
});

describe("the reminder run", () => {
  const SECRET = "s".repeat(48);

  async function runTwiceAtOnce(opts: { practised: boolean }) {
    vi.resetModules();
    const claimed = new Set<string>();
    const sent: string[] = [];
    vi.doMock("@/lib/push/cron-secret", () => ({ cronEnvSecret: () => SECRET }));
    vi.doMock("@/lib/push/fcm", () => ({
      sendPush: async (token: string) => {
        sent.push(token);
        return "sent";
      },
    }));
    vi.doMock("@/lib/push/store", () => ({
      reminderStore: () => ({
        candidates: async () => [{ userId: "u1", zone: "UTC", remindAt: 0, lastSentDay: null }],
        claimDay: async (userId: string, day: string) => {
          const key = `${userId}|${day}`;
          if (claimed.has(key)) return false;
          claimed.add(key);
          return true;
        },
        practised: async () => opts.practised,
        tokens: async () => [{ sourceId: "phone", token: "tok-phone" }],
        dropToken: async () => {},
      }),
    }));

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T00:05:00Z")); // 00:05 UTC, inside a 00:00 reminder's window
    try {
      const { POST } = await import("../../src/app/api/cron/reminders/route");
      const call = () =>
        POST(new Request("http://127.0.0.1/api/cron/reminders", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      const replies = await Promise.all([call(), call()]);
      return { sent, claimed, summaries: await Promise.all(replies.map((r) => r.json())) };
    } finally {
      vi.useRealTimers();
      vi.doUnmock("@/lib/push/cron-secret");
      vi.doUnmock("@/lib/push/fcm");
      vi.doUnmock("@/lib/push/store");
    }
  }

  test("two overlapping runs send one reminder, because the day is claimed before sending", async () => {
    const { sent, claimed } = await runTwiceAtOnce({ practised: false });
    expect(sent).toEqual(["tok-phone"]);
    expect([...claimed]).toEqual(["u1|2026-09-10"]);
  });

  test("a day already practised is claimed and sends nothing", async () => {
    const { sent, claimed, summaries } = await runTwiceAtOnce({ practised: true });
    expect(sent).toEqual([]);
    expect([...claimed]).toEqual(["u1|2026-09-10"]);
    expect(summaries.reduce((n, s) => n + s.alreadyPractised, 0)).toBe(1);
  });

  test("a wrong secret runs nothing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/push/cron-secret", () => ({ cronEnvSecret: () => SECRET }));
    try {
      const { POST } = await import("../../src/app/api/cron/reminders/route");
      const res = await POST(new Request("http://127.0.0.1/api/cron/reminders", { method: "POST", headers: { authorization: "Bearer nope" } }));
      expect(res.status).toBe(401);
    } finally {
      vi.doUnmock("@/lib/push/cron-secret");
    }
  });
});
