import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * A number that copies (Phase 26, C4, D36). The agents dial in a separate
 * application and record the outcome here, so every number on their surface
 * is one click to the clipboard and a line that says what is on it, naming
 * the app from configuration. Nothing here dials.
 *
 * The clipboard call is the browser's; where it is refused (an insecure
 * context, a denied permission) the field falls back to selecting the text
 * so the agent can copy it by hand, and says so.
 */
export default function CopyField({ value, label, diallerName, compact = false, onCopied }) {
  const [state, setState] = useState("idle");
  useEffect(() => {
    if (state === "idle") return undefined;
    const t = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(t);
  }, [state]);
  if (!value) return <span className="text-sm text-gray-400">-</span>;

  const copy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // React clears currentTarget once the handler yields; keep the element.
    const container = e.currentTarget.parentElement;
    try {
      await navigator.clipboard.writeText(String(value));
      setState("done");
      onCopied?.(value);
    } catch {
      setState("failed");
      const sel = window.getSelection();
      const node = container?.querySelector("[data-copy-value]");
      if (sel && node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border bg-white ${state === "done" ? "border-(--dc-brief-who) shadow-[inset_0_0_0_2px_var(--dc-brief-who-soft)]" : "border-gray-300"} ${compact ? "px-1.5 py-0.5" : "px-2 py-1"}`} data-copy-field>
      <span className={`font-mono tabular-nums text-gray-900 ${compact ? "text-xs" : "text-sm"}`} data-copy-value>{value}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label ?? "number"} ${value}`}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white transition ${state === "done" ? "bg-(--dc-fig-verified)" : "bg-(--dc-fig-transferred) hover:brightness-110"}`}
      >
        {state === "done" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {state === "done" ? "Copied" : "Copy"}
      </button>
      {state === "done" && !compact && (
        <span className="text-[11px] text-gray-600" role="status">paste it in {diallerName ?? "the call app"}</span>
      )}
      {state === "failed" && (
        <span className="text-[11px] text-(--dc-sev-warning)" role="status">selected, press Ctrl+C</span>
      )}
    </span>
  );
}
