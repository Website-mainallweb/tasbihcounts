import type { Metadata } from "next";

export const metadata: Metadata = { title: "Not found" };

/**
 * What an outsider sees.
 *
 * requireAdmin() answers a request from someone who is not an administrator with
 * notFound(), which renders this. So it has to look like an ordinary missing
 * page and say nothing at all: no sign-in link, no product name, no hint that
 * there is anything here to sign in to.
 */
export default function NotFound() {
  return (
    <div className="wrap">
      <h1>404</h1>
      <p className="note">This page does not exist.</p>
    </div>
  );
}
