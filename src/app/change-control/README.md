# Change Control (slice S8c)

Lets ACSL staff raise and follow change requests without an ERP login — from
inside this app, with a screenshot, on the page they were already looking at.

Only ACSL staff reach it: `super_admin`, `acsl_agent_manager` and
`acsl_agent` (the `change-control-link` feature in `src/lib/permissions.ts`).
Partners and partner agents report through their ACSL contact instead
(Change Control decision D1); they never see the sidebar footer button or
these routes.

## The one door

`supabase/functions/change-request-intake/index.ts` is the only server this
app talks to for Change Control, and `api.ts` in this folder is the only file
in the app that calls it (`supabase.functions.invoke("change-request-intake",
...)`). That function checks the caller's session and role itself — every
rule (who may raise a request, how long a title can be, how many screenshots
fit, what "fixed" means) is enforced there, not on this side. A refusal comes
back in its own plain words; this app shows that text as-is rather than
writing a new message for it.

Behind that function sits the ERP's own `change-control-intake`, which does
the actual filing, review, and merging. This app never talks to the ERP
directly and carries no ERP credentials.

## Actions

- `form` — whether Change Control is open, the attachment limits, and the
  option lists (`type`, `impact`, `app`, `module`) for the New request form.
- `raise` — files a new request under the signed-in person's name and role.
- `list` — every request this person has raised, with its full thread. There
  is no "get one" action, so the request detail page reads this same list and
  finds its `ref` in it (`hooks/useMyRequests.ts`).
- `reply` — adds a reply to a request's thread; a reply to `needs_info`
  moves it back to `new`.
- `confirm` — the requester's answer to "Is it fixed?" (only shown once a
  request's status is `fixed`).
- a multipart upload — one to five screenshots, attached either to the
  request itself or to one reply (`comment_id`).

## What is deliberately left out

This is the sales side of Change Control, not the ERP's. It does not have:
a register of other people's requests, a "similar requests" panel, "this is
my problem too", review details beyond the reviewer's one-line summary, or
any triage action. Those stay ERP-only.

## Layout

- `api.ts` — the one door, described above.
- `types.ts` — shapes mirrored from the edge function's contract.
- `lib/status.ts` — status labels and tone-to-colour classes for `StatusChip`.
- `lib/url.ts` — validates a typed page link. `?from=` is handled separately
  in `new/page.tsx`: TanStack's `location.href` is path + query + hash only,
  so the sidebar's `?from=` arrives relative — it is resolved against
  `window.location.origin` and accepted only when the result's origin still
  matches this app's, which also refuses a crafted `?from=https://elsewhere`.
- `lib/images.ts` — downscales a picked screenshot before upload (ported
  unchanged from the ERP's own change-control picker).
- `hooks/useChangeControlForm.ts` — the form's option lists and attachment
  limits, cached for the session.
- `hooks/useMyRequests.ts` — the person's requests; `refresh()` invalidates
  this after a raise, a reply, or a confirm, so both screens update.
- `components/` — `ChangeControlGuard` (the permission gate every page uses),
  `StatusChip`, `ScreenshotPicker`, `RequestThread`, `RequesterActions`. A
  request's `files` field is a count, not a list of attachments (the list
  action never hands back a per-file url), so the thread and the detail page
  only ever say how many screenshots are attached, never show them.
- `page.tsx` (`/change-control`, My requests), `new/page.tsx`
  (`/change-control/new`, the form), `[ref]/page.tsx`
  (`/change-control/$ref`, one request).

## Who to ask

The ERP side of Change Control (review, merging, the register, triage) lives
in `erp-web/src/components/erp/change-control/`, whose own README covers that
half. Questions about what a status or a refusal means belong to whoever owns
the `change-request-intake` and `change-control-intake` functions.
