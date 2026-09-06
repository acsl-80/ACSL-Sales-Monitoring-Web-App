/**
 * The dated rules: which sale field is mandatory from which day (slice F3a).
 *
 * One table, public.sale_field_rules, read by the sales app's status rule,
 * the Data Center's completeness rule, the dictionary endpoint for the phone
 * app, and here for the web forms. A signed-in user may read it (RLS). The
 * forms use it to refuse a new record without a field the rules require for
 * the record's sales date; the server marks such a record incomplete rather
 * than refusing it (D31), so the two agree on the verdict and differ only in
 * where it lands.
 *
 * Read once per session and cached: the table is a couple of dozen rows and
 * changes when an administrator moves a date, which is rare. `loadSaleFieldRules(true)`
 * refreshes it.
 */

import { useEffect, useState } from "react";
import { getSupabase } from "./supabaseClient";
import { fieldByKey, fieldLabel } from "./saleDictionary";

export type RuleScope = "sales_app" | "data_center";

export type SaleFieldRule = {
  fieldKey: string;
  tableName: "sales" | "addresses";
  columnName: string;
  /** YYYY-MM-DD. A sale dated on or after this day must carry the field; null when the rule is lifted. */
  mandatoryFrom: string | null;
  appliesTo: RuleScope[];
  note: string | null;
  updatedAt: string | null;
};

type Row = {
  field_key: string;
  table_name: string;
  column_name: string;
  mandatory_from: string | null;
  applies_to: string[] | null;
  note: string | null;
  updated_at: string | null;
};

export function rowToRule(r: Row): SaleFieldRule {
  return {
    fieldKey: r.field_key,
    tableName: r.table_name === "addresses" ? "addresses" : "sales",
    columnName: r.column_name,
    mandatoryFrom: r.mandatory_from ? String(r.mandatory_from).slice(0, 10) : null,
    appliesTo: (r.applies_to ?? []).filter(
      (a): a is RuleScope => a === "sales_app" || a === "data_center",
    ),
    note: r.note ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

let cached: Promise<SaleFieldRule[]> | null = null;

/** Every rule, cached for the session. A failed read is not cached. */
export function loadSaleFieldRules(force = false): Promise<SaleFieldRule[]> {
  if (!cached || force) {
    cached = Promise.resolve(
      getSupabase()
        .from("sale_field_rules")
        .select("field_key, table_name, column_name, mandatory_from, applies_to, note, updated_at"),
    ).then(({ data, error }) => {
      if (error || !data) {
        cached = null;
        return [];
      }
      return (data as Row[]).map(rowToRule);
    });
  }
  return cached;
}

/** The rules, loaded once for a component's life. Empty until they arrive. */
export function useSaleFieldRules(): SaleFieldRule[] {
  const [rules, setRules] = useState<SaleFieldRule[]>([]);
  useEffect(() => {
    let live = true;
    loadSaleFieldRules().then((r) => {
      if (live) setRules(r);
    });
    return () => {
      live = false;
    };
  }, []);
  return rules;
}

/** The day a sale is judged on: its sales date, or today while it has none. */
export function ruleDay(saleDate: unknown): string {
  const s = saleDate instanceof Date ? saleDate.toISOString() : String(saleDate ?? "");
  const day = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date().toISOString().slice(0, 10);
}

/** The rules in force for a sale on its day, for one reader. */
export function rulesInForce(
  rules: SaleFieldRule[],
  saleDate: unknown,
  scope: RuleScope = "sales_app",
): SaleFieldRule[] {
  const day = ruleDay(saleDate);
  return rules.filter(
    (r) => r.appliesTo.includes(scope) && r.mandatoryFrom !== null && r.mandatoryFrom <= day,
  );
}

/** Present means someone answered: not null, not blank, and every consent given. */
export function isPresentValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    // The one object column is the consents: an answer only when every
    // consent in it is given, the same reading the status rule takes.
    const values = Object.values(value as Record<string, unknown>);
    return values.length > 0 && values.every((v) => v === true);
  }
  return true;
}

/** snake_case column to the camelCase key both forms use: full_address to fullAddress. */
export function camelKey(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Where the form keeps the value a rule asks for. Both forms hold a sale's
 * columns under the dictionary's payload key (camelCase), and the address
 * under `addressData` with camelCase keys of its own.
 */
export function ruleFormKey(rule: SaleFieldRule): string {
  if (rule.tableName === "addresses") return camelKey(rule.columnName);
  const payload = fieldByKey(rule.fieldKey)?.payload;
  return payload && payload !== "addressData" ? payload : camelKey(rule.columnName);
}

/** The key the validator reports a missing value under; the address line has its own name there. */
export function ruleErrorKey(rule: SaleFieldRule): string {
  const key = ruleFormKey(rule);
  return rule.tableName === "addresses" && key === "fullAddress" ? "address" : key;
}

export function ruleValue(rule: SaleFieldRule, formData: Record<string, unknown>): unknown {
  const key = ruleFormKey(rule);
  if (rule.tableName === "addresses") {
    const address = formData.addressData as Record<string, unknown> | undefined;
    return address?.[key] ?? formData[key];
  }
  return formData[key];
}

/** The rules in force that the form has not answered, with the words to say so. */
export function missingByRules(
  rules: SaleFieldRule[],
  formData: Record<string, unknown>,
  scope: RuleScope = "sales_app",
): { key: string; label: string; rule: SaleFieldRule }[] {
  return rulesInForce(rules, formData.salesDate, scope)
    .filter((rule) => !isPresentValue(ruleValue(rule, formData)))
    .map((rule) => ({ key: ruleErrorKey(rule), label: fieldLabel(rule.fieldKey), rule }));
}
