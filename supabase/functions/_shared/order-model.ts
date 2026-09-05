/**
 * The ERP's sales model names, matched to public.payment_models in one place.
 *
 * Both syncs (external-sync for JSON, external-csv-sync for the CSV) match an
 * incoming name the same way: whitespace collapsed, lower-cased, and the
 * duration as part of the key when one was sent. The entitlement sync keys on
 * name plus duration and creates a stub for a pair it has never seen, so by the
 * time the transfer row is written the exact pair exists; a name sent without
 * a duration resolves only when it is unambiguous.
 */

export type PaymentModelRow = { id: string; name: string; duration_months: number | null };

/** One read of payment_models per request; pass the same object through a loop. */
export type PaymentModelCache = { rows?: Promise<PaymentModelRow[]> };

/// Normalized key for matching an incoming model name against `payment_models.name`.
export function normalizeModelName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The payment model the ERP's Order Sales Model names, or null. Retired models
 * still resolve: the transfer records what was sent, and the bench decides
 * separately whether the partner is offered it. A failed read resolves to null
 * rather than failing the transfer write.
 */
export async function resolveOrderModelId(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  name: string | null | undefined,
  duration: number | null | undefined,
  cache: PaymentModelCache = {},
): Promise<string | null> {
  const wanted = normalizeModelName(String(name ?? ""));
  if (!wanted) return null;
  cache.rows ??= Promise.resolve(
    supabase.from("payment_models").select("id, name, duration_months"),
  ).then(({ data, error }: { data: PaymentModelRow[] | null; error: unknown }) =>
    error || !data ? [] : data,
  );
  const rows = await cache.rows;
  const same = rows.filter((m) => normalizeModelName(String(m.name ?? "")) === wanted);
  if (same.length === 0) return null;
  const wantedDuration =
    duration === null || duration === undefined || Number.isNaN(Number(duration)) ? null : Number(duration);
  if (wantedDuration !== null) {
    return same.find((m) => Number(m.duration_months) === wantedDuration)?.id ?? null;
  }
  return same.length === 1 ? same[0].id : null;
}
