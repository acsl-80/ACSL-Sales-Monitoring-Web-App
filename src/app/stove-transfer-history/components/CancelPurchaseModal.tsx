import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";
import type { TransferRecord } from "@/app/services/transferHistoryService";
import {
  checkPurchaseCancellable,
  cancelPurchase,
  type BlockingSale,
} from "@/app/services/cancelPurchaseService";

interface Props {
  record: TransferRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onCancelled: () => void;
}

export default function CancelPurchaseModal({ record, isOpen, onClose, onCancelled }: Props) {
  const [checking, setChecking] = useState(false);
  const [blocking, setBlocking] = useState<BlockingSale[] | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!isOpen || !record) return;
    setReason("");
    setError(null);
    setBlocking(null);
    setConfirmed(false);
    setChecking(true);
    checkPurchaseCancellable(record.id)
      .then((rows) => setBlocking(rows))
      .catch((e) => setError(e?.message || "Failed to check sales"))
      .finally(() => setChecking(false));
  }, [isOpen, record]);

  if (!record) return null;

  const canProceed = blocking !== null && blocking.length === 0;
  const reasonValid = reason.trim().length >= 5;

  const handleConfirm = async () => {
    if (!canProceed || !reasonValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await cancelPurchase(record.id, reason.trim());
      onCancelled();
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to cancel purchase");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-3 bg-red-50 border-b border-red-100 shrink-0">
          <DialogTitle className="text-base font-bold text-red-700 flex items-center gap-2">
            <Ban className="h-4 w-4" />
            {blocking && blocking.length > 0
              ? "Cannot cancel this purchase"
              : "Cancel purchase"}
          </DialogTitle>
          <p className="text-xs text-red-700/80 mt-0.5">
            Transaction <span className="font-mono">{record.transaction_id}</span> · Partner{" "}
            <span className="font-semibold">{record.partner_name}</span>
          </p>
        </DialogHeader>

        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {checking && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking whether any of the {record.stove_count} stove IDs have been sold…
            </div>
          )}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
              {error}
            </div>
          )}

          {!checking && blocking && blocking.length > 0 && (
            <>
              <div className="text-sm text-gray-800 bg-amber-50 border border-amber-200 rounded p-3 flex gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  One or more stoves in this transaction have already been sold. You must{" "}
                  <strong>cancel those sales first</strong> before this purchase can be removed.
                </div>
              </div>
              <div className="border rounded overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Stove ID</TableHead>
                      <TableHead>Sales Reference</TableHead>
                      <TableHead>Sale Date</TableHead>
                      <TableHead>Partner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blocking.map((b) => (
                      <TableRow key={b.sale_id}>
                        <TableCell className="font-mono">{b.stove_serial_no || "—"}</TableCell>
                        <TableCell className="font-mono">{b.sales_reference || "—"}</TableCell>
                        <TableCell>{b.sales_date || "—"}</TableCell>
                        <TableCell>{b.partner_name || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {!checking && canProceed && (
            <>
              <div className="text-sm bg-amber-50 border border-amber-200 rounded p-3 space-y-1">
                <div className="flex items-center gap-2 font-semibold text-amber-800">
                  <AlertTriangle className="h-4 w-4" />
                  What will happen
                </div>
                <ul className="list-disc pl-6 text-gray-800 space-y-0.5">
                  <li>
                    All <strong>{record.stove_count}</strong> stove ID(s) in this transaction will be{" "}
                    <strong>permanently deleted</strong> from the system.
                  </li>
                  <li>The transfer record will be moved to <strong>Cancelled Purchases</strong>.</li>
                  <li>Partner details (contact, branch, state) will <strong>not</strong> be affected.</li>
                  <li>This action <strong>cannot be undone</strong>.</li>
                </ul>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  Reason for cancellation <span className="text-red-600">*</span>
                </label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this purchase being cancelled? (min 5 characters)"
                  rows={3}
                  className="mt-1"
                />
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  I understand this will permanently delete {record.stove_count} stove ID(s) and cannot be
                  undone.
                </span>
              </label>
            </>
          )}
        </div>

        <DialogFooter className="px-4 py-3 border-t bg-gray-50">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Close
          </Button>
          {canProceed && (
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleConfirm}
              disabled={!reasonValid || !confirmed || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Cancelling…
                </>
              ) : (
                "Confirm Cancellation"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
