import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getGeoData } from "@/lib/geoDataService";

/**
 * A state, and then only the LGAs that are in it.
 *
 * WHY THIS EXISTS
 *
 * Nigeria's 36 states, the FCT and all 774 LGAs are already in this database
 * (`public.nigeria_states`, `public.nigeria_lgas`), already served by the
 * `geo-data` edge function, and already cached by `src/lib/geoDataService`.
 * None of that was new work. What was missing is that almost nothing used it:
 * of twenty-two surfaces across the app that offer a state, one read the live
 * service, eighteen read a bundled constant that never refreshes, three kept
 * their own copy of the list pasted into the file, and only five narrowed the
 * LGAs to the chosen state.
 *
 * The Data Centre bench was worse than any of them: `state` and `lga` were
 * plain text inputs. That is the path a typist walks forty times a morning
 * holding a paper receipt, so it is the path where a misspelt state actually
 * enters the database - and it had no list to be wrong against.
 *
 * WHY IT DOES NOT REFUSE WHAT IS ALREADY THERE
 *
 * Live data is 99.5% clean against the reference list, and every exception is
 * one of four spellings of Abuja: `Federal Capital Territory` where the list
 * says `FCT` (15 addresses), `Abuja Municipal` where it says `Abuja` (2 sales),
 * a lone `Abuja` in the transfer history, and some blanks. A control that
 * silently dropped a value it did not recognise would erase those records'
 * location the first time somebody opened one to fix something else.
 *
 * So an unrecognised value is kept, offered, and flagged. The operator sees
 * that it is off-list and can correct it; nothing corrects it behind their
 * back. This is also why there is no foreign key on these columns: twenty-one
 * live rows would start failing on write, and partner creation would begin
 * refusing perfectly ordinary saves.
 */
export default function StateLgaSelect({
  state,
  lga,
  onState,
  onLga,
  disabled = false,
  idPrefix = "geo",
  stateLabel = "State",
  lgaLabel = "Local government area",
  /** Rendered when a value is not in the reference list. */
  onNote = null,
}) {
  const [geo, setGeo] = useState(null);

  useEffect(() => {
    let live = true;
    // Never throws: the service falls back to the bundled copy on any failure,
    // so the form always has a list even with the network down.
    getGeoData().then((g) => live && setGeo(g));
    return () => {
      live = false;
    };
  }, []);

  const states = geo?.states ?? [];
  const lgas = useMemo(() => (state ? (geo?.lgas?.[state] ?? []) : []), [geo, state]);

  const stateOffList = Boolean(state) && states.length > 0 && !states.includes(state);
  const lgaOffList = Boolean(lga) && lgas.length > 0 && !lgas.includes(lga);

  useEffect(() => {
    onNote?.({ stateOffList, lgaOffList });
  }, [stateOffList, lgaOffList, onNote]);

  /*
   * The value already on the record is always offered, even off-list.
   *
   * Without this, opening an existing record whose state reads "Federal
   * Capital Territory" would show an empty control, and saving anything else
   * on the form would quietly blank a location somebody had recorded.
   */
  const stateOptions = useMemo(() => {
    const list = states.map((s) => ({ value: s, label: s }));
    if (stateOffList) list.unshift({ value: state, label: state, hint: "not on the list" });
    return list;
  }, [states, state, stateOffList]);

  const lgaOptions = useMemo(() => {
    const list = lgas.map((l) => ({ value: l, label: l }));
    if (lgaOffList) list.unshift({ value: lga, label: lga, hint: "not in this state" });
    return list;
  }, [lgas, lga, lgaOffList]);

  return (
    <>
      <div>
      {/*
        The label lives here rather than inside the control.

        The shared component follows the shadcn convention of not rendering its
        own label, and `ariaLabel` is passed as well as the visible one because
        the trigger is a button: its accessible name would otherwise be computed
        from its contents, which is whatever option happens to be chosen.
      */}
      <label
        htmlFor={`${idPrefix}-state`}
        className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600"
      >
        {stateLabel}
      </label>
      <SearchableSelect
        id={`${idPrefix}-state`}
        ariaLabel={stateLabel}
        value={state ?? ""}
        onChange={(next) => {
          onState(next);
          /*
           * Changing the state clears the LGA, because an LGA belongs to one
           * state and keeping it would leave the record saying something like
           * Kogi / Ikeja. There are already 2 sales in exactly that shape.
           */
          if (next !== state) onLga("");
        }}
        disabled={disabled || geo === null}
        placeholder={geo === null ? "Loading states..." : "Choose a state"}
        searchPlaceholder="Type part of the state"
        emptyLabel="No state matches that"
        options={stateOptions}
      />
      </div>

      <div>
      <label
        htmlFor={`${idPrefix}-lga`}
        className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600"
      >
        {lgaLabel}
      </label>
      <SearchableSelect
        id={`${idPrefix}-lga`}
        ariaLabel={lgaLabel}
        value={lga ?? ""}
        onChange={onLga}
        disabled={disabled || !state}
        placeholder={state ? "Choose an LGA" : "Choose a state first"}
        searchPlaceholder="Type part of the LGA"
        emptyLabel="No LGA in this state matches that"
        options={lgaOptions}
      />
      </div>

      {(stateOffList || lgaOffList) && (
        <p className="sm:col-span-2 lg:col-span-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          {stateOffList && lgaOffList
            ? `"${state}" is not one of the 37 states and "${lga}" is not one of its LGAs.`
            : stateOffList
              ? `"${state}" is not one of the 37 states as they are recorded.`
              : `"${lga}" is not an LGA of ${state}.`}{" "}
          It has been kept as it is. Choose from the list to correct it.
        </p>
      )}
    </>
  );
}
