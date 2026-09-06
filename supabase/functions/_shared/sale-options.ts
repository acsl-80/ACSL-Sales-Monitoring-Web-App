/**
 * The sale record's three choices, read from the registry through one door
 * and matched the same way everywhere (slice F3b, A6 and A7).
 *
 * public.sale_options() returns the option lists baseline_stove, fuel_source
 * and cooking_location from the Data Center registry, retired values
 * included. create-sale, update-sale and the import call `normalizeChoice`
 * with what they were sent: a stored value, a label, an older value, or the
 * free text a phone app still sends. A word the rules can place becomes the
 * value; a word they cannot keeps its text in the note column and leaves the
 * choice empty, so nothing is lost and nothing is refused for a field that
 * only became a choice today.
 */

export type SaleOptionRow = {
  list_key: string;
  value: string;
  label: string;
  is_active: boolean;
  sort_order: number;
};

export type SaleOptionLists = Map<string, SaleOptionRow[]>;

export const SALE_OPTION_LISTS = ["baseline_stove", "fuel_source", "cooking_location"] as const;

/** Column to list: the three sale columns that draw from the registry. */
export const CHOICE_COLUMNS: Record<string, string> = {
  previous_stove_type: "baseline_stove",
  cooking_fuel_source: "fuel_source",
  cooking_location: "cooking_location",
};

/**
 * One read per request. The lists are a few rows; the door is a stable
 * function. A failed read is null, and the callers then keep what they were
 * sent, as they did before the lists existed: an outage of the door must not
 * turn every answer into a note.
 */
// deno-lint-ignore no-explicit-any
export async function loadSaleOptions(supabase: any): Promise<SaleOptionLists | null> {
  const lists: SaleOptionLists = new Map();
  const { data, error } = await supabase.rpc("sale_options");
  if (error || !Array.isArray(data)) {
    console.error("sale_options could not be read; choices are kept as sent", error ?? "no rows");
    return null;
  }
  for (const row of data as SaleOptionRow[]) {
    const bucket = lists.get(row.list_key) ?? [];
    bucket.push(row);
    lists.set(row.list_key, bucket);
  }
  return lists;
}

/** The choices a form may offer: active values in order. */
export function activeOptions(lists: SaleOptionLists, listKey: string): { value: string; label: string }[] {
  return (lists.get(listKey) ?? [])
    .filter((r) => r.is_active)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    .map((r) => ({ value: r.value, label: r.label }));
}

function fold(s: string): string {
  return s.trim().toLowerCase().replace(/[\s\-_]+/g, " ");
}

/**
 * The rules the proposal named for the words history holds, and the older
 * value vocabularies. Applied only when no value or label matched outright.
 */
const RULES: Record<string, Array<[RegExp, string]>> = {
  fuel_source: [
    [/(market|buy|kasuwa|purchas|shop|vendor)/, "purchase"],
    [/(farm|collect|bush|gather|fetch)/, "collect"],
  ],
  cooking_location: [
    [/semi/, "semi_indoor"],
    [/(kitchen|indoor|inside|room)/, "indoor"],
    [/(outdoor|outside|open|compound|yard)/, "outdoor"],
  ],
  baseline_stove: [
    [/^wood stove$|three stone|firewood|^wood/, "firewood"],
    [/charcoal/, "charcoal"],
    [/lpg|gas/, "lpg"],
  ],
};

export type Choice = {
  value: string | null;
  note: string | null;
  matched: "value" | "label" | "rule" | "none" | "empty" | "unchecked";
};

/**
 * Place a word on a list. A stored value or a label (any case) matches
 * outright, retired ones included, so an older record re-saved keeps its
 * answer; then the rules; otherwise the word goes to the note.
 */
export function normalizeChoice(lists: SaleOptionLists | null, listKey: string, raw: unknown): Choice {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!text) return { value: null, note: null, matched: "empty" };
  // No lists to check against: the word is kept as sent, as before.
  if (!lists) return { value: text, note: null, matched: "unchecked" };
  const rows = lists.get(listKey) ?? [];
  const wanted = fold(text);
  const byValue = rows.find((r) => fold(r.value) === wanted);
  if (byValue) return { value: byValue.value, note: null, matched: "value" };
  const byLabel = rows.find((r) => fold(r.label) === wanted);
  if (byLabel) return { value: byLabel.value, note: null, matched: "label" };
  for (const [re, value] of RULES[listKey] ?? []) {
    if (re.test(wanted) && rows.some((r) => r.value === value)) {
      return { value, note: text, matched: "rule" };
    }
  }
  return { value: null, note: text, matched: "none" };
}

/** The words a refusal can quote: the active labels, joined. */
export function offeredLabels(lists: SaleOptionLists, listKey: string): string {
  return activeOptions(lists, listKey).map((o) => o.label).join(", ");
}
