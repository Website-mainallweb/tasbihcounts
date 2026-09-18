import { saveName } from "@/app/admin/names/actions";
import type { NameRow } from "@/lib/admin/db";

/**
 * The form behind both "add a name" and "edit a name".
 *
 * One component rather than two nearly identical pages, because the fields must
 * not drift apart: an add form that accepts something the edit form cannot show
 * is how a row ends up uneditable.
 *
 * The id field is the only difference, and it is a real one. On a new name it is
 * typed once and explained; on an existing one it is not a field at all, because
 * it cannot be changed and offering a box that silently does nothing is worse
 * than not offering one.
 */
export function NameForm({ name }: { name?: NameRow }) {
  const isNew = !name;

  return (
    <form className="form" action={saveName}>
      <input type="hidden" name="isNew" value={isNew ? "yes" : "no"} />

      {isNew ? (
        <>
          <label htmlFor="id">Id — permanent, letters and digits only</label>
          <input
            id="id"
            name="id"
            type="text"
            required
            maxLength={64}
            pattern="[a-z0-9]{1,64}"
            placeholder="radhekrsna"
            autoComplete="off"
          />
          <p className="pending">
            Everyone&rsquo;s counts for this name will be stored under this id, in their own browser
            as well as here. It can never be changed afterwards, so choose it as you would a
            filename you will never rename.
          </p>
        </>
      ) : (
        <input type="hidden" name="id" value={name.id} />
      )}

      <label htmlFor="devanagari">Devanagari</label>
      <input
        id="devanagari"
        name="devanagari"
        type="text"
        required
        maxLength={120}
        lang="hi"
        defaultValue={name?.devanagari}
      />

      <label htmlFor="transliteration">Transliteration</label>
      <input
        id="transliteration"
        name="transliteration"
        type="text"
        required
        maxLength={120}
        defaultValue={name?.transliteration}
      />

      <label htmlFor="meaning">Meaning</label>
      <input
        id="meaning"
        name="meaning"
        type="text"
        required
        maxLength={200}
        defaultValue={name?.meaning}
      />

      <label htmlFor="grp">Group</label>
      <select id="grp" name="grp" defaultValue={name?.grp ?? ""}>
        <option value="">Name</option>
        <option value="mantra">Mantra</option>
      </select>

      <label htmlFor="position">Position</label>
      <input
        id="position"
        name="position"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        required
        maxLength={6}
        defaultValue={name?.position ?? 1000}
      />
      <p className="pending">
        Lower comes first. The library is numbered in tens, so 45 puts a name between 40 and 50
        without renumbering anything else.
      </p>

      <label htmlFor="published">Shown in the counter</label>
      <select id="published" name="published" defaultValue={name?.published === false ? "no" : "yes"}>
        <option value="yes">Yes — offered to everyone</option>
        <option value="no">No — hidden from the library</option>
      </select>
      <p className="pending">
        Hiding a name stops it being offered. Nobody loses anything: counts recorded under it stay,
        and their history still shows them.
      </p>

      <button type="submit">{isNew ? "Add this name" : "Save changes"}</button>
    </form>
  );
}
