import "server-only";

import { createSign } from "node:crypto";

import { firebaseEnv } from "@/lib/env.server";

/**
 * Sending a push through Firebase Cloud Messaging, HTTP v1.
 *
 * No firebase-admin: two HTTPS calls and one RS256 signature do not justify a
 * dependency that carries a service account's full authority. The service
 * account signs a short JWT, Google exchanges it for an access token scoped to
 * messaging only, and that token sends.
 *
 * The private key is read through env.server and never logged — not the key, not
 * the JWT, not the access token, not a device token.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let cached: { token: string; expiresAt: number } | null = null;

const b64url = (input: string | Buffer) =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** The signed assertion Google exchanges for an access token. */
export function signAssertion(sa: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  // Reused until five minutes before it lapses: a reminder run sends many.
  if (cached && cached.expiresAt - 300_000 > Date.now()) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signAssertion(sa),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) throw new Error(`FCM auth failed (${res.status})`);
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export type PushMessage = { title: string; body: string; link: string };

/** "stale" means the token will never work again: delete that installation. */
export type SendResult = "sent" | "stale" | "failed";

export async function sendPush(deviceToken: string, message: PushMessage): Promise<SendResult> {
  const sa = firebaseEnv().serviceAccount;
  const token = await accessToken(sa);

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: message.title, body: message.body },
        webpush: {
          fcm_options: { link: message.link },
          notification: { icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.ok) return "sent";
  const json = (await res.json().catch(() => ({}))) as {
    error?: { status?: string; details?: { errorCode?: string }[] };
  };
  const code = json.error?.details?.find((d) => d.errorCode)?.errorCode ?? json.error?.status;
  // Only a token FCM says is gone is deleted. INVALID_ARGUMENT is not proof: it is
  // also what a malformed message gets, and treating it as stale would let one
  // bug in the payload wipe every device's registration in a single run.
  if (res.status === 404 || code === "UNREGISTERED") return "stale";
  return "failed";
}

/** Test seam. */
export function clearFcmTokenCache(): void {
  cached = null;
}
