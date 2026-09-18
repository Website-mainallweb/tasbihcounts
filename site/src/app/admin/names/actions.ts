"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { audit } from "@/lib/admin/audit";
import { getName, upsertName } from "@/lib/admin/db";

/**
 * Editing the name library (docs/ADMIN.md §3.9).
 *
 * The id is accepted only when creating. On an edit it is read from the row that
 * already exists and the submitted one is ignored — the database refuses to
 * change it anyway, but a form field that silently does nothing is worse than no
 * field at all, so the edit page does not offer one.
 */

const shape = z.object({
  // Lower-case letters, digits and single hyphens, like every existing id. Deliberately narrow:
  // this string ends up as a key in people's local storage and in a database
  // column, and it is permanent.
  id: z
    .string()
    .trim()
    .toLowerCase()
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lower-case letters, digits and hyphens only"),
  // The column is named devanagari (a shared schema); it holds the Arabic.
  devanagari: z.string().trim().min(1).max(300),
  transliteration: z.string().trim().min(1).max(300),
  meaning: z.string().trim().min(1).max(300),
  grp: z.enum(["", "mantra"]),
  position: z.coerce.number().int().min(0).max(100000),
  published: z.enum(["yes", "no"]),
});

function back(where: string, message: string): never {
  redirect(`${where}?m=${encodeURIComponent(message)}`);
}

export async function saveName(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const isNew = formData.get("isNew") === "yes";
  const parsed = shape.safeParse({
    id: formData.get("id"),
    devanagari: formData.get("devanagari"),
    transliteration: formData.get("transliteration"),
    meaning: formData.get("meaning"),
    grp: formData.get("grp") ?? "",
    position: formData.get("position"),
    published: formData.get("published") ?? "no",
  });

  const returnTo = isNew ? "/admin/names/new/" : `/admin/names/${String(formData.get("id") ?? "")}/`;
  if (!parsed.success) {
    back(returnTo, parsed.error.issues[0]?.message ?? "That could not be saved.");
  }

  const row = {
    id: parsed.data.id,
    devanagari: parsed.data.devanagari,
    transliteration: parsed.data.transliteration,
    meaning: parsed.data.meaning,
    grp: parsed.data.grp === "mantra" ? ("mantra" as const) : null,
    position: parsed.data.position,
    published: parsed.data.published === "yes",
  };

  const existing = await getName(row.id);

  if (isNew && existing) {
    back(
      "/admin/names/new/",
      `${row.id} already exists. Ids are permanent, so this one cannot be reused — pick another.`,
    );
  }
  if (!isNew && !existing) back("/admin/names/", "That name no longer exists.");

  await upsertName(row, isNew);

  await audit(admin, {
    action: isNew ? "name.create" : "name.update",
    subject: row.id,
    before: existing
      ? {
          devanagari: existing.devanagari,
          transliteration: existing.transliteration,
          meaning: existing.meaning,
          grp: existing.grp,
          position: existing.position,
          published: existing.published,
        }
      : null,
    after: row,
  });

  // The home page carries the library and regenerates every minute, so this is
  // only about closing that minute — so that opening the site after a save shows
  // the new name rather than the old one. Best effort, and its failure is not
  // the action's failure: the edit is already saved either way.
  // The home page carries the name library and regenerates every minute. This
  // drops its cached copy now, so opening the site after a save shows the new
  // name rather than the old one for up to a minute.
  revalidatePath("/", "layout");

  revalidatePath("/admin/names");
  back("/admin/names/", isNew ? `Added ${row.transliteration}.` : `Saved ${row.transliteration}.`);
}
