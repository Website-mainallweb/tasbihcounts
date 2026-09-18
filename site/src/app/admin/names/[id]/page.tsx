import type { Metadata } from "next";
import Link from "next/link";

import { NameForm } from "@/components/admin/NameForm";
import { requireAdmin } from "@/lib/admin";
import { getName } from "@/lib/admin/db";
import { when } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Edit a name" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string }>;
};

export default async function EditNamePage({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  const { m } = await searchParams;

  const name = await getName(id);

  if (!name) {
    return (
      <>
        <div className="wrap">
          <Link className="back" href="/admin/names/">
            ← Names
          </Link>
          <h1>No such name</h1>
          <p className="note">Nothing in the library has that id.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="wrap">
        <Link className="back" href="/admin/names/">
          ← Names
        </Link>
        <p className="eyebrow">
          id {name.id} · last changed {when(name.updated_at)}
        </p>
        <h1 lang="ar" dir="rtl">{name.devanagari}</h1>

        <div aria-live="polite">{m && <p className="banner">{m}</p>}</div>

        <NameForm name={name} />

        <p className="protected">
          The id <code>{name.id}</code> cannot be changed and this name cannot be deleted. Every
          count recorded under it — in this database and in each person&rsquo;s own browser — is
          filed by that id, and renaming it would orphan all of them without a single error being
          raised anywhere. To stop offering it, set <strong>Shown</strong> to no.
        </p>
      </div>
    </>
  );
}
