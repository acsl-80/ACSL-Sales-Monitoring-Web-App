import { Copy, FileText, Loader2, PenLine, X } from "lucide-react";
import ColumnMapping from "./ColumnMapping";
import ManualEntry from "./ManualEntry";

/**
 * Bring a filled sheet back.
 *
 * The one card on this page where somebody acts rather than reads, so it sits
 * on white rather than on the accent tint the other card heads wear. Two doors
 * in, and the sentence that says why neither of them asks which partner the
 * file is for: the stove IDs in it already say.
 *
 * Everything here is props in and callbacks out. The file input, the duplicate
 * guard, the column mapping and the typed record are all ImportPanel's state;
 * this file only draws them.
 */
export default function UploadStrip({
  busy,
  fileInputRef,
  onFile,
  onChooseFile,
  onTypeOneRecord,
  manual,
  onManualCancel,
  onManualSubmit,
  pendingFile,
  onMappingCancel,
  onMappingConfirm,
  duplicate,
  onUploadAgain,
  onDuplicateDismiss,
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-gray-100 px-4 py-3">
        <span className="text-base font-semibold text-gray-900">Bring a filled sheet back</span>
        <span className="text-sm text-gray-500">staged and checked on upload</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onFile}
          className="hidden"
        />
        <button
          type="button"
          disabled={busy}
          onClick={onChooseFile}
          className="inline-flex items-center gap-1.5 rounded-md bg-(image:--dc-fig-sold) px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          Choose a file
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onTypeOneRecord}
          className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-primary-mid) px-3 py-1.5 text-sm font-medium text-(--dc-primary-strong) transition hover:bg-(--dc-primary-soft)/60 disabled:opacity-50"
        >
          <PenLine className="h-4 w-4" /> Type one record
        </button>
        <p className="min-w-[16rem] flex-1 text-xs text-gray-600">
          {/* Said out loud, because the dropdown that used to be here is
              gone and its absence should read as deliberate. */}
          The stove IDs in the file say which partner it belongs to, so there
          is nothing to choose. Staged and checked on upload; nothing is
          committed until you say so.
        </p>
      </div>

      {manual && (
        <ManualEntry
          busy={busy}
          onCancel={onManualCancel}
          onSubmit={onManualSubmit}
        />
      )}

      {pendingFile && (
        <ColumnMapping
          busy={busy}
          file={pendingFile.file}
          inspection={pendingFile.inspection}
          onCancel={onMappingCancel}
          onConfirm={onMappingConfirm}
        />
      )}

      {duplicate && (
        <div className="flex flex-wrap items-start gap-2 border-t border-amber-300 bg-amber-50 px-4 py-3">
          <Copy className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="min-w-0 flex-1 text-sm text-amber-900">{duplicate.message}</p>
          <button
            type="button"
            disabled={busy}
            onClick={onUploadAgain}
            className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-brief-place) px-2.5 py-1.5 text-xs font-medium text-(--dc-brief-place) transition hover:bg-(--dc-brief-place-soft) disabled:opacity-50"
          >
            Upload it again
          </button>
          <button
            type="button"
            onClick={onDuplicateDismiss}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
          >
            <X className="h-3.5 w-3.5" /> Discard
          </button>
        </div>
      )}
    </div>
  );
}
