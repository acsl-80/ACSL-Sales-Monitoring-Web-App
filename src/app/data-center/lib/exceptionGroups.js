/**
 * Exceptions, grouped by what is actually wrong with them.
 *
 * A flat list of 331 reasons is not a worklist. Grouped, the same 331 rows on
 * the real digitisation file turned out to be five problems, and one of them -
 * 122 rows - was fourteen assignments somebody could make in ten minutes. The
 * grouping is the difference between "331 things to do" and "five decisions".
 *
 * The kinds themselves differ per import, so they are passed in. This is only
 * the bucketing, which does not.
 */

/** Sort rows into the first kind whose `test` matches; the last kind catches all. */
export function groupByKind(rows, kinds) {
  const buckets = kinds.map((k) => ({ ...k, rows: [] }));
  for (const r of rows) {
    const why = r.exception_reason ?? r.rejection_reason ?? "";
    (buckets.find((b) => b.test(why)) ?? buckets[buckets.length - 1]).rows.push(r);
  }
  return buckets.filter((b) => b.rows.length > 0);
}

/**
 * The ways a call-sheet row fails, in the order they are worth reading.
 *
 * Every `test` matches a string `validateCallRows` or `commitCallSlice`
 * actually writes. That coupling is real and worth stating: change a reason
 * server-side and the grouping here degrades to "Everything else" silently.
 * The receipt side has the same coupling and the same hazard.
 *
 * `selfHealing` marks the ones nobody should work row by row, because the fix
 * happens elsewhere and re-checking the batch clears them in a batch. That
 * distinction did not exist on the receipt side and is the reason 122 rows
 * were once worked one at a time when fourteen ERP edits would have done it.
 */
export const CALL_EXCEPTION_KINDS = [
  {
    key: "no_sale",
    test: (why) => /has no sale recorded yet/i.test(why),
    title: "The receipt has not been digitalised yet",
    selfHealing: true,
    what:
      "This is the ordinary one, and it is not a mistake in the sheet. A call cannot " +
      "attach to a sale that does not exist yet. Digitalise the receipt through Bulk " +
      "Import, then press Check the rows again and these clear themselves. Nothing " +
      "here needs editing.",
  },
  {
    key: "stale_version",
    test: (why) => /changed in the app after this sheet was downloaded/i.test(why),
    title: "Somebody worked the record after you downloaded",
    selfHealing: false,
    what:
      "The record moved on while the sheet was being filled in, so landing this row " +
      "would overwrite work you never saw. Download the sheet again, look at what the " +
      "record says now, and re-enter only what is still true.",
  },
  {
    key: "no_version",
    test: (why) => /carries no Record Version/i.test(why),
    title: "The sheet is too old to update safely",
    selfHealing: false,
    what:
      "These rows match a record that already exists, but the sheet was built before " +
      "the Record Version column, so there is no way to tell whether it is newer than " +
      "the record. Download a fresh sheet and re-enter them.",
  },
  {
    key: "already_called",
    test: (why) => /already has a call record/i.test(why),
    title: "The record has already been worked",
    selfHealing: false,
    what:
      "Updating an existing record is currently switched off, so these are refused " +
      "rather than merged. Turn on call_import.update_existing in Settings to allow " +
      "corrections, or open each record in the call centre.",
  },
  {
    key: "duplicate",
    test: (why) => /already appears on row/i.test(why),
    title: "The same stove appears twice in this file",
    selfHealing: false,
    what:
      "Only the first row for a stove is used. Delete the repeat, or merge the two rows " +
      "if each carries something the other does not.",
  },
  {
    key: "ambiguous",
    test: (why) => /matches \d+ live sales/i.test(why),
    title: "The stove ID matches more than one sale",
    selfHealing: false,
    what:
      "There is no way to tell which sale this call belongs to, so nothing is written. " +
      "The duplicate sales need settling in the sales app first.",
  },
  {
    key: "out_of_scope",
    test: (why) => /belongs to a partner you do not cover/i.test(why),
    title: "That partner is not assigned to you",
    selfHealing: true,
    what:
      "The stove resolves to a partner outside your coverage. Ask for the partner to be " +
      "assigned to you, then check the rows again; nothing about the sheet is wrong.",
  },
  {
    key: "bad_choice",
    test: (why) => /not one of the choices/i.test(why),
    title: "A cell does not match its dropdown",
    selfHealing: false,
    what:
      "Usually a typo, and the reason names the column and the value. Correct it in the " +
      "sheet using the dropdown, or add the choice in Settings if it should exist, then " +
      "upload again.",
  },
  {
    key: "write_refused",
    test: (why) => /write refused|could not be reached|The record saved but/i.test(why),
    title: "The write itself did not go through",
    selfHealing: false,
    what:
      "These reached the call-record endpoint and it refused them, or the call dates did " +
      "not log. The reason against each row is what it said. Pressing Attach again " +
      "retries only these.",
  },
  {
    key: "other",
    test: () => true,
    title: "Everything else",
    selfHealing: false,
    what: "One row at a time. The reason is printed against each.",
  },
];
