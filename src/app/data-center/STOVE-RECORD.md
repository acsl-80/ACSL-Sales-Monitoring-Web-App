# The stove record, and the period control

Two things that cut across every surface in the module. Read this before
changing either, because both exist to stop the module disagreeing with itself.

## The stove ID is the anchor

Everything the Data Centre knows hangs off one serial. The ERP issues it, a
transfer sends it to a partner, a receipt turns it into a sale, an import or a
digitiser types that receipt up, a call agent rings the buyer, and somebody may
send it back to Sales to be corrected. Those live in nine different tables.

`/data-center/stove/<id>` gathers all of them. One request, one page.

### Where each section comes from

| Section | Source |
|---|---|
| Where it came from | `public.stove_ids_base` |
| The transfer | `data_center.transfer_funnel` via `v_transfer_stoves` |
| The sale | `public.sales` + `addresses` + `payment_models` + `uploads` |
| What was in the box | the same `public.sales` row (pots, wonderbox, cooking habits, terms) |
| Paperwork | `sales.signature`, `stove_image_id`, `agreement_image_id` |
| Verification | `data_center.call_records`, dropdown ids resolved to labels |
| Every call | `data_center.call_attempts` |
| How it got here | `data_center.import_rows` joined to `import_batches` |
| Everything that changed | `data_center.change_log` for that sale and its assignment batch |

Matched on the serial **as well as** the sale for provenance, because a row that
was rejected never got a `sale_id` and those are exactly the ones somebody is
trying to account for.

### The journey strip

`journey.js` holds it, deliberately apart from the component. It is the module's
reconciliation funnel restated for one stove: issued, transferred, paper back,
sold, typed up, called, verified. The partner scorecards count exactly these
stages across a batch and the dashboard rolls those up again. A page that
invented its own stage names would be a third definition of the same thing, and
the first question anybody asked would be why the page and the scorecard
disagree.

Two stages have no timestamp anywhere and say so rather than borrowing a
neighbouring date. "Done, at some unknown time" is honest; implying the stove
was built the day it shipped is not.

### Every name that is a thing is a door

The partner opens Partner Records **at** that partner, the rep opens their
records, the agent opens their queue, a neighbour on the same consignment opens
its own record. Nothing on this page is a private copy of another surface — if a
destination does not exist yet, add the destination rather than reproducing it
here.

When adding a link: a link with text content takes its accessible name from that
text. Put the explanation in `title`, never in `aria-label`, or a voice-control
user loses the ability to say what they can see.

### Finding one

`StoveFinder` takes either of the two things written on paper: the serial off
the label, or the reference off the consignment note. An exact serial navigates
rather than listing a result of one. A partial serial is a shortlist, because
half a number read off a scuffed label is the normal case and refusing it sends
the person back to the paper.

It runs on submit, not on keystroke. A serial is fifteen characters typed in one
go, and a request per character is fourteen requests whose answers nobody reads.

## One stove, one owner, one phone

Both rules are enforced in `create-sale`, which is the only door a sale comes
through — the Sell Stove form, the digitalisation workbench and the bulk import
all commit that way. It refuses a serial whose stock row reads `sold`, and
refuses a phone whose **last ten digits** already appear on a live sale.

The last ten digits is the comparison key everywhere, so the country code makes
no difference. All of these are one subscriber:

```
08031234567   +2348031234567   234 803 123 4567
00234-803-123-4567   8031234567   +234 (0) 803 123 4567
```

The last of those matters more than it looks: a spreadsheet reads `08031234567`
as a number and eats the leading zero. `_shared/nigerian-phone.ts` normalises on
the way in; the tail comparison catches whatever got past it.

The stove record asks whether the number appears anywhere else and says so
loudly if it does. It is empty in a healthy register, and it is asked anyway,
because the consequence of a duplicate is quiet: an agent rings the number, is
told about a different stove, and marks the wrong record verified.

`idx_sales_phone_tail` makes that check an index lookup. It is **not** unique —
see ROADMAP Phase 16 for why that is a question for the owner rather than a
decision this module takes.

## The period control

One definition of "when" for every surface. `lib/period.ts` resolves a period to
the two values every surface already speaks, `dateFrom` and `dateTo`.

Days, calendar weeks, months, quarters, half a year, whole years picked several
at a time, or a custom range. **This year by default.**

Weeks run Monday to Sunday. `getDay()` calls Sunday 0, so the naive formula
makes Sunday belong to the week that has not started yet - checked against
every day of a week rather than assumed, because that off-by-one only shows on
the day fewest people are looking.

### Rules

- **It lives in the URL.** Same rule as every other narrowing here: back
  restores it, and a filtered view can be sent to somebody. `thisYear` is
  omitted from the URL entirely so an unfiltered link stays clean.
- **One page, one param per question.** `usePeriod(routeId, param)` names the
  search key. The Call Centre stacks the queue (about when a stove was sold)
  over the assignment log (about when work was handed out), so they use
  `period` and `logPeriod`. Sharing one value would mean narrowing the log
  silently re-narrowed the queue.
- **A dashboard drill that names dates outranks it.** Following "March" from a
  chart is a request for March. The control steps aside rather than displaying
  a period the table is not on.
- **A gap is admitted.** Picking 2024 and 2026 asks for a range, and a range
  contains 2025. The control says so rather than quietly widening the answer.
- **Only years the register holds are offered.** `period_bounds` supplies the
  earliest date, cached for the session. An empty year on the menu reads as a
  year with no sales rather than a year that never existed.

### Which date each surface filters on

| Surface | Column |
|---|---|
| Stove Records | `sales.sales_date` |
| Call queue | `sales.sales_date` |
| Partner Records | `transfer_funnel.sales_date` (text from the ERP — shape-guarded before the cast) |
| Assignment log | `assignment_batches.assigned_at` |
| Import history | `import_batches.uploaded_at` |

### Where it is deliberately absent

- **The Dashboard.** The scorecards read precomputed values from
  `metric_snapshots`, which is what makes them load at 500,000 rows. A date
  filter there is not a filter, it is a recompute per range. Ranged metrics are
  a compute change, not a UI one — do not add a control that silently does
  nothing.
- **The stove record itself.** Its timelines are one record's own history.
  Filtering them would hide calls somebody made, which is the opposite of what
  a complete record is for.
