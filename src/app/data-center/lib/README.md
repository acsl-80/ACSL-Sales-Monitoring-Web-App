# lib

The module's only data path.

- `client.ts` wraps the `data-center-*` edge functions. Nothing else in the
  module calls `getSupabase()` directly.
- `useFeature.ts` is the tier-2 feature gate. It mirrors the host's
  `usePermissions().can()` signature on purpose, so the module reads as familiar,
  but resolves from `feature_grants` rather than a compiled map.

The UI gate here is presentation only. The edge function is the real boundary.
