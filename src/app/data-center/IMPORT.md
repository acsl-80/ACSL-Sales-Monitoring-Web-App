# Bulk import: what it does and what it cannot undo

Written for whoever runs an import, and for whoever has to explain afterwards
why the stock figures moved.

## Why this exists at all

One week of the call centre workbook holds **359 stove serials**. The whole
sales app holds **38 sales**. Of those 359, 329 exist in stock and **328 of them
are still marked available**.

Paper and Excel are the real system of record today. Without import, the Data
Center computes over almost nothing.

## The four steps, and why it is not one button

| Step | What happens | What changes in the sales app |
|---|---|---|
| **Stage** | Rows land in `data_center`, raw payload kept | nothing |
| **Validate** | Each row checked, serials matched against stock | nothing |
| **Dry run** | What a commit *would* do, written down | nothing |
| **Commit** | Sales created through `create-sale` | **stock moves from available to sold** |

Committing a real backlog marks hundreds of stoves sold and visibly changes the
sales app's own inventory figures. That is the correct outcome. It is also not
something anyone should meet by surprise, which is the whole reason the first
three steps exist separately.

## Three outcomes per row, not two

This is the part most easily got wrong.

| Outcome | Meaning | Who fixes it |
|---|---|---|
| **Valid** | Ready to commit | nobody |
| **Exception** | The serial does not match stock, belongs to another partner, or is already sold | a person, with the receipt |
| **Rejected** | The row cannot be read at all: no name, no address, an impossible phone number | a person, in the source file |

**An exception is the normal path.** Roughly one serial in twelve misses in a
real workbook, including malformed ones like `10110` or `10105682` against a
nine-digit norm. Treating that as failure would throw away 8% of the backlog.
The exceptions queue lets someone type the correct serial and put the row back.

A correction that does not actually resolve the problem stays an exception with
the new reason, rather than becoming valid and failing later at commit.

Since Phase 8b a fourth cause routes here: **the same serial twice in one
file.** The first occurrence is treated normally and the repeat becomes an
exception naming the row it repeats. Before that it imported twice, and the
second copy failed at commit as a stove-already-sold error, which reads as a
stock problem rather than the typing one it is.

## The two ways in

| Path | When |
|---|---|
| **A CSV** | The normal case. A backlog of receipts cleared in one pass |
| **One typed record** | A receipt that turns up on its own, or a rejected row being re-keyed |

Manual entry submits as a batch of one and goes through the same validator,
stock check, exceptions queue, dry run and commit. It is deliberately not a
shortcut: a second write path with its own rules is how the two drift apart,
and the cheaper-looking one ends up accepting records the file path refuses.

It follows `import.upload`, the same grant the file path follows, because
staging is what it does. Committing stays separately gated.

## What the importer says before it writes anything

An unrecognised column used to be dropped in silence. A workbook whose phone
column was headed "Mobile No." imported cleanly with no phone numbers in it,
and the first anyone knew was the call centre having nobody to ring.

So `inspect` runs on the headers first and reports three things:

| | |
|---|---|
| **Understood** | Each header and the field it feeds |
| **Not recognised** | Each stray header, with somewhere to map it |
| **Nothing feeds** | Required fields no column supplies, named before staging |

It only stops when there is something to decide. A file whose columns are all
recognised goes straight through, because a confirmation nobody can fail is a
click that trains people to click.

The row cap is stated here too, with the file's own count beside it, rather
than being discovered after the upload.

## Uploading the same file twice

An ordinary mistake: two people clear the same envelope, or someone is not sure
the first attempt worked. It used to produce a second batch and a second set of
sales, with the stove claim as the only thing stopping it, which turns a
mistake into a queue of exceptions rather than a warning.

Each batch now carries a SHA-256 of its **parsed rows**, not of the file, so
re-saving a spreadsheet without changing its contents still matches.

A repeat warns and offers to proceed. It is never a hard block: a partner can
legitimately return the same serials after a correction, and refusing that
outright sends someone off to edit the file until it is accepted.

## Which transfer a record belongs to

Resolved at validate, through `v_transfer_stoves`, the same chain Partner
Records counts. That is the point of using it rather than a second lookup: a
record and the funnel cannot disagree about which consignment a sale came from.

`import_rows.transaction_id` is nullable on purpose. A serial that matches no
transfer is an exception a human works, not a row to refuse.

## Verified end to end

Against the 500,000-row local database, a 24-row file:

```
validate    20 valid, 2 exceptions, 2 rejected
dry run     20 stoves would move from available to sold, nothing changed
exceptions  "Stove serial NOTREAL001 is not in stock records"
            "Stove serial 10110 is not in stock records"
rejected    "Phone number 12345 is not a valid Nigerian number"
            "No residential address"
resolve     one exception corrected, becomes valid
commit      21 committed, 0 failed
rollback    21 reversed, stock back to 2000 available, 0 sold
```

## The race, and what it does and does not cover

Two imports containing the same stove, committed at the same instant:

```
A: 0 committed, 1 failed  "Another import is already committing this stove"
B: 1 committed, 0 failed
   1 sale exists for that serial. Exactly one is correct.
```

That works because the claim is taken in `data_center.import_claims`, whose
primary key is the lock, **before** `create-sale` is called at all.

**It does not cover import against the Sell Stove form.** `create-sale` reads a
stove's status, inserts a sale, then marks the stove sold with no guard on the
update:

```sql
select status from stove_ids where stove_id = $1     -- 'available'
insert into sales ...
update stove_ids set status = 'sold', sale_id = $2   -- unconditional
```

Two callers can both read `available` and both insert. That is a pre-existing
defect in the sales app, not something this module introduced, and `create-sale`
is a shared function this module does not edit. Closing it properly means adding
`.eq("status", "available")` to that update and checking the affected row count,
which is a small change to a live function and therefore a decision rather than
a cleanup.

## Rolling back

Rollback deletes each sale through `delete-sale`, which releases the stove to
available as part of its own job. Deleting rows directly would leave stock
believing the stoves were still sold.

**What rollback cannot undo:** anything that happened to those sales in between.
If the call centre has already worked a record, or a partner has seen the
figures, putting the sale back does not unwind that. Rollback is for "this
import was wrong", soon after, not for reversing a month of activity.

## Things that are settings, not code

In `data_center.workflow_config`:

| Key | What it controls |
|---|---|
| `import.slice_size` | Rows committed per invocation. Default 25 |
| `import.require_paper_agreement` | Whether a digitalized receipt may assert the six terms |
| `import.max_rows` | Rows accepted in one file. Default 20,000, shown in the UI before upload |
| `import.warn_on_duplicate_upload` | Whether an identical file warns. Default on |

## The terms question, answered

`create-sale` requires all six consents and does **not** require a drawn
signature. A digitalized receipt has an ink signature and a paper agreement, so
the import sets the six consents true and supplies no signature.

That is an assertion that the customer accepted the terms on paper, because they
did. It is recorded as a setting rather than buried in code so that if it ever
stops being true, turning it off is an update rather than a release.

## What is not built

- **No scheduled job.** Committing is driven by the operator, one bounded slice
  per request, with the client asking again until the batch is done. Nothing
  runs unattended. A cron would need to answer "who authorised this" and there
  is no good answer yet.
- **No Excel.** CSV only. Exporting a sheet to CSV is one step and writing an
  XLSX reader is not.
- **No saved mappings.** A mapping is recorded on the batch that used it, so a
  batch can be explained months later when nobody remembers what "Col 7" was.
  It is not offered back on the next upload. Worth adding once the same partner
  has sent the same odd headers twice.
- **No partial-batch commit by selection.** A batch commits every valid row.
  Excluding some means fixing the file or resolving them as exceptions.
