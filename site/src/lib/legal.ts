import { SUPPORT_EMAIL } from "./site";

/**
 * The legal copy names its contact address as {{SUPPORT_EMAIL}}, so the address
 * lives in one place (lib/site.ts) and follows the site's domain.
 */
export function withSupportEmail(html: string): string {
  return html.split("{{SUPPORT_EMAIL}}").join(SUPPORT_EMAIL);
}
