import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from "recharts";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import salesAdvancedService from "../../services/salesAdvancedAPIService";

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo",
  "Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa",
  "Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba",
  "Yobe","Zamfara",
];

const STATE_LOOKUP = NIGERIAN_STATES.reduce((acc, s) => {
  acc[s.toLowerCase()] = s;
  return acc;
}, {});
// Aliases
STATE_LOOKUP["abuja"] = "FCT";
STATE_LOOKUP["fct - abuja"] = "FCT";
STATE_LOOKUP["federal capital territory"] = "FCT";

const MONTHS = [
  { value: "all", label: "All Months" },
  { value: "0", label: "January" },
  { value: "1", label: "February" },
  { value: "2", label: "March" },
  { value: "3", label: "April" },
  { value: "4", label: "May" },
  { value: "5", label: "June" },
  { value: "6", label: "July" },
  { value: "7", label: "August" },
  { value: "8", label: "September" },
  { value: "9", label: "October" },
  { value: "10", label: "November" },
  { value: "11", label: "December" },
];

const TOP_OPTIONS = [5, 10, 15, 20, 37];

const SalesByStateChart = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: undefined, to: undefined });
  const [month, setMonth] = useState("all");
  const [topN, setTopN] = useState(10);
  const [calOpen, setCalOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resp = await salesAdvancedService.getSalesData(
          { limit: 10000, responseFormat: "format2" },
          "POST",
          "SalesByStateChart"
        );
        const data = Array.isArray(resp?.data) ? resp.data : (resp?.data?.sales ?? []);
        if (mounted) setRows(data);
      } catch (e) {
        console.error("Sales by state fetch failed:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const chartData = useMemo(() => {
    const counts = Object.fromEntries(NIGERIAN_STATES.map((s) => [s, 0]));
    rows.forEach((r) => {
      const raw = r?.sales_date || r?.sale_date || r?.created_at;
      if (!raw) return;
      const d = new Date(raw);
      if (isNaN(d.getTime())) return;
      if (dateRange.from && d < dateRange.from) return;
      if (dateRange.to) {
        const end = new Date(dateRange.to);
        end.setHours(23, 59, 59, 999);
        if (d > end) return;
      }
      if (month !== "all" && d.getMonth() !== Number(month)) return;
      const rawState = r?.state_backup || r?.state || r?.address?.state;
      if (!rawState) return;
      const normalized = STATE_LOOKUP[String(rawState).trim().toLowerCase()];
      if (!normalized) return;
      const qty = Number(r?.quantity ?? 1) || 1;
      counts[normalized] += qty;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, topN);
  }, [rows, dateRange, month, topN]);

  const dateLabel = dateRange.from
    ? dateRange.to
      ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d")}`
      : format(dateRange.from, "MMM d, yyyy")
    : "Filter by date range";

  const monthLabel = MONTHS.find((m) => m.value === month)?.label ?? "All Months";

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Green header */}
      <div className="bg-[#4a5d0f] px-5 py-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-white text-[15px] font-semibold">Sales by State</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-xs text-white border hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-white/30"
                style={{ backgroundColor: "#6b8519", borderColor: "rgba(255,255,255,0.25)" }}
              >
                <CalendarIcon className="h-3.5 w-3.5 text-white/90" />
                <span className={dateRange.from ? "text-white" : "text-white/80"}>{dateLabel}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={(r) => setDateRange(r || { from: undefined, to: undefined })}
                disabled={(d) => d > new Date()}
                numberOfMonths={2}
              />
              <div className="flex justify-end gap-2 p-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setDateRange({ from: undefined, to: undefined }); setCalOpen(false); }}
                >
                  Clear
                </Button>
                <Button size="sm" onClick={() => setCalOpen(false)} className="bg-[#4a5d0f] hover:bg-[#3a4a0c] text-white">
                  Apply
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-xs text-white border hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-white/30"
                style={{ backgroundColor: "#6b8519", borderColor: "rgba(255,255,255,0.25)" }}
              >
                {monthLabel}
                <ChevronDown className="h-3.5 w-3.5 text-white/90" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              {MONTHS.map((m) => (
                <DropdownMenuItem key={m.value} onClick={() => setMonth(m.value)}>
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-xs text-white border font-semibold hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-white/30"
                style={{ backgroundColor: "#6b8519", borderColor: "rgba(255,255,255,0.25)" }}
              >
                Top {topN}
                <ChevronDown className="h-3.5 w-3.5 text-white/90" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {TOP_OPTIONS.map((n) => (
                <DropdownMenuItem key={n} onClick={() => setTopN(n)}>
                  Top {n}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Chart */}
      <div className="px-4 pt-5 pb-4 bg-white">
        {loading ? (
          <p className="text-xs text-gray-400 text-center py-16">Loading sales by state…</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(360, chartData.length * 32)}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 6, right: 56, left: 4, bottom: 8 }}
              barCategoryGap={2}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12, fill: "#374151" }}
                axisLine={false}
                tickLine={false}
                width={84}
                interval={0}
              />
              <Tooltip
                cursor={{ fill: "rgba(30, 58, 95, 0.06)" }}
                formatter={(v) => [Number(v).toLocaleString(), "Sales"]}
                contentStyle={{ borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }}
              />
              <Bar dataKey="value" fill="#1e3a5f" barSize={18} radius={[0, 2, 2, 0]} minPointSize={2}>
                <LabelList
                  dataKey="value"
                  position="right"
                  fontSize={11}
                  fill="#374151"
                  formatter={(v) => Number(v).toLocaleString()}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default SalesByStateChart;
