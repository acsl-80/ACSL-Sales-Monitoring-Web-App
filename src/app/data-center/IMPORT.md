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

## Where the file comes from

For a long time this page opened at "choose a file" and never said. The sheet
it wants - one row per transferred stove, with the stove ID and the transfer
reference already filled in and dropdowns on the columns that have fixed
answers - existed the whole time, but only inside **Partner Records**, on a
page somebody visiting Import has no reason to open.

So the two halves of one job lived on two pages, and the page named after the
job held the second half only. People made blank spreadsheets of their own and
typed every stove ID by hand - which is the one error the import cannot recover
from, because a mistyped serial does not look like a typo, it looks like a
stove that is not ours.

The bulk tab now opens on the whole path:

| Step | Where it happens |
|---|---|
| **1. Download the sheet for a partner** | here |
| **2. Fill it in** | Excel, a shared drive, several people, days later |
| **3. Upload it back** | here |

Step two is named even though nothing about it is on screen. Somebody who has
downloaded a sheet and gone quiet for two days has not got stuck; somebody who
has never downloaded one should be able to see that they are missing a step
rather than conclude the upload is broken.

### Why a partner is chosen on the way out and not on the way back

Because the sheet is built **from** that partner's transfers - it cannot exist
without knowing whose stoves to list. Coming back the other way, the stove IDs
in the file already say which partner it is, which is why the upload asks
nothing. The asymmetry is deliberate and is stated on both sides of it.

## The two ways in

| Path | When |
|---|---|
| **A filled-in sheet** | The normal case. A backlog of receipts cleared in one pass |
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

**Import against the Sell Stove form is covered too, and not by this module.**
This section used to say that `create-sale` read a stove's status and then
marked it sold with an unguarded update, so two callers could both read
`available` and both insert. That was true when it was written and is not true
now: commit `d466f2f` claims the stove atomically instead of announcing it,
with `.neq("status", "sold")` on the update and a row-count check that deletes
the sale and answers 409 if the claim was lost. That commit is on `main`.

Two locks, then, at different levels, and both are needed.
`data_center.import_claims` serialises import against import before
`create-sale` is reached at all. `create-sale`'s own conditional update
serialises everything against everything, the mobile app included. Neither
makes the other redundant.

The claim is released when the sale exists. It is a lock held WHILE a batch
commits, so leaving it behind used to make an import once-ever: delete the sale
through the sales app and the stove returns to available, but the claim stayed,
and re-importing that receipt was refused with "Another import is already
committing this stove" - by then neither true nor actionable.

## Rolling back

Rollback deletes each sale through `delete-sale`, which releases the stove to
available as part of its own job. Deleting rows directly would leave stock
believing the stoves were still sold.

**Rollback is refused once the call centre has worked the batch.** This used to
read as a limitation - "what rollback cannot undo" - and it was a deletion.
`delete-sale` hard-deletes the row, and six `data_center` tables cascade off it:
`call_records`, `call_attempts`, `call_drafts`, `assignment_items`,
`shared_phones`, `serial_rematches`. So rolling back after agents have started
calling did not undo an import, it destroyed the calls, silently.

It now counts first and refuses with the number named, because the person
pressing the button cannot see the call records from that screen. A batch with
nothing attached still rolls back exactly as before. If a worked batch genuinely
has to go, the calls come off first, deliberately.

## The other sheet: calls already made

Agents kept their own spreadsheets long before this module existed. One week of
the workbook holds 359 stove IDs, and until Phase 21 the only way in was the
call form, one record at a time. That is not a backlog strategy; it is a reason
the backlog stays where it is.

**It goes the other way from the digitalisation sheet.** That one creates
sales. This one matches them, because a phone call cannot bring a stove into
existence. A row whose stove ID finds no sale is an exception for a person, and
the usual cause is simply that the receipt has not been digitalised yet, which
is why the two imports have an order and this one is second.

| Row lands as | When |
|---|---|
| valid | Its stove ID matches exactly one live sale that has no call record |
| exception | No sale yet, more than one sale, a record already exists, or an option label the registry does not know |
| rejected | No stove ID at all |

Four things it shares with the receipt import and one it does not. Same
`import_batches` and `import_rows`, same staged/validated/committed lifecycle,
same exceptions queue, same slicing. What differs is the write: commit posts to
`data-center-write`, the same `save_call_record` and `log_attempt` the call form
uses, so field visibility, the answers-versus-column routing in `splitPayload`,
the writable-column allowlist and the audit trigger all stay in one place. A
question promoted from jsonb to a real column later needs no change in the
importer.

**The call dates are the reason this could not be thinner.** `call_date_1/2/3`
become `call_attempts` rows. Import a record without them and `attempt_count`
reads 0, which Analysis reports as `never_called` - charging the whole backlog
to a call centre that had in fact rung three times. `log_attempt` already
accepted an explicit `attemptedAt`, so the dates come across, and the outcome
attaches to the last attempt only rather than rewriting the headline three
times and describing the first call as having ended the way the third did.

**Undo removes the call records and nothing else.** It is not the receipt
rollback. Deleting a sale because somebody mis-typed an outcome would be a
worse cure than the disease.

Columns live in `workflow_config` under `call_centre.sheet_columns`; the 13
questions are appended from `field_defs`, so retiring one in Settings takes it
off the sheet with no release.

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

---

# The bench, for somebody typing forty of them

The bulk path is for a backlog already in a spreadsheet. The bench is for the
other half of the same job - receipts as they come in - and the person doing it
is holding a stack of paper and typing the same eleven fields over and over.

## What sat between two records

Opening a stove replaced the whole navigator with the form. So finishing one
receipt and starting the next was: back to the consignment, find your place in
a paginated table of stove IDs, click the next one, wait for it to load. Three
actions and a page change between every two records.

## What sits there now

**The consignment is beside the form, not behind it.** Every stove ID in it, at
a glance, with what has been done to each and one click to switch. The list is
fetched once when the consignment opens and handed to both the table and the
rail, so switching stoves costs no round trip at all.

| | |
|---|---|
| **Progress** | "12 of 40 recorded", with a bar. Typing forty receipts with no sense of how many are left is the part people describe as endless |
| **Search** | matches anywhere in the ID, because the stack of paper is not in the system's order and nobody reads a serial from the front |
| **Save and next** | the whole back-find-click-wait sequence as one button, labelled with how many are left |
| **Ctrl+S** | save a draft, stay here |
| **Ctrl+Enter** | save as finished, open the next one |

The validation behind the button, the shortcut and "save and next" is one
function. Two copies is how one route ends up accepting a record the other
refuses, which is this module's own rule.

A stove turns green in the rail the moment its save returns, via a local flag -
not a placeholder written into `sale_id`, which holds a real id everywhere else.

## Two rules that look alike and are not

The open record is pinned in the rail so that finishing it - which makes it
"recorded", which the "to type" filter drops - does not scroll the list out
from under the form.

That pin does **not** apply to the search. A search is a deliberate act with a
different question behind it: "is PRV000123 in this consignment". Pinning the
open row through a search meant a term matching nothing still showed one row,
so the rail could never answer no - which is the wrong answer for somebody
holding a receipt for a stove that turns out to be in a different consignment.
