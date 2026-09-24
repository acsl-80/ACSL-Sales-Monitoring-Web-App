import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToastNotification } from "../../contexts/useToastNotification";
import { confirmFix } from "../api";
import type { ChangeControlRequest } from "../types";

type RequesterActionsProps = {
  request: ChangeControlRequest;
  onDone: () => void;
};

/**
 * "Is it fixed?" — shown only once the team has marked a request fixed.
 * Yes closes the loop with one call; No opens a short note (at least 3
 * characters, per the confirm action's contract) explaining what is still
 * wrong, which reopens the request as still_open.
 */
export default function RequesterActions({ request, onDone }: RequesterActionsProps) {
  const { toast } = useToastNotification();
  const [stillWrongOpen, setStillWrongOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (request.status !== "fixed") return null;

  const handleConfirm = async (fixed: boolean) => {
    if (!fixed && note.trim().length < 3) return;
    setSubmitting(true);
    setError(null);
    try {
      await confirmFix(request.id, fixed, fixed ? undefined : note.trim());
      toast.success(
        fixed ? "Marked fixed" : "Marked still open",
        fixed ? "Thank you." : "The team will pick it back up.",
      );
      setStillWrongOpen(false);
      setNote("");
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not record your answer.";
      setError(message);
      toast.error("Could not record your answer", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-teal-200 bg-teal-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-teal-800">Is it fixed?</p>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleConfirm(true)}
          disabled={submitting}
        >
          Yes
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setError(null);
            setStillWrongOpen(true);
          }}
          disabled={submitting}
        >
          No
        </Button>
      </div>
      {error && !stillWrongOpen && <p className="text-sm text-red-700">{error}</p>}

      <Dialog open={stillWrongOpen} onOpenChange={setStillWrongOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What do you still see?</DialogTitle>
            <DialogDescription>
              Say what is still not right, so the team can pick it back up.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="What still isn't right?"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStillWrongOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm(false)}
              disabled={submitting || note.trim().length < 3}
            >
              {submitting ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
