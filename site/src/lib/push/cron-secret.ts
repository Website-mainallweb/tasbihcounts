import "server-only";

import { cronEnv } from "@/lib/env.server";

/** The scheduler's shared secret. Kept out of the route so the route does not import env.server. */
export function cronEnvSecret(): string {
  return cronEnv().secret;
}
