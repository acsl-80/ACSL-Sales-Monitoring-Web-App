
import { useState, useRef, useEffect } from "react";
import { ChevronDown, CalendarDays, Check } from "lucide-react";

const START_YEAR = 2024;

const getAvailableYears = (): number[] => {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = START_YEAR; y <= current; y++) years.push(y);
  return years;
};

const getLabel = (years: number[], available: number[]): string => {
  if (years.length === 0) return "All Years";
  if (years.length === available.length) return "All Years";
  const sorted = [...years].sort((a, b) => a - b);
  if (sorted.length === 1) return `Year ${sorted[0]}`;
  return `Year ${sorted[0]} – ${sorted[sorted.length - 1]}`;
};

interface YearFilterProps {
  selectedYears: number[];
  onChange: (years: number[]) => void;
}

const YearFilter: React.FC<YearFilterProps> = ({ selectedYears, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const available = getAvailableYears();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (year: number) => {
    let updated = selectedYears.includes(year)
      ? selectedYears.filter((y) => y !== year)
      : [...selectedYears, year].sort((a, b) => a - b);
    if (updated.length === 0) return; // must keep at least one
    onChange(updated);
  };

  const selectAll = () => onChange([...available]);
  const selectCurrent = () => onChange([new Date().getFullYear()]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
      >
        <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
        <span>{getLabel(selectedYears, available)}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Select Year(s)</p>
          <div className="space-y-1 mb-3">
            {available.map((year) => (
              <label key={year} className="flex items-center gap-2.5 px-1.5 py-1 rounded hover:bg-gray-50 cursor-pointer select-none">
                <div
                  className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${
                    selectedYears.includes(year)
                      ? "bg-brand border-brand"
                      : "border-gray-300 bg-white"
                  }`}
                  onClick={() => toggle(year)}
                >
                  {selectedYears.includes(year) && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
                <span className="text-sm text-gray-700">{year}</span>
              </label>
            ))}
          </div>
          <div className="border-t border-gray-100 pt-2 flex gap-2">
            <button
              onClick={selectCurrent}
              className="flex-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 py-1 rounded transition-colors"
            >
              Current
            </button>
            <button
              onClick={selectAll}
              className="flex-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 py-1 rounded transition-colors"
            >
              All
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default YearFilter;
