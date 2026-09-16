import { Migration } from '@mikro-orm/migrations';

/**
 * Repair filenames that were stored as the latin1 rendering of their UTF-8 bytes.
 *
 * Until `defParamCharset: 'utf8'` was set on the multipart parser, busboy decoded every filename
 * as latin1, so "ໃບສະເໜີ.pdf" was stored as "à»àºàºªàº°à»à»àºµ.pdf" — one Unicode character per byte
 * of the original UTF-8. Such a string is recoverable without guessing: every character is ≤
 * U+00FF, so re-encoding it as LATIN1 yields the original bytes exactly, and decoding those as
 * UTF-8 gives the name the uploader wrote. The guard is what makes this safe to run twice and
 * safe on names that were never damaged:
 *   - a name with any character above U+00FF (already-correct Lao, Thai, Chinese) is not latin1
 *     and is skipped by the regex;
 *   - a pure-ASCII name has no byte ≥ 0x80 and is skipped;
 *   - a genuine Latin-1 name (é, ü) whose bytes are not valid UTF-8 makes convert_from raise;
 *     the per-row exception block catches it and leaves the row alone.
 * Only the display name changes; `file_path` (the object key) is untouched — the object is where
 * it is, and a key that points at nothing is worse than an ugly one.
 *
 * `down` is a no-op: the garbled text carries no information the repaired text lacks.
 */
export class Migration20260917100000 extends Migration {
  override async up(): Promise<void> {
    for (const table of ['document_attachment', 'payment_attachment']) {
      this.addSql(`
        do $$
        declare r record; fixed text;
        begin
          for r in
            select id, file_name from "${table}"
             where file_name ~ '^[\\x01-\\xFF]*$' and file_name ~ '[\\x80-\\xFF]'
          loop
            begin
              fixed := convert_from(convert_to(r.file_name, 'LATIN1'), 'UTF8');
              if fixed is distinct from r.file_name then
                update "${table}" set file_name = fixed where id = r.id;
              end if;
            exception when others then
              -- not valid UTF-8 once re-encoded: a real Latin-1 name, leave it as it is
              null;
            end;
          end loop;
        end $$;
      `);
    }
  }

  override async down(): Promise<void> {
    // Nothing to restore: the pre-repair text was the same bytes misread, not different data.
  }
}
