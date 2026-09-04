# Data Center tasks

Flat, one line per slice, newest programme first. States: todo, spec red,
green, in review, merged, live. The why lives in `decisions.md`; the evidence
lives on each PR.

## Phase 24 (opened 2026-09-04)

- [x] 0 Docs and tracker: this file, `decisions.md`, PLAN.md and ROADMAP.md entries. merged, live (PR #66, 2026-09-04)
- [ ] 0.5 Design canvas, ten surfaces in the module's theme, approved before code. published 2026-09-04, awaiting his review
- [x] 1 Corrections lifecycle, function, backfill, access on link. merged, live (PR #67, 2026-09-04): 30 episodes backfilled, 11 reps given the door
- [x] 2 Correction workspace: disputed record, edit through update-sale, serial through rematch. merged, live (PR #68, 2026-09-04); carries the slice 1 review fixes and the update-sale scope fix
- [x] 2h Hotfix from the slice 2 review: update-sale writes only the fields it was sent, partner agent kept to their own sales, money offered only when disputed. merged, live (PR #69, 2026-09-04; update-sale v23 since 11:09Z)
- [x] 3 Review and recall: review panel, derived recall allowance, phone reconciliation, awaiting-review preset and tile. merged, live (PR #70, 2026-09-04): migration applied, three functions deployed, bundle crawl confirmed
- [ ] 4 Send-back panel and work-waiting banner. in progress
- [ ] 5a Engine picks from module_access; capacity on the manual door; agent profiles; gates. todo
- [ ] 5b Pool v2 and pick_callable with a configured priority. todo
- [ ] 6a Control centre: board, agents with presence, pool by partner, lanes, polling. todo
- [ ] 6b Queue facets in the URL. todo
- [ ] 7a Completeness evidence config and the tile's plain line. todo
- [ ] 7b The sales app's status rule (D17). needs the owner's word
- [ ] 8 Settings: used by, retire warning, previous_stove list, typed editors, gates. todo
- [ ] 9 Order model on the transfer, preselected on the bench (D19). needs the owner's word

## Deferred

- The 181 live sales whose payment model is outside their partner's entitlement: an observation for the sales team, not a module change.
- The host form's own copy of the previous-stove list (`CreateSalesForm.jsx`): host lane.
- A structured editor for the sheet columns config.
- Accounts for sales reps who have none.
- `calls.exhausted` and the queue's "Chased 3 times" preset count raw attempts, so a record recalled after a fix reads as exhausted and callable at once. Slice 5b (pool v2, `recall_due`) aligns them with the allowance `v_callable_records` already applies. Found by the slice 3 review.
- The commit-chain rollback spec ("rollback under a live chain is refused") is timing-bound: the lease is released between slices, so a rollback that lands in the gap answers 200. Passed on its second run 2026-09-04. Pre-existing; a product fix would hold the lease for the whole chain.
