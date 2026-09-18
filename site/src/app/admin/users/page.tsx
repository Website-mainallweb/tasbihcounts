import type { Metadata } from "next";
import Link from "next/link";

import { requireAdmin } from "@/lib/admin";
import { listUsers, type UserFilter } from "@/lib/admin/db";
import { ago, count, when } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Users" };

const PER_PAGE = 50;

const FILTERS: [UserFilter, string][] = [
  ["all", "Everyone"],
  ["premium", "Premium"],
  ["free", "Free"],
  ["unconfirmed", "Never confirmed"],
];

type Props = { searchParams: Promise<{ q?: string; filter?: string; page?: string }> };

/**
 * The user list (docs/ADMIN.md §3.2).
 *
 * Search, filter and paging all live in the query string rather than in client
 * state. That keeps the page a server component with no JavaScript of its own,
 * and it means a particular view — "premium accounts, page 2" — is a link that
 * can be bookmarked or pasted into an email.
 */
export default async function UsersPage({ searchParams }: Props) {
  await requireAdmin();
  const params = await searchParams;

  const q = (params.q ?? "").slice(0, 320);
  const filter = (FILTERS.find(([key]) => key === params.filter)?.[0] ?? "all") as UserFilter;
  const page = Math.max(1, Number(params.page) || 1);

  const rows = await listUsers(q, filter, PER_PAGE, (page - 1) * PER_PAGE);
  const total = rows[0] ? Number(rows[0].total_rows) : 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const link = (to: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (filter !== "all") next.set("filter", filter);
    if (to > 1) next.set("page", String(to));
    const query = next.toString();
    return query ? `/admin/users/?${query}` : "/admin/users/";
  };

  const exportQuery = new URLSearchParams({ q, filter }).toString();

  return (
    <>
      <div className="wrap">
        <p className="eyebrow">{count(total)} matching</p>
        <h1>Users</h1>

        <form className="toolbar" method="get">
          <div>
            <label htmlFor="q">Email contains</label>
            <input id="q" name="q" type="text" defaultValue={q} maxLength={320} placeholder="name@example.com" />
          </div>
          <div>
            <label htmlFor="filter">Show</label>
            <select id="filter" name="filter" defaultValue={filter}>
              {FILTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit">Search</button>
          <a className="pill" href={`/admin/users/export/?${exportQuery}`}>
            Export CSV
          </a>
        </form>

        {rows.length === 0 ? (
          <p className="note">No account matches that.</p>
        ) : (
          <div className="scroll">
            <table>
              <caption className="sr-only">
                Accounts, newest first. Page {page} of {pages}.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">Purchases</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/admin/users/${u.id}/`}>{u.email}</Link>
                    </td>
                    <td>
                      {u.premium ? <span className="pill pill-good">Premium</span> : <span className="pill">Free</span>}
                    </td>
                    <td>{when(u.created_at)}</td>
                    <td>{ago(u.last_sign_in)}</td>
                    <td>{count(u.purchases)}</td>
                    <td>
                      {u.banned_until && new Date(u.banned_until) > new Date() ? (
                        <span className="pill pill-bad">Suspended</span>
                      ) : u.confirmed_at ? (
                        <span className="pill">Confirmed</span>
                      ) : (
                        <span className="pill pill-bad">Unconfirmed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <nav className="pager" aria-label="Pages">
            {page > 1 && <Link href={link(page - 1)}>← Previous</Link>}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages && <Link href={link(page + 1)}>Next →</Link>}
          </nav>
        )}
      </div>
    </>
  );
}
