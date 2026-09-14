import { labelFor, useFieldOptions } from "@/lib/saleDictionary";

/**
 * The label of a choice field's stored value, as the registry names it now:
 * "Firewood" for firewood, the retired label for a value no longer offered,
 * and the value itself for a word the lists never held. Both detail views
 * render the sale's three choices through this, so they cannot disagree.
 */
export function ChoiceLabel({
  field,
  value,
  empty = "",
}: {
  field: string;
  value: string | null | undefined;
  empty?: string;
}) {
  const options = useFieldOptions(field);
  if (value === null || value === undefined || value === "") return <>{empty}</>;
  return <>{labelFor(options, value)}</>;
}
