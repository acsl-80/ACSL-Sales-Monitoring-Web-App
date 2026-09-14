/**
 * Read one figure out of a metrics payload.
 *
 * `metrics` is the list `metric_snapshots` came back as: rows of
 * `metric_key`, `dimension` and `value_num`. A dimension narrows to the row
 * whose dimension carries every given key and value; null takes the first row
 * for the key, which for an undimensioned metric is the only one. Absent means
 * 0, which is honest for a count and is what every card on the dashboard has
 * always shown for a family the last run did not write.
 */
export function metricValue(metrics, key, dimension = null) {
  const found = (metrics ?? []).find(
    (m) =>
      m.metric_key === key &&
      (dimension === null ||
        Object.entries(dimension).every(([k, v]) => m.dimension?.[k] === v)),
  );
  return found ? Number(found.value_num ?? 0) : 0;
}

/** Every row of one dimensioned metric, as label, value and its dimension. */
export function metricRows(metrics, key) {
  return (metrics ?? [])
    .filter((m) => m.metric_key === key)
    .map((m) => ({ dimension: m.dimension ?? {}, value: Number(m.value_num ?? 0) }));
}
