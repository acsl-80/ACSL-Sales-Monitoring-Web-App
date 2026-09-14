import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * A run, narrated in named steps rather than one spinner.
 *
 * Lifted out of ImportPanel so both imports can use it. It was never
 * receipt-specific: it takes `{key, label, detail, state}` and knows nothing
 * about stoves, sales or calls. Keeping it inside a 1,560-line file meant the
 * call sheet showed a single line reading "reading and checking every row"
 * for a run that has four distinct stages, any of which can be the one that
 * failed.
 *
 * `state` is `pending` | `running` | `done` | `failed`. A failed step stays on
 * screen in amber rather than being replaced by an error banner, because the
 * useful question after a failure is which stage it got to.
 */
export default function Steps({ steps }) {
  if (!steps?.length) return null;
  return (
    <ol className="space-y-1.5 border-b border-gray-100 px-4 py-3">
      {steps.map((s) => (
        <li key={s.key} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 shrink-0">
            {s.state === "running" && (
              <Loader2 className="h-4 w-4 animate-spin text-(--dc-accent)" />
            )}
            {s.state === "done" && <CheckCircle2 className="h-4 w-4 text-(--dc-accent)" />}
            {s.state === "failed" && <AlertTriangle className="h-4 w-4 text-amber-600" />}
            {s.state === "pending" && (
              <span className="block h-4 w-4 rounded-full border border-gray-300" />
            )}
          </span>
          <span className="min-w-0">
            <span
              className={
                s.state === "pending"
                  ? "text-gray-400"
                  : s.state === "failed"
                    ? "font-medium text-amber-900"
                    : "text-gray-800"
              }
            >
              {s.label}
            </span>
            {s.detail && <span className="block text-xs text-gray-600">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Advance one step and mark everything before it done.
 *
 * Both panels drove this by hand and both got it subtly wrong in the same way:
 * a step that failed left the ones before it showing "running". The rule is
 * one sentence, so it belongs beside the component rather than copied twice.
 */
export function advance(steps, key, state, detail) {
  const at = steps.findIndex((s) => s.key === key);
  if (at < 0) return steps;
  return steps.map((s, i) => {
    if (i < at) return s.state === "pending" ? { ...s, state: "done" } : s;
    if (i > at) return s;
    return { ...s, state, detail: detail ?? s.detail };
  });
}
