/**
 * Fixed-height row virtualization, in about forty lines.
 *
 * WHY NOT A LIBRARY
 *
 * @tanstack/react-virtual would do this and more. Taking it would mean adding a
 * dependency, which means editing package.json and bun.lock. Both sit in the
 * sync workflow's HIGH_RISK list, both are touched by the daily contractor
 * merge into main, and the Data Center's whole delivery promise is that it
 * changes exactly two shared files. A lockfile conflict every time a contractor
 * bumps a package is a worse trade than forty lines of arithmetic.
 *
 * The arithmetic is only simple because every row is the same height. That is a
 * deliberate constraint on the table, not an accident: measured rows would be
 * the point to take the library instead.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface VirtualWindow {
  /** Index of the first row to render. */
  start: number;
  /** Index one past the last row to render. */
  end: number;
  /** Total scrollable height, so the scrollbar reflects every row. */
  totalHeight: number;
  /** Offset of the first rendered row inside that height. */
  offsetTop: number;
}

export function useVirtualRows(
  rowCount: number,
  rowHeight: number,
  /** Rows rendered above and below the viewport, to cover fast scrolling. */
  overscan = 8,
): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  window: VirtualWindow;
  onScroll: () => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
  }, []);

  useEffect(() => {
    measure();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const visible = Math.ceil((viewportHeight || 600) / rowHeight);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(rowCount, start + visible + overscan * 2);

  return {
    containerRef,
    onScroll: measure,
    window: {
      start,
      end,
      totalHeight: rowCount * rowHeight,
      offsetTop: start * rowHeight,
    },
  };
}
