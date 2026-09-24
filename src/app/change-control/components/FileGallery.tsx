import { FileText } from "lucide-react";
import type { ChangeControlFile } from "../types";

function fileUrl(file: ChangeControlFile): string | null {
  return file.url || file.signed_url || file.download_url || null;
}
function fileName(file: ChangeControlFile): string {
  return file.file_name || file.name || "screenshot";
}
function fileMime(file: ChangeControlFile): string {
  return file.mime_type || file.type || "";
}

type FileGalleryProps = {
  files: ChangeControlFile[];
  compact?: boolean;
};

/**
 * The list action's contract names a `files` array on a request but does not
 * pin down one file's own shape (see types.ts). This reads it defensively:
 * a file with no recognisable link still shows as a named chip instead of
 * disappearing or breaking the page.
 */
export default function FileGallery({ files, compact = false }: FileGalleryProps) {
  if (files.length === 0) return null;
  return (
    <div
      className={`grid grid-cols-2 gap-3 ${compact ? "sm:grid-cols-4" : "sm:grid-cols-3 md:grid-cols-4"}`}
    >
      {files.map((f, i) => {
        const url = fileUrl(f);
        const mime = fileMime(f);
        const isImage = mime ? mime.startsWith("image/") : !!url;
        return (
          <a
            key={f.id ?? `${fileName(f)}-${i}`}
            href={url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className={`relative block rounded-md border border-gray-200 bg-white p-1 ${url ? "" : "pointer-events-none opacity-70"}`}
          >
            {url && isImage ? (
              <img src={url} alt={fileName(f)} className="h-24 w-full rounded object-cover" />
            ) : (
              <div className="flex h-24 w-full flex-col items-center justify-center gap-1 bg-gray-100 text-gray-500">
                <FileText className="h-8 w-8" />
                <span className="px-1 text-center text-[10px] leading-tight">{fileName(f)}</span>
              </div>
            )}
          </a>
        );
      })}
    </div>
  );
}
