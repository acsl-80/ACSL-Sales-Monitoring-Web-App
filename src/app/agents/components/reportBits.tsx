/**
 * The small presentational pieces the Performance Report tabs share: a KPI
 * card, a status pill and a sortable table header. Moved out of the States
 * report in slice 10a of the 2026-09-02 review so the server-paged stove
 * modal can use the same pill.
 */

import type { ReactNode } from "react";
import { TableHead } from "@/components/ui/table";

export function Kpi({
  icon: Icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: any;
  label: string;
  value: number;
  tone: "blue" | "indigo" | "teal" | "orange" | "emerald" | "violet";
  sub?: string;
}) {
  const toneMap: Record<string, string> = {
    blue: "from-blue-500 to-blue-600",
    indigo: "from-indigo-500 to-indigo-600",
    teal: "from-teal-500 to-emerald-600",
    orange: "from-orange-500 to-amber-600",
    emerald: "from-emerald-500 to-green-600",
    violet: "from-violet-500 to-purple-600",
  };
  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${toneMap[tone]} p-3 text-white shadow-sm`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight">{value.toLocaleString()}</div>
          <div className="mt-0.5 text-[11px] font-medium text-white/90">{label}</div>
          {sub ? <div className="mt-1 text-[10px] font-medium text-white/80">{sub}</div> : null}
        </div>
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/20 backdrop-blur-sm">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

export function Pill({ children, tone }: { children: ReactNode; tone: "green" | "slate" | "emerald" | "rose" }) {
  const map: Record<string, string> = {
    green: "bg-[#eef3c4] text-[#4a5d0f]",
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-700",
    rose: "bg-rose-100 text-rose-700",
  };
  return (
    <span className={`inline-flex min-w-[2rem] justify-center rounded-full px-2 py-0.5 text-[11px] font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

export function SortableTh<K extends string>({
  label,
  k,
  sortKey,
  onClick,
  icon,
  align = "center",
}: {
  label: string;
  k: K;
  sortKey: K;
  onClick: (k: K) => void;
  icon: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <TableHead
      className={`cursor-pointer text-white hover:bg-[#3f4f0d] ${align === "center" ? "text-center" : "text-left"}`}
      onClick={() => onClick(k)}
      aria-sort={sortKey === k ? "other" : "none"}
    >
      <span className="inline-flex items-center">
        {label}
        {icon}
      </span>
    </TableHead>
  );
}
