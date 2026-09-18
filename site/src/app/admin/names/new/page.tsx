import type { Metadata } from "next";
import Link from "next/link";

import { NameForm } from "@/components/admin/NameForm";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Add a name" };

type Props = { searchParams: Promise<{ m?: string }> };

export default async function NewNamePage({ searchParams }: Props) {
  await requireAdmin();
  const { m } = await searchParams;

  return (
    <>
      <div className="wrap">
        <Link className="back" href="/admin/names/">
          ← Names
        </Link>
        <h1>Add a name</h1>

        <div aria-live="polite">{m && <p className="error">{m}</p>}</div>

        <NameForm />
      </div>
    </>
  );
}
