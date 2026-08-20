# Reconciliation: sold against recovered

## The question this answers

ACSL ships stoves to a partner. The partner sells them and fills in a paper form
for each buyer. Those forms come back, get typed up, and the call centre rings
the buyer to confirm.

At every one of those steps the count drops, and until now nobody could say by
how much. This is the arithmetic that says.

## The gap, as it stands today

Measured in production:

| | Count |
|---|---|
| Transfers recorded | 497 |
| Stoves transferred to partners | 14,564 |
| Partners | 278 |
| Sales reps | 23 |
| **Sales recorded in the app** | **38** |

That is not a rounding error, it is the whole point. Paper and Excel are the
real system of record; the app holds a fraction of a percent of what has been
sold. The funnel exists to make that visible per partner, rather than as one
number nobody can act on.

## Where the numbers come from

Nothing here is copied. The transfer records were already in this database,
written by the ERP sync into `public.stove_transfer_history`, carrying the
reference, partner, sales rep, state, branch, quantity, and the list of stove
serials in the consignment.

## The matching key

This also already existed, and is kept current by two triggers:

```
sales.stove_serial_no
  -> stove_ids_base.stove_id          unique on (stove_id, organization_id)
  -> stove_ids_base.sales_reference   trigger-maintained
  -> stove_transfer_history.transaction_id
```

A string join rather than a foreign key, which is not how anyone would build it
today. It is maintained and it is correct, and inventing a second key would have
meant two answers to "which transfer did this sale come from".

A record that matches no transfer becomes an exception in the import queue. It
is never dropped.

## The four stages

| Stage | Where it comes from |
|---|---|
| **Issued** | `stove_transfer_history.stove_count` |
| **Received** | A consignment count logged against the partner, or the digitalised count where none was logged |
| **Digitalised** | Sales in the app whose serial appears in that transfer |
| **Verified** | Those sales whose call record concluded `fully_verified` |

### What "Received" means, and why it changes

Paper arrives in bundles. Someone can say "Partner X returned 50 forms on
Tuesday" the moment the envelope lands, weeks before anyone types them. So
Received is a **count per consignment**, not a row per form: logging each sheet
on arrival is a second handling, and the second handling is the one that gets
skipped.

This is deliberately transitional. As stations start entering their own sales
directly there is no paper and no receipt step, and a record is received the
moment it is digitalised. The funnel handles both without changing: where no
consignment has been logged, Received falls back to Digitalised.

`received_is_logged` tells the two apart, so a real count is never mistaken for
the fallback.

## The arithmetic

Three subtractions, each answering a different question:

```
issued    - digitalised   =  outstanding      still unaccounted for
received  - digitalised   =  typing backlog   paper in the building, not yet typed
verified + unverified + unreachable + unresolved  =  digitalised
```

**The four statuses reconcile to Digitalised, not to Received.** That is worth
stating plainly, because the brief asks them to reconcile to "received" and the
two differ whenever paper has arrived faster than it is being typed. That
difference is a real backlog and a number worth watching, not an inconsistency
to be smoothed away.

Every digitalised record sits in exactly one bucket, because the five
verification outcomes are exhaustive and a record with no call record counts as
unresolved:

| Bucket | `verification_outcome` |
|---|---|
| Verified | `fully_verified` |
| Unverified | `partially_verified`, `doubtful_verification` |
| Unreachable | `unreachable` |
| Yet to be resolved | `not_verified`, or no call record at all |

Verified on the preview across three transfers at different stages, including
one with a 22-record typing backlog. All three reconcile.

## Why it is computed rather than counted

`v_transfer_funnel` aggregates over `public.sales`, and this module's rule is
that a read never does that. So the view is what a refresh reads once, and pages
read `transfer_funnel`, a table.

That was not the first design. Four attempts at a live query, measured at
500,000 sales, asking for a single transfer:

| Shape | Time |
|---|---|
| Grouped CTE | 552 ms |
| Lateral | 921 ms |
| Lateral with an `offset 0` fence | 1,484 ms |
| Sequential scan disabled | 2,008 ms |

The planner will not do forty index lookups against `sales` when it can hash the
table instead, and no rewrite persuaded it otherwise. The lateral was flattened
straight back into the CTE; the fence held and it hashed anyway.

Grouped is the right shape for the job that actually matters, one pass covering
every transfer at once, which is what a refresh wants:

| | Time |
|---|---|
| Full refresh | 1,560 ms |
| Page read | **0.134 ms** |

The refresh runs inside `data-center-compute`, on the same connection and the
same advisory lock as the metrics, so the dashboard and Partner Records can
never disagree about how current they are. Both say when they were computed.

## Who sees what

Transfer scoping mirrors `get-transfer-history`, the sales app's own authority
on the same question, including the part where a `partner_agent` gets nothing.

That asymmetry is deliberate. A partner agent may see the sales they recorded;
how many stoves ACSL shipped to their employer is a different question, and the
sales app already decided they do not get to ask it.

| Role | Sees |
|---|---|
| `super_admin` | Everything |
| `acsl_agent`, `acsl_agent_manager` | Their assigned partners, nothing if unassigned |
| `partner`, `admin` | Their own organisation |
| `partner_agent`, `agent` | Nothing |

Every branch fails closed.
