import "server-only";

import { z } from "zod";

/**
 * Server secrets, validated before first use.
 *
 * `server-only` makes importing this from a client component a build error, and
 * eslint restricts who may import it at all (eslint.config.mjs). Values are never
 * logged: a failure names the variable, not its contents.
 *
 * Parsed on first call rather than at module load. Next evaluates route modules
 * while building, and CI builds without secrets; a boot-time parse there would
 * fail every build. The first request that needs a key still fails loudly and
 * immediately if it is missing or truncated.
 */

const supabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(40),
});

const adminSchema = supabaseSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
});

export class MissingEnv extends Error {
  constructor(names: string[]) {
    super(`Missing or invalid server environment: ${names.join(", ")}`);
    this.name = "MissingEnv";
  }
}

function parse<T extends z.ZodType>(schema: T): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    // Paths only. The issue messages can quote the received value.
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    throw new MissingEnv(names);
  }
  return result.data;
}

/** The URL and anon key: public by design, safe only because RLS is on. */
export function supabaseEnv(): { url: string; anonKey: string } {
  const env = parse(supabaseSchema);
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
}

/** The service role key. Only lib/supabase/admin.ts reads it. */
export function supabaseAdminEnv(): { url: string; serviceRoleKey: string } {
  const env = parse(adminSchema);
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

const razorpaySchema = z.object({
  RAZORPAY_KEY_ID: z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]{8,}$/),
  RAZORPAY_KEY_SECRET: z.string().min(16),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(16),
});

/**
 * Razorpay's keys. Test and live keys each come with their own webhook secret;
 * swapping one without the other produces a webhook that silently refuses every
 * real payment (SECURITY §4). Only lib/payments/razorpay.ts reads these.
 */
export function razorpayEnv(): { keyId: string; keySecret: string; webhookSecret: string } {
  const env = parse(razorpaySchema);
  return {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  };
}

const firebaseSchema = z.object({ FIREBASE_SERVICE_ACCOUNT: z.string().min(100) });

export type FirebaseServiceAccount = { project_id: string; client_email: string; private_key: string };

/**
 * The Firebase Admin SDK service account, stored as one line of base64 JSON. It
 * can send push to every registered device, so only lib/push/fcm.ts reads it.
 */
export function firebaseEnv(): { serviceAccount: FirebaseServiceAccount } {
  const env = parse(firebaseSchema);
  let sa: Partial<FirebaseServiceAccount>;
  try {
    sa = JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf8"));
  } catch {
    throw new MissingEnv(["FIREBASE_SERVICE_ACCOUNT"]);
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key?.includes("PRIVATE KEY")) {
    throw new MissingEnv(["FIREBASE_SERVICE_ACCOUNT"]);
  }
  return {
    serviceAccount: { project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key },
  };
}

const cronSchema = z.object({ CRON_SECRET: z.string().min(32) });

/** The shared secret the scheduler presents to /api/cron/reminders. */
export function cronEnv(): { secret: string } {
  return { secret: parse(cronSchema).CRON_SECRET };
}

const adminEmailsSchema = z.object({
  ADMIN_EMAILS: z
    .string()
    .min(3)
    .transform((s) =>
      s
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    )
    .refine((list) => list.length > 0, "at least one valid email"),
});

/** Who may open the admin panel. Comma-separated. Unset means nobody can. */
export function adminEnv(): { emails: string[] } {
  const result = adminEmailsSchema.safeParse(process.env);
  return { emails: result.success ? result.data.ADMIN_EMAILS : [] };
}
