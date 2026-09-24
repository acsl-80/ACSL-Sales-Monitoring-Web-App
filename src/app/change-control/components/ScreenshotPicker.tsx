// Ported and adapted from the ERP's change-control ScreenshotPicker
// (erp-web/src/components/erp/change-control/components/ScreenshotPicker.tsx):
// same paste/drop/pick behaviour and the same downscaling, with the
// attachment settings passed in as props (from the form action's answer)
// instead of read from an ERP-only options hook.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Button } from "@/components/ui/button";
import { FileText, ImagePlus, X } from "lucide-react";
import { processImageForUpload } from "../lib/images";
import type { PendingFile } from "../types";

interface ScreenshotPickerProps {
  files: PendingFile[];
  // A setState-style updater: two pastes or drops in quick succession both
  // read whatever `files` prop was current when the click happened, so
  // building the next list from that stale snapshot silently drops one of
  // them. The functional form always builds from the latest committed state.
  onFilesChange: Dispatch<SetStateAction<PendingFile[]>>;
  maxFiles: number;
  maxMb: number;
  mimeTypes: string[];
}

const ScreenshotPicker = ({
  files,
  onFilesChange,
  maxFiles,
  maxMb,
  mimeTypes,
}: ScreenshotPickerProps) => {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (incoming: File[]) => {
      const errors: string[] = [];
      const processed: PendingFile[] = [];

      for (const raw of incoming) {
        if (!mimeTypes.includes(raw.type)) {
          errors.push(`${raw.name}: that file type is not accepted here.`);
          continue;
        }

        let result;
        try {
          result = await processImageForUpload(raw);
        } catch {
          errors.push(`${raw.name}: could not be read.`);
          continue;
        }

        if (result.blob.size > maxMb * 1024 * 1024) {
          errors.push(`${raw.name}: still over ${maxMb} MB after downscaling.`);
          continue;
        }

        const extFromMime =
          result.mime === "image/jpeg" ? "jpg" : raw.name.split(".").pop() || "bin";
        const baseName = raw.name.replace(/\.[^.]+$/, "") || "screenshot";
        const fileObj = new File([result.blob], `${baseName}.${extFromMime}`, {
          type: result.mime,
        });

        processed.push({
          id: crypto.randomUUID(),
          file: fileObj,
          previewUrl: URL.createObjectURL(fileObj),
          width: result.width,
          height: result.height,
        });
      }

      let overflow = 0;
      onFilesChange((prev) => {
        const room = Math.max(0, maxFiles - prev.length);
        overflow = processed.length - room;
        return room >= processed.length
          ? [...prev, ...processed]
          : [...prev, ...processed.slice(0, room)];
      });

      if (overflow > 0) {
        processed
          .slice(processed.length - overflow)
          .forEach((f) => URL.revokeObjectURL(f.previewUrl));
        errors.push(`Only ${maxFiles} files can be attached at a time.`);
      }

      setError(errors.length ? errors.join(" ") : null);
    },
    [maxFiles, maxMb, mimeTypes, onFilesChange],
  );

  // Paste from the clipboard anywhere on the page while this picker is open.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const pasted: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) pasted.push(file);
        }
      }
      if (pasted.length) {
        event.preventDefault();
        void addFiles(pasted);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length) void addFiles(dropped);
  };

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length) void addFiles(picked);
    event.target.value = "";
  };

  const removeFile = (id: string) => {
    onFilesChange((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragActive ? "border-brand bg-brand/5" : "border-gray-300 bg-gray-50"
        }`}
      >
        <ImagePlus className="h-8 w-8 text-gray-400" />
        <p className="text-sm text-gray-600">Drag and drop files here, paste a screenshot, or</p>
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={mimeTypes.join(",")}
          onChange={handlePick}
          className="hidden"
        />
        <p className="text-xs text-gray-500">
          A screenshot helps most. On Windows press Windows+Shift+S, then Ctrl+V here.
        </p>
        <p className="text-xs text-gray-400">
          Up to {maxFiles} files, {maxMb} MB each.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {files.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {files.map((f) => (
            <div key={f.id} className="relative rounded-md border border-gray-200 bg-white p-1">
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                className="absolute -right-2 -top-2 z-10 rounded-full bg-gray-800 p-1 text-white hover:bg-gray-900"
                aria-label={`Remove ${f.file.name}`}
              >
                <X className="h-3 w-3" />
              </button>
              {f.file.type === "application/pdf" ? (
                <div className="flex h-24 w-full flex-col items-center justify-center gap-1 bg-gray-100 text-gray-500">
                  <FileText className="h-8 w-8" />
                  <span className="px-1 text-center text-[10px] leading-tight">{f.file.name}</span>
                </div>
              ) : (
                <img
                  src={f.previewUrl}
                  alt={f.file.name}
                  className="h-24 w-full rounded object-cover"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScreenshotPicker;
