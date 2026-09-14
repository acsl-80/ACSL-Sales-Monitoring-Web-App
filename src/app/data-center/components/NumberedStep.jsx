/**
 * One numbered step in a path that spans the app and a spreadsheet.
 *
 * Shared because the call sheet's path is now two components: the half that
 * hands you a file and the half that takes it back. A step numbered 1 in one
 * file and 2 in another has to look the same or the sequence stops reading as
 * a sequence.
 */
export default function NumberedStep({ n, title, tone = "plain", children }) {
  return (
    <li
      className={`relative flex gap-3 rounded-xl border p-4 ${
        tone === "active"
          ? "border-(--dc-accent)/40 bg-(--dc-accent-soft)/40"
          : "border-gray-200 bg-white"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          tone === "active" ? "bg-(--dc-accent) text-white" : "bg-gray-100 text-gray-600"
        }`}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <div className="mt-1 text-sm text-gray-600">{children}</div>
      </div>
    </li>
  );
}
