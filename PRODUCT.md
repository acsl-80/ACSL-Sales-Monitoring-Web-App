# ACSL Sales Monitoring: product truth

Written for design work on the Data Center module. It records what is true, not
what is intended: every figure here was measured against the live database.

## What this is

A web application ACSL staff use to monitor stoves sold through partners across
Nigeria. Field agents record a sale against a stove serial; partners hold stock
transferred from the factory; a call centre rings the buyer afterwards to
confirm the sale is real.

A Flutter mobile app shares its database and serves the field. **The Data Center
module is web only and must never be reachable from it**, which is enforced by
keeping the `data_center` schema out of PostgREST's exposed schemas.

## Who uses it

| Who | What they do | On what |
|---|---|---|
| Super admins | Everything, including granting Data Center access | Desktop |
| ACSL agents and their managers | Work assigned partners' records | Desktop, sometimes a phone |
| Call agents | Ring buyers, record what each call concluded | Desktop at a station; a phone in the field |
| Partners and partner agents | Their own organisation's sales | Phone, mostly |

Nigeria. Android-majority, mid-range devices, mobile data that is not always
good. The Data Center is a desktop tool first because its tables are wide and
its work is sustained, and it must still work in a hand, because a call agent
with a list of numbers has a phone and not a laptop.

## The Data Center, specifically

A computation and dashboard module inside the app, added in 2026. It answers one
question the rest of the app cannot: **of everything sold through partners, how
much has actually come back, been typed up, and been confirmed?**

Five areas: a dashboard of scorecards, the call centre queue and assignment log,
partner reconciliation, the sold-stove table, and bulk import of digitalised
paper receipts.

## Facts that shape design decisions

Measured in production, 2026-08:

| | |
|---|---|
| Transfers to partners | 497 |
| Stoves transferred | 14,564 |
| Partners | 278 |
| Sales recorded in the app | 38 |
| Capacity the module is built for | 500,000 |

**Paper and Excel are still the real system of record.** The app holds a
fraction of a percent of what has been sold. A design that assumes full tables
will be wrong for a year; a design that assumes empty ones will be wrong after
that. Both states have to look deliberate.

Roughly one imported serial in twelve matches no stock record. That is the
normal case, not a failure, and it routes to an exceptions queue.

## Constraints that are not negotiable

- **The sales app must not notice this module exists.** `main` deploys straight
  to production and a cron merges contractor work into it daily. The module
  hand-edits exactly two files outside itself.
- **No new dependencies.** `package.json` and `bun.lock` are in that daily merge;
  a lockfile conflict costs more than writing forty lines by hand.
- One accent, five areas, and the host's own olive stays the anchor. The module
  is a room in a house, not a new house.

## Language

British-influenced Nigerian English: "digitalised", "organisation" in prose.
Column names and code stay as the schema spells them.
