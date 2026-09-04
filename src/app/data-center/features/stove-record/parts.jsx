import Link from "@/compat/Link";
import { ExternalLink } from "lucide-react";

/**
 * The pieces a record is drawn with, shared by the stove page and the
 * correction workspace so both render a sale the same way. Moved out of
 * StoveRecord.jsx in Phase 24 rather than copied: one Detail, one look.
 */

export function Section({ icon: Icon, title, note, children, right }) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/25 px-4 py-2.5">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            {Icon && <Icon className="h-4 w-4 text-(--dc-accent)" />} {title}
          </h2>
          {note && <p className="mt-0.5 text-xs text-gray-600">{note}</p>}
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * A labelled value, and the one thing that makes this page what it is: when a
 * value is itself something you can go and look at, it is a link, not text.
 *
 * `disputed` (Phase 24) draws the amber ring the correction workspace uses to
 * say "this is the item the call centre questioned".
 */
export function Detail({ label, value, href, title, disputed = false, hint }) {
  const shown = value ?? null;
  return (
    <div
      className={
        disputed
          ? "min-w-0 -m-1.5 rounded-lg border-2 border-amber-500 bg-amber-50 p-1.5"
          : "min-w-0"
      }
      data-disputed={disputed || undefined}
    >
      <p className={`text-xs font-medium uppercase tracking-wide ${disputed ? "text-amber-900" : "text-gray-600"}`}>
        {label}
        {disputed && (
          <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-900">
            disputed
          </span>
        )}
      </p>
      {shown == null || shown === "" ? (
        <p className="mt-0.5 text-sm text-gray-400">not recorded</p>
      ) : href ? (
        <Link
          href={href}
          title={title}
          className="mt-0.5 inline-flex items-baseline gap-1 text-sm font-medium text-(--dc-accent) underline decoration-(--dc-accent)/30 underline-offset-2 transition hover:decoration-(--dc-accent)"
        >
          <span className="break-words">{shown}</span>
          <ExternalLink className="h-3 w-3 shrink-0 translate-y-0.5" aria-hidden />
        </Link>
      ) : (
        <p className="mt-0.5 break-words text-sm text-gray-900">{shown}</p>
      )}
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export function Grid({ children }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      {children}
    </div>
  );
}

export function Empty({ children }) {
  return (
    <p className="rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/15 px-4 py-6 text-center text-sm text-gray-600">
      {children}
    </p>
  );
}
