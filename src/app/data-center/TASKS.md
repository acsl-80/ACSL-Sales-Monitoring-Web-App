# Data Center tasks

Flat, one line per slice, newest programme first. States: todo, spec red,
green, in review, merged, live. The why lives in `decisions.md`; the evidence
lives on each PR.

## Phase 25, field alignment (opened 2026-09-05)

The paper User Agreement's wording is the name of every sale field on every
surface; one dictionary is read by all of them; mandatory carries a date so
history is never made incomplete after the fact. Proposal accepted 2026-09-05;
decisions D27 to D29.

- [x] F1 The dictionary: one JSON source read by the web form, the workbench, the corrections catalogue, the records table, the exports and the API docs; a `sale-dictionary` endpoint for the phone app; a parity spec. PR #80 merged and live 2026-09-05 (main c17d6d3 to 1fe571c; sheet-headers migration applied with ledger row; eight functions deployed; bundle crawl confirmed)
- [ ] F2 Schema additions, host lane on his word: surname and first name (history split by rule, marked), sales agent's name (column selling_agent_name, distinct from the module's creator field), note columns for the original fuel and location text; create-sale and update-sale accept the new keys; import, sheet, bench and web form carry them; city wired through. green on the preview, in review (PR #81). The transfer's order model (D19) moves to F2b, its own host-lane PR.
- [ ] F3 Options and rules: one baseline stove list, fuel source and cooking location dropdowns, payment type split from sales model, mandatory-from dates in a public rules table read by the status rule and the module's completeness rule; CPA labelled as the terms block; slice 8's settings work folded in. todo
- [ ] F4 The external API's second shape with the Stove DB names, docs and CSV headers from the dictionary; the old shape kept until the analysts move. todo
- [ ] F5 The phone app guide handed to brain-codes, and a payload contract spec that fails when either app drifts from the dictionary. guide drafted 2026-09-05 (sales-mobile-field-alignment-guide.md beside the repos)

## Phase 24 (opened 2026-09-04)

- [x] 0 Docs and tracker: this file, `decisions.md`, PLAN.md and ROADMAP.md entries. merged, live (PR #66, 2026-09-04)
- [ ] 0.5 Design canvas, ten surfaces in the module's theme, approved before code. published 2026-09-04, awaiting his review
- [x] 1 Corrections lifecycle, function, backfill, access on link. merged, live (PR #67, 2026-09-04): 30 episodes backfilled, 11 reps given the door
- [x] 2 Correction workspace: disputed record, edit through update-sale, serial through rematch. merged, live (PR #68, 2026-09-04); carries the slice 1 review fixes and the update-sale scope fix
- [x] 2h Hotfix from the slice 2 review: update-sale writes only the fields it was sent, partner agent kept to their own sales, money offered only when disputed. merged, live (PR #69, 2026-09-04; update-sale v23 since 11:09Z)
- [x] 3 Review and recall: review panel, derived recall allowance, phone reconciliation, awaiting-review preset and tile. merged, live (PR #70, 2026-09-04): migration applied, three functions deployed, bundle crawl confirmed
- [x] 4 Send-back panel and work-waiting banner. merged, live (PR #71, 2026-09-04): corrections v4 deployed, bundle crawl confirmed
- [x] 5a Engine picks from module_access; capacity on the manual door; agent profiles; gates. merged, live (PR #72, 2026-09-04): migration applied (5 agents over capacity left as they are, 7 candidates for the engine), assign v4 deployed, bundle crawl confirmed
- [x] 5b Pool v3 (with Sales, half-typed and just-rung records left out; digitised_at, recall_due) and pick_callable with a configured order. merged, live (PR #73, 2026-09-04): migration applied, callable 1,502 unchanged on the day, assign v5 deployed, bundle crawl confirmed
- [x] 6a Control centre: board, agents with presence, pool by partner, lanes, polling; the log is history only. merged, live (PR #74, 2026-09-04): migration applied, three functions deployed, a pool-only run on production wrote 127 rows with the sales families' computed-at untouched, bundle crawl confirmed
- [x] 6b Queue facets in the URL. PR #75 merged and live 2026-09-04 (main 72df1a9 to a80f2ec; client only, bundle crawl confirmed)
- [x] 7a Completeness evidence config and the tile's plain line. PR #76 merged and live 2026-09-05 (main a80f2ec to 6ae5db7; migration applied with ledger row, read v18, full run 2,340 of 2,340 complete)
- [x] 7b The sales app's status rule (D17). PR #77 merged and live 2026-09-05 (main 6ae5db7 to 855e860; both migrations applied with ledger rows; production reads 54 completed, 333 pending, 1,953 incomplete; 406 rows recomputed)
- [ ] 8 Settings: used by, retire warning, previous_stove list, typed editors, gates. folded into F3
- [ ] 9 Order model on the transfer, preselected on the bench (D19). folded into F2 and F3

## Deferred

- Host, seen while fixing the render loop (PR #79): the sidebar declares two entries with the same `route` key ("agents"), which React warns about on every render; and a username-based login falls through to the direct email path on any non-ok answer from `login-with-credentials`, reporting a transient server fault as wrong credentials. Two small host fixes.
- Host, seen in the F1 review: the Sell Stove form's previous-stove value rendering ("Charcoal Stove", "Wood Stove (3 stone)") on the detail views differs from the form's option labels; F3's option pass should carry it.
- The 181 live sales whose payment model is outside their partner's entitlement: an observation for the sales team, not a module change.
- The host form's own copy of the previous-stove list (`CreateSalesForm.jsx`): host lane.
- A structured editor for the sheet columns config.
- Accounts for sales reps who have none.
- `calls.exhausted` and the queue's "Chased 3 times" preset count raw attempts, so a record recalled after a fix reads as exhausted and callable at once. Slice 5b (pool v2, `recall_due`) aligns them with the allowance `v_callable_records` already applies. Found by the slice 3 review.
- The Assignment Log's "Move them" lever now meets the same rule as the manual door (paused, capacity) and shows the refusal, but offers no reason box yet; slice 6a moves the levers into the agents panel and gives them one.
- The commit-chain rollback spec ("rollback under a live chain is refused") is timing-bound: the lease is released between slices, so a rollback that lands in the gap answers 200. Passed on its second run 2026-09-04. Pre-existing; a product fix would hold the lease for the whole chain.
