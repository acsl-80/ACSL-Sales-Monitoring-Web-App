import { useEffect, useState } from "react";

/**
 * A value that settles after the typing stops.
 *
 * Moved out of the sales report in slice 10a of the 2026-09-02 review so the
 * Performance Report's server-paged search can wait the same 350 ms before
 * it asks.
 */
export function useSettled<T>(value: T, ms = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
