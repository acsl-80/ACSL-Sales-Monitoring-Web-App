import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToastNotification } from "../../contexts/useToastNotification";
import { formatDateTime } from "../../utils/formatDate";
import { attachScreenshots, replyToRequest } from "../api";
import { useChangeControlForm } from "../hooks/useChangeControlForm";
import { STATUS_META } from "../lib/status";
import type { ChangeControlFile, ChangeControlRequest, PendingFile } from "../types";
import FileGallery from "./FileGallery";
import ScreenshotPicker from "./ScreenshotPicker";
import StatusChip from "./StatusChip";

const AUTHOR_LABEL: Record<string, string> = {
  you: "You",
  team: "ACSL team",
  reviewer: "Change Control",
  system: "Change Control",
};

const revokePendingFiles = (list: PendingFile[]) =>
  list.forEach((f) => URL.revokeObjectURL(f.previewUrl));

type RequestThreadProps = {
  request: ChangeControlRequest;
  onPosted: () => void;
};

export default function RequestThread({ request, onPosted }: RequestThreadProps) {
  const { toast } = useToastNotification();
  const { data: form } = useChangeControlForm();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filesByComment = new Map<string, ChangeControlFile[]>();
  for (const f of request.files ?? []) {
    if (!f.comment_id) continue;
    filesByComment.set(f.comment_id, [...(filesByComment.get(f.comment_id) ?? []), f]);
  }

  const handlePost = async () => {
    const text = body.trim();
    if (text.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const posted = await replyToRequest(request.id, text);
      if (files.length > 0) {
        try {
          await attachScreenshots(
            request.id,
            files.map((f) => f.file),
            posted.id,
          );
        } catch (err) {
          toast.error(
            "Reply posted",
            `The screenshots were not attached: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        }
      }
      revokePendingFiles(files);
      setFiles([]);
      setBody("");
      toast.success(
        "Reply posted",
        posted.status === "new" ? "Moved back to New." : "The team will see this.",
      );
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the reply.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {request.thread.length === 0 && <p className="text-sm text-gray-400">No replies yet.</p>}

      <ul className="space-y-3">
        {request.thread.map((item) => {
          const when = formatDateTime(item.at);
          const author = AUTHOR_LABEL[item.from] ?? item.from;
          const attachments = filesByComment.get(item.id) ?? [];

          if (item.kind === "status_note") {
            const meta = item.status_to ? STATUS_META[item.status_to] : undefined;
            return (
              <li
                key={item.id}
                className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm"
              >
                {meta && (
                  <div className="mb-1">
                    <StatusChip label={meta.label} tone={meta.tone} />
                  </div>
                )}
                <p className="text-gray-700">{item.body}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {author} &middot; {when}
                </p>
              </li>
            );
          }

          if (item.kind === "merge_note") {
            return (
              <li
                key={item.id}
                className="rounded-md border border-gray-100 bg-gray-50 p-3 text-sm text-gray-500"
              >
                <p>{item.body}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {author} &middot; {when}
                </p>
              </li>
            );
          }

          return (
            <li key={item.id} className="rounded-md border border-gray-200 bg-white p-3 text-sm">
              <p className="font-medium text-gray-700">
                {author} <span className="font-normal text-gray-400">&middot; {when}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap text-gray-700">{item.body}</p>
              {attachments.length > 0 && (
                <div className="mt-2">
                  <FileGallery files={attachments} compact />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs text-gray-500">
          Add a reply. A reply to Needs info moves the request back to New.
        </p>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Write a reply"
        />
        {form && (
          <ScreenshotPicker
            files={files}
            onFilesChange={setFiles}
            maxFiles={form.attachments.max_files}
            maxMb={form.attachments.max_mb}
            mimeTypes={form.attachments.mime_types}
          />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => void handlePost()}
            disabled={submitting || body.trim().length === 0}
          >
            {submitting ? "Posting..." : "Post"}
          </Button>
        </div>
      </div>
    </div>
  );
}
