/**
 * The sale field dictionary, for the web app.
 *
 * The paper User Agreement's wording is the name of every sale field, on
 * every screen, sheet, export and API page. This module reads the one JSON
 * source the edge functions and the phone app read too, so a label lives in
 * one place. Bundled at build time: no request, no loading state, and the
 * words a user sees are the words this build was tested with.
 *
 * Use `fieldLabel(key)` for a label, `fieldOptions(key)` for a dropdown's
 * options, and `isMandatory(field, on)` for whether a record dated `on` may be
 * saved without the field. A field's `payload` is the key create-sale and
 * update-sale read; the forms already send those keys and keep doing so.
 */

import dictionary from "../../supabase/functions/_shared/sale-dictionary.json";
import { useEffect, useState } from "react";
import { getSupabase } from "./supabaseClient";
import { supabaseUrl } from "./supabaseConfig";

export type SaleFieldOption = { value: string; label: string };

export type DictionaryField = {
  key: string;
  label: string;
  stoveDbName: string | null;
  table: string;
  column: string;
  payload: string | null;
  type: string;
  group: string;
  order: number;
  onAgreement: boolean;
  mandatoryFrom: string | null;
  correctable: boolean;
  options?: SaleFieldOption[];
  optionList?: string;
  optionsFrom?: string;
  consents?: string[];
  status?: "planned";
  note?: string;
};

export type SaleDictionary = {
  version: string;
  source: string;
  groups: { key: string; label: string }[];
  fields: DictionaryField[];
};

export const SALE_DICTIONARY = dictionary as SaleDictionary;

/** Fields whose column exists today, in display order. */
export const LIVE_FIELDS: DictionaryField[] = SALE_DICTIONARY.fields
  .filter((f) => f.status !== "planned")
  .sort((a, b) => a.order - b.order);

const BY_KEY = new Map(SALE_DICTIONARY.fields.map((f) => [f.key, f]));
const BY_PAYLOAD = new Map(
  SALE_DICTIONARY.fields.filter((f) => f.payload).map((f) => [f.payload as string, f]),
);

export function fieldByKey(key: string): DictionaryField | undefined {
  return BY_KEY.get(key);
}

/** The field a create-sale or update-sale payload key belongs to. */
export function fieldByPayload(payload: string): DictionaryField | undefined {
  return BY_PAYLOAD.get(payload);
}

/** The agreement's wording for a field, or the key spelled as words when unknown. */
export function fieldLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key.replace(/_id$/, "").replace(/_/g, " ");
}

/** The wording for a form field, looked up by the payload key the form uses. */
export function payloadLabel(payload: string): string {
  return BY_PAYLOAD.get(payload)?.label ?? payload.replace(/([A-Z])/g, " $1").toLowerCase();
}

/** A select field's options, empty when the field is not a fixed list. */
export function fieldOptions(key: string): SaleFieldOption[] {
  return BY_KEY.get(key)?.options ?? [];
}

/** The label of one option value, or the value itself when it is not in the list. */
export function optionLabel(key: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return fieldOptions(key).find((o) => o.value === String(value))?.label ?? String(value);
}

/**
 * True when the field is mandatory for a record dated `on` (default today).
 * A record dated before the field's mandatory-from date is never refused for
 * lacking it: history is judged by the rule of its day.
 */
export function isMandatory(field: DictionaryField, on: Date = new Date()): boolean {
  if (!field.mandatoryFrom) return false;
  // The local calendar day, not UTC: a Lagos evening is not yet tomorrow.
  const day = `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, "0")}-${String(on.getDate()).padStart(2, "0")}`;
  return day >= field.mandatoryFrom;
}

/** The label of a group of fields, for section headings. */
export function groupLabel(key: string): string {
  return SALE_DICTIONARY.groups.find((g) => g.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// The live dictionary (slice F3b). The JSON above is the seed the build
// carries; the sale-dictionary endpoint serves the same fields with the
// registry's options and the rules table's dates. Read once per session.
// ---------------------------------------------------------------------------

let liveCache: Promise<SaleDictionary | null> | null = null;

/** The endpoint's dictionary, or null when it cannot be reached. A failure is not cached. */
export function loadLiveDictionary(force = false): Promise<SaleDictionary | null> {
  if (!liveCache || force) {
    liveCache = (async () => {
      try {
        const { data } = await getSupabase().auth.getSession();
        const token = data.session?.access_token;
        if (!token) return null;
        const res = await fetch(`${supabaseUrl}/functions/v1/sale-dictionary`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        return (await res.json()) as SaleDictionary;
      } catch {
        return null;
      }
    })().then((v) => {
      if (v === null) liveCache = null;
      return v;
    });
  }
  return liveCache;
}

/** The live dictionary for a component's life; null until it arrives or when it cannot. */
export function useLiveDictionary(): SaleDictionary | null {
  const [live, setLive] = useState<SaleDictionary | null>(null);
  useEffect(() => {
    let on = true;
    loadLiveDictionary().then((v) => {
      if (on && v) setLive(v);
    });
    return () => {
      on = false;
    };
  }, []);
  return live;
}

/** A field's options as the registry has them now, the seed until then. */
export function useFieldOptions(key: string): SaleFieldOption[] {
  const live = useLiveDictionary();
  const field = live?.fields.find((f) => f.key === key);
  return field?.options?.length ? field.options : fieldOptions(key);
}

/** The label of one value against a given option set, or the value itself. */
export function labelFor(options: SaleFieldOption[], value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return options.find((o) => o.value === String(value))?.label ?? String(value);
}
