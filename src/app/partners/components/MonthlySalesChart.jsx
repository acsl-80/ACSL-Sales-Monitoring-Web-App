import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
  Line,
  LabelList,
} from "recharts";
import salesAdvancedService from "../../services/salesAdvancedAPIService";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function bucketMonthlySales(rows) {
  const counts = new Array(12).fill(0);
  (rows || []).forEach((r) => {
    const raw = r?.sales_date || r?.sale_date || r?.created_at;
    if (!raw) return;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return;
    const qty = Number(r?.quantity ?? 1) || 1;
    counts[d.getMonth()] += qty;
  });
  return MONTHS.map((m, i) => ({ month: m, value: counts[i] }));
}

const MonthlySalesChart = ({ title = "Monthly Sales", tooltipLabel = "Sales" } = {}) => {
  const [monthly, setMonthly] = useState(MONTHS.map((m) => ({ month: m, value: 0 })));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resp = await salesAdvancedService.getSalesData(
          { limit: 5000, responseFormat: "format2" },
          "POST",
          "TrackPerformanceMonthlySales"
        );
        const rows = Array.isArray(resp?.data) ? resp.data : (resp?.data?.sales ?? []);
        if (mounted) setMonthly(bucketMonthlySales(rows));
      } catch (e) {
        console.error("Monthly sales fetch failed:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
        <span className="text-[10px] font-semibold tracking-[0.15em] text-gray-400 uppercase">
          {title}
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={monthly} margin={{ top: 24, right: 16, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="partnerMonthlyBarFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1e3a5f" />
              <stop offset="100%" stopColor="#bcd4f0" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} domain={[0, (dataMax) => Math.max(1, Math.ceil(dataMax))]} />
          <Tooltip
            formatter={(v) => [Number(v).toLocaleString(), tooltipLabel]}
            contentStyle={{ borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }}
          />
          <Bar dataKey="value" fill="url(#partnerMonthlyBarFill)" barSize={42} radius={[3, 3, 0, 0]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#f59e0b"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#f59e0b", stroke: "#f59e0b" }}
            activeDot={{ r: 5 }}
          >
            <LabelList dataKey="value" position="top" fontSize={11} fill="#374151" />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
      {loading && (
        <p className="text-xs text-gray-400 mt-2 text-center">Loading {title.toLowerCase()}…</p>
      )}
    </div>
  );
};

export default MonthlySalesChart;
