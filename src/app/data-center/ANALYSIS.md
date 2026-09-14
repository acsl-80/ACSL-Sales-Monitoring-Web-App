# Analysis

The seventh area. The other six collect; this one says what the collection
means.

Everything here is **as of the last computation**, the same contract the
Dashboard has kept since Phase 8, and the page says so above the first chart.
What is live is the interaction: every chart opens the records behind it and
every chart exports the numbers it drew.

---

## What it answers today

### Stacking: where is stock sitting?

Two questions share the word, and they have different owners.

**Stock stacking** is stoves transferred to a partner and not yet sold, ageing.
The clock runs from the transfer date. Bands come from
`workflow_config['analysis.stock_age_buckets']`, currently 0-14 fine, 15-29 a
warning while there is still time to act, and everything from 30 critical, split
into bands so the chart shows how far past the line it has gone.

**Absorption** is the same partner's character rather than their week. Of the
stock old enough to judge, how much sold inside the window. A partner who took
five hundred units last Tuesday looks spotless on ageing and may be reliably
slow; ageing tells you who to ring today, absorption tells you what to say in
the contract conversation.

**Velocity** is how long a stove took to move, as a distribution rather than an
average. One consignment forgotten for a year drags a mean somewhere no actual
stove has ever been, and a single number cannot show that a partner is bimodal:
half its stock gone in a week, the rest forgotten for a quarter.

The population is narrow and every chart says so: stock **transferred to a
partner** and not yet sold. Stock that never left ACSL has no transfer
reference and is not counted, so an empty top band means "no old stock at
partners", not "no old stock".

### Creditable yield: how much of what we sold is worth anything?

Verified is not the finish line. A record is **creditable** when all of:

- `fully_verified`
- complete on `completeness_predicate` (the module's own definition, never
  `sales.status`, which still demands a photo the form dropped)
- stove ID confirmed
- not flagged as another Save80 in a household already counted
- not waiting on a correction
- not sharing a phone number with another sale nobody has confirmed

The chain runs sold, called, verified, verified-and-complete, creditable. It
never widens as it goes down, because each stage's filter contains the one
before it.

**Where it leaks** is the half anybody acts on. Every non-creditable sale is
charged to exactly one reason, the first gate it failed, so the reasons sum to
sold minus creditable. A partner losing 18% to missing addresses and a partner
losing 18% to dead phones need two different phone calls, and a single yield
percentage hides which one you are in.

---

## Any period, because every metric carries a month

A month, a quarter, six months, a single year, one year against another. All of
them are a sum of months, because every metric is filed at month grain.
Nothing was precomputed per named period, so a range nobody thought to list
still answers.

"Year on year" needed no feature of its own. The comparison is always **the
equal-length range immediately before this one**: count the months in the range
and step back that many. A year against the year before, a quarter against the
quarter before and a month against the month before are one mechanism.

The month each metric is filed under is its own natural date: the transfer
month for stock, absorption and velocity, the sale month for the yield chain.

### The constraint this imposes

**A stored measure must be summable.** A sum of monthly counts is the range's
count; a sum of monthly medians is nothing at all.

That is why velocity stores a histogram rather than a median and p90, and why
absorption stores eligible and within-window as two counts rather than a
percentage. A stored rate carries no denominator and cannot be re-aggregated:
92% of eleven units would read the same as 92% of nine hundred. The client
divides.

---

## The numbers reconcile, and the tests check it

| Property | Why it holds |
|---|---|
| Stock bands sum to the unsold count, and the partner cut equals the location cut | Band floors are derived with `lag()` from the top edge above them, so an edit cannot open a gap. Compute raises rather than starting if the top band is not open |
| The funnel never widens going down | Each stage's filter contains the previous one |
| Leak reasons sum to sold minus creditable | One reason per record, the first gate it failed |
| The visible cross-tab adds up to its own margins | The footer sums the rows actually drawn, not every row including the ones the cap hid |

Measured on the preview: 425 unsold stoves, 148 in 15-29, 199 in 30-59, 78 in
60-89.

### One ordering that is load-bearing

`never_called` is tested **before** `not_verified`. `not_verified` is the
column's DEFAULT, so a record created the moment an agent opened it carries
that value having never been dialled. Only `attempt_count` separates "we rang
and got nowhere" from "we have not rung yet". Reversed, the chart would report
the call centre as having failed on work it has not been given.

---

## How it is built

### Compute

`data_center.compute_analysis(p_run_id)`, called from
`data-center-compute` inside the same run id, the same connection and the same
advisory lock as `compute_metrics` and `compute_scorecards`. Analysis and the
Dashboard can never disagree about as-of-when.

The dimension stays flat and gains a second axis plus a month:

```json
{"by":"partner","key":"<uuid>","label":"Kano Partner",
 "by2":"age_bucket","key2":"30_59","label2":"30-59 days","ord2":3,
 "period":"2026-08"}
```

`jsonb_strip_nulls` means a one-axis emit with no period collapses to exactly
`{by, key, label}` - byte-identical to what `compute_scorecards` writes, so the
Dashboard's existing readers keep working untouched. `ord2` exists so the
client never sorts "30-59 days" lexicographically and never parses a label to
recover an order.

### Reading

The `analysis` action takes `from` and `to` as `YYYY-MM` and returns:

- `totals` - the range collapsed, `period` stripped. What the cross-tabs draw.
- `series` - per month with the first axis collapsed. What the trends draw.
- `stockBands` / `velocityBands` - the configured bands, so no chart holds a
  threshold or a colour of its own.

The sum happens in SQL over `metric_snapshots`. That is not a breach of the
rule against aggregating in the read path: the rule is about `count`/`sum`/
`group by` over **`public.sales`**, and this is arithmetic over precomputed
snapshots, which is the entire point of precomputing them.

### Charts

recharts for anything on a continuous axis, DOM for anything whose mark is a
cell in a grid.

recharts was already a dependency with a wrapper nothing imported, so the
module's hand-rolled-visuals policy - which exists to avoid `package.json` and
`bun.lock` churn in the daily contractor merge - does not apply here.

The **heatmap is a real `<table>`** regardless. recharts has no heatmap mark,
and the scatter-of-squares workaround gives cells that do not tile and fragile
hit-testing. As a table it is keyboard navigable, readable by a screen reader,
its cells are already anchors so drill-through needs no click handler, it
prints, and a test can sum it - which is how the margin reconciliation above is
actually checked rather than asserted in a comment.

### `ChartFrame`

Nothing draws without it, and it is the reason the standing "no drill-down from
a chart" gap is closed. Render, drill and export are one contract rather than
three things each chart is trusted to remember. It throws in development when a
chart offers neither a way in nor a way out, and the e2e spec checks the same
contract from the outside so it holds for charts nobody has written yet.

It also renders an `sr-only` list of the same cells as real links, because an
SVG `<Bar onClick>` is neither focusable nor nameable. **Note for anyone
writing a test here:** those anchors are earlier in the DOM than the visible
cells and `sr-only` leaves them technically visible, so a loose
`a[href*="..."]` selector resolves to one and then times out under the page.
Scope to the element a person would click.

### `/data-center/stock`

The ageing chart needed somewhere to drill and there was nowhere. `records`,
`call_queue` and every other list is built on `v_sold_stoves`, which begins
`from public.sales` - so an unsold stove has no row in any of them. A different
population, not a narrower one, which is why it is a new action rather than a
new filter.

Its band filter is a **code**, resolved server-side against the same
`data_center.age_bands` function compute bucketed with. Re-grade a band in
Settings and the chart and the list move together; repeating "thirty days" in
the read path would have been a second definition of critical that agrees until
somebody edits one.

Gated on `records.view` rather than `analysis.view`: it is a list of stock, the
same class of fact as Partner Records, and somebody chasing a consignment needs
it whether or not they may read the findings that sent them there.

---

## Permission

`analysis.view`, held by `data_manager` and by nobody else's level. Not
`dashboard.view`, which every level in the module holds: Analysis crosses what
a buyer told an agent on the phone with the partner and the place they bought
in, and the module already keeps Table 1 and Table 2 as separate grants for
exactly that reason.

---

## Configuration, not code

Everything a person might want to change lives in `workflow_config`:

| Key | What it decides |
|---|---|
| `analysis.stock_age_buckets` | The ageing bands, their labels, and which are critical |
| `analysis.velocity_buckets` | The days-to-sell bands |
| `analysis.absorption_window_days` | The window absorption is judged over |
| `analysis.timezone` | The calendar day ageing is measured against |

Only the **top** edge of each band is stated. The floor is derived from the
band below, so an edit cannot leave a gap or an overlap - a hand-written
min/max pair per band can be edited into one, and stoves would then vanish from
the chart with no error raised anywhere. The last band must carry `max: null`;
compute refuses to run without it, because that band holds the stock the whole
metric exists to find.

`severity` is configuration too. A chart colours a band from the severity the
server sent beside the number, never from a hex it holds, so re-grading a limit
in Settings recolours the chart without a deploy.

---

## What is not here yet

Designed, not built: data integrity by partner and rep, fuel and baseline
displacement, sales-model performance, call centre throughput, and audit
exposure.

Not measurable because not collected: fuel spend, household size, cooking time,
and usage over time. The highest-value additions to the call form would be
household size, fuel spend or collection time, and a `verified_at` timestamp -
without which "verified in month M" is a cohort (sold in M, now verified)
rather than an event.

`stove_ids_base` has no index supporting the ageing scan. Before this meets
production volume, one belongs in `supabase/manual/` as
`CREATE INDEX CONCURRENTLY`.
