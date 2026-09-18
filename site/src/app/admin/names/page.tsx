import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/admin";
import { listNames } from "@/lib/admin/db";
import { count, when } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Names" };

type Props = { searchParams: Promise<{ m?: string }> };

/**
 * The name library (docs/ADMIN.md §3.9).
 *
 * The one piece of content this panel manages. Two rules run through the whole
 * screen, and both exist to protect people's history rather than the data:
 *
 *   an id is permanent, because every count anyone has ever recorded is stored
 *   under it — in their browser and in counter_components — and renaming one
 *   orphans all of it with no error anywhere;
 *
 *   a name is never deleted, only unpublished, for the same reason. Unpublished
 *   means it stops being offered; anyone who already has counts under it keeps
 *   them and can still see them in their history.
 *
 * The database enforces both with triggers, so this page is not the only thing
 * standing between a busy afternoon and somebody's lost ten years of practice.
 */
export default async function NamesPage({ searchParams }: Props) {
  await requireAdmin();
  const { m } = await searchParams;
  const names = await listNames();

  const published = names.filter((n) => n.published);

  return (
    <>
      <div className="wrap">
        <p className="eyebrow">
          {count(published.length)} offered · {count(names.length - published.length)} hidden
        </p>
        <h1>Names</h1>
        <p className="lede">
          What the counter offers to count. Changes reach the site within a minute — no deploy. An
          id can never be changed and a name is never deleted, because people&rsquo;s counts are
          stored under it.
        </p>

        <div aria-live="polite">{m && <p className="banner">{m}</p>}</div>

        <p className="row-actions">
          <Link className="pill" href="/admin/names/new/">
            Add a name
          </Link>
        </p>

        <div className="scroll">
          <table>
            <caption className="sr-only">The name library, in the order the counter shows it.</caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Name</th>
                <th scope="col">Transliteration</th>
                <th scope="col">Meaning</th>
                <th scope="col">Group</th>
                <th scope="col">Shown</th>
                <th scope="col">Changed</th>
              </tr>
            </thead>
            <tbody>
              {names.map((n) => (
                <tr key={n.id}>
                  <td>{n.position}</td>
                  <td>
                    {/* lang="ar" so a screen reader reads the Arabic as Arabic. */}
                    <Link href={`/admin/names/${n.id}/`} lang="ar" dir="rtl">
                      {n.devanagari}
                    </Link>
                  </td>
                  <td>{n.transliteration}</td>
                  <td className="wrapcell">{n.meaning}</td>
                  <td>{n.grp === "mantra" ? "longer" : "dhikr"}</td>
                  <td>
                    {n.published ? (
                      <span className="pill pill-good">yes</span>
                    ) : (
                      <span className="pill">hidden</span>
                    )}
                  </td>
                  <td>{when(n.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
