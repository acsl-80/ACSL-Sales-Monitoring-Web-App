import { useState } from "react";
import { X, ZoomIn } from "lucide-react";
import type { GuideFigure as GuideFigureType } from "./guideContent";

const GREEN = "#4a5d0f";

interface Props {
  figure: GuideFigureType;
  index: number;
}

/**
 * A screenshot with numbered annotation markers, arrows, highlight boxes and a
 * caption. Click the image to open it full size.
 */
export default function GuideFigure({ figure, index }: Props) {
  const [zoomed, setZoomed] = useState(false);
  const markers = figure.markers ?? [];
  const boxes = figure.boxes ?? [];

  const overlay = (large: boolean) => (
    <>
      {boxes.map((box, i) => (
        <div
          key={`box-${i}`}
          className="absolute rounded pointer-events-none"
          style={{
            left: `${box.x}%`,
            top: `${box.y}%`,
            width: `${box.w}%`,
            height: `${box.h}%`,
            border: `2px solid ${GREEN}`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0)",
          }}
        />
      ))}
      {markers.map((m) => (
        <div
          key={`marker-${m.n}`}
          className="absolute flex items-center pointer-events-none"
          style={{ left: `${m.x}%`, top: `${m.y}%`, transform: "translate(-50%, -50%)" }}
        >
          <span
            className={`flex items-center justify-center rounded-full text-white font-bold shadow ${
              large ? "h-7 w-7 text-[13px]" : "h-5 w-5 text-[10px]"
            }`}
            style={{ backgroundColor: GREEN, border: "2px solid #fff" }}
          >
            {m.n}
          </span>
          {m.arrow !== false && (
            <span
              className="block rounded-full"
              style={{
                backgroundColor: GREEN,
                height: 2,
                width: large ? 34 : 22,
                marginLeft: 2,
                transform: m.arrowDirection === "left" ? "rotate(180deg)" : undefined,
                transformOrigin: "left center",
              }}
            />
          )}
        </div>
      ))}
    </>
  );

  return (
    <figure className="my-5 max-w-[560px]">
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className="group relative block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
        aria-label={`Enlarge screenshot: ${figure.caption}`}
      >
        <img src={figure.src} alt={figure.alt ?? figure.caption} className="block w-full" loading="lazy" />
        {overlay(false)}
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 opacity-0 transition-opacity group-hover:opacity-100">
          <ZoomIn className="h-3 w-3" /> Click to enlarge
        </span>
      </button>

      <figcaption className="mt-2 text-xs text-gray-600">
        <span className="font-semibold" style={{ color: GREEN }}>
          Figure {index}.
        </span>{" "}
        {figure.caption}
      </figcaption>

      {markers.length > 0 && (
        <ol className="mt-2 space-y-1">
          {markers.map((m) => (
            <li key={`legend-${m.n}`} className="flex items-start gap-2 text-xs text-gray-700">
              <span
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ backgroundColor: GREEN }}
              >
                {m.n}
              </span>
              <span>{m.label}</span>
            </li>
          ))}
        </ol>
      )}

      {zoomed && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setZoomed(false)}
        >
          <div
            className="relative max-h-full max-w-6xl overflow-auto rounded-lg bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setZoomed(false)}
              className="absolute right-2 top-2 z-10 rounded bg-white/90 p-1 text-gray-600 hover:text-gray-900"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="relative">
              <img src={figure.src} alt={figure.alt ?? figure.caption} className="block w-full" />
              {overlay(true)}
            </div>
            <p className="px-4 py-3 text-xs text-gray-600">{figure.caption}</p>
          </div>
        </div>
      )}
    </figure>
  );
}
