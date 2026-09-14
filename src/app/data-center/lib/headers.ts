/**
 * Column names that survive being repeated.
 *
 * WHY THIS EXISTS
 *
 * Both parsers built each row as `record[header] = value`, keyed on the header
 * text. A sheet that uses the same heading twice therefore kept only the
 * rightmost column, silently, and the reader had no way to know.
 *
 * That is not a hypothetical. ACSL's own digitisation template is one sheet
 * filled by two teams: the digitisers own the left-hand columns and the call
 * centre owns the right-hand ones, where the repeated headings are the call
 * centre CONFIRMING what the digitiser typed. So "Primary Phone Number" appears
 * twice on purpose, and the empty confirmation column was overwriting the real
 * number. Measured on the real file: 971 of 983 phone numbers destroyed before
 * the importer ever saw them, and every row would then have been refused for
 * having no phone, about a sheet that plainly has one.
 *
 * WHAT THIS DOES
 *
 * The first column keeps the plain heading, so every sheet with unique headings
 * parses exactly as it did before and every alias keeps matching. A repeat gets
 * the heading with an occurrence number, so it is still there to be mapped
 * rather than being lost.
 *
 * Deliberately NOT a rename of both. Naming the first occurrence
 * "Primary Phone Number (1)" would break every alias, every saved mapping and
 * every sheet this module hands out, to solve a problem those sheets do not
 * have.
 */
export function uniqueHeaders(headers: string[]): {
  names: string[];
  duplicates: { header: string; at: number[] }[];
} {
  const seen = new Map<string, number>();
  const positions = new Map<string, number[]>();
  const names = headers.map((h, i) => {
    if (h === "") return "";
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    positions.set(h, [...(positions.get(h) ?? []), i]);
    return n === 1 ? h : `${h} (${n})`;
  });
  const duplicates = [...positions.entries()]
    .filter(([, at]) => at.length > 1)
    .map(([header, at]) => ({ header, at }));
  return { names, duplicates };
}

/** Said on screen, because a repeated heading is usually deliberate. */
export function duplicateWarning(duplicates: { header: string; at: number[] }[]): string | null {
  if (!duplicates.length) return null;
  const named = duplicates
    .map((d) => `"${d.header}" (columns ${d.at.map((i) => i + 1).join(" and ")})`)
    .join(", ");
  return (
    `${duplicates.length === 1 ? "One heading appears" : `${duplicates.length} headings appear`} ` +
    `more than once: ${named}. The first is used as itself and the later ones are numbered, ` +
    "so nothing is lost. Check they are mapped to the fields you mean."
  );
}
