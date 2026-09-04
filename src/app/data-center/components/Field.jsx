import { cloneElement, useId } from "react";

/**
 * A labelled control, associated explicitly rather than by wrapping.
 *
 * A <label> wrapping a <select> does associate the two, but the accessible
 * name is then the label's whole text content, and the selected <option> sits
 * inside it. "Partner" came out as "PartnerAny partner", so nothing on the
 * page was addressable by what the control is actually called: not by a
 * screen reader, not by a test, not by anything that names a field.
 *
 * cloneElement rather than a render prop, so call sites stay readable as
 * markup. The id comes from useId, so two panels on one page still associate
 * correctly. The label's text is injected as the accessible name as well,
 * because the searchable dropdowns render a <button> whose name would
 * otherwise be computed from whichever option is selected.
 */
export default function Field({ label, children }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </label>
      {cloneElement(children, { id, "aria-label": label })}
    </div>
  );
}
