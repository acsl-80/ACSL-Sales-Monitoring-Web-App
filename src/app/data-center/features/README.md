# features

One directory per feature, self-contained.

A feature is removable by deleting its directory and its registry row. If
removing one requires edits scattered across the module, the boundary is in the
wrong place.

Each feature declares the `feature_key` it is gated by. That key must exist in
`data_center.feature_grants` before the feature is reachable.
