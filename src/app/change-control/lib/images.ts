// Downscales a picked image before it is uploaded, so a full-resolution phone
// photo does not sit in storage at several times the size anyone needs.
// Ported unchanged from the ERP's change-control ScreenshotPicker
// (erp-web/src/components/erp/change-control/lib/images.ts) — the same
// downscaling should behave the same way in both apps.

const MAX_SIDE = 1600;
const MAX_BYTES_BEFORE_DOWNSCALE = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.82;

export interface ProcessedImage {
  blob: Blob;
  width?: number;
  height?: number;
  mime: string;
}

async function loadDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}

/**
 * If an image's longest side is over 1600px or it is over 1.5 MB, redraw it
 * to a canvas at a maximum of 1600px on its longest side and re-export as
 * image/jpeg at quality 0.82. GIF and PDF files are left untouched (their
 * dimensions are still read where possible, so the attachment can carry
 * width/height for an image).
 */
export async function processImageForUpload(file: File): Promise<ProcessedImage> {
  if (file.type === "application/pdf") {
    return { blob: file, mime: file.type };
  }

  const dims = await loadDimensions(file);

  if (file.type === "image/gif" || !dims) {
    return { blob: file, width: dims?.width, height: dims?.height, mime: file.type };
  }

  const longestSide = Math.max(dims.width, dims.height);
  if (longestSide <= MAX_SIDE && file.size <= MAX_BYTES_BEFORE_DOWNSCALE) {
    return { blob: file, width: dims.width, height: dims.height, mime: file.type };
  }

  const scale = Math.min(1, MAX_SIDE / longestSide);
  const targetWidth = Math.max(1, Math.round(dims.width * scale));
  const targetHeight = Math.max(1, Math.round(dims.height * scale));

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { blob: file, width: dims.width, height: dims.height, mime: file.type };
  }
  // A transparent PNG re-encoded straight to JPEG (no alpha channel) turns its
  // transparent areas black. Paint white first, as most image editors do.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );

  if (!blob) {
    return { blob: file, width: dims.width, height: dims.height, mime: file.type };
  }

  return { blob, width: targetWidth, height: targetHeight, mime: "image/jpeg" };
}
