import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { getSupabase } from "@/lib/supabaseClient";

const COLORS = ["#4a5d0f", "#7b8b3a", "#c7d16f", "#eef3c4", "#f59e0b", "#1e3a5f", "#bcd4f0", "#9ca3af"];

const SalesByModelsChart = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: sales, error } = await supabase
          .from("sales")
          .select("payment_model_id")
          .eq("is_archived", false);
        if (error) throw error;

        const ids = Array.from(new Set((sales || []).map((s) => s.payment_model_id).filter(Boolean)));
        let names = {};
        if (ids.length) {
          const { data: models } = await supabase.from("payment_models").select("id, name").in("id", ids);
          (models || []).forEach((m) => { names[m.id] = m.name; });
        }
        const counts = {};
        (sales || []).forEach((s) => {
          const label = s.payment_model_id ? (names[s.payment_model_id] || "Other") : "Outright";
          counts[label] = (counts[label] || 0) + 1;
        });
        const arr = Object.entries(counts)
          .map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length] }))
          .sort((a, b) => b.value - a.value);
        if (mounted) setData(arr);
      } catch (e) {
        console.error("Sales by models fetch failed:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  const renderOutsideLabel = (totalVal) => (props) => {
    const { cx, cy, midAngle, outerRadius, value, fill } = props;
    if (!value) return null;
    const RAD = Math.PI / 180;
    const sin = Math.sin(-midAngle * RAD);
    const cos = Math.cos(-midAngle * RAD);
    const sx = cx + outerRadius * cos;
    const sy = cy + outerRadius * sin;
    const mx = cx + (outerRadius + 14) * cos;
    const my = cy + (outerRadius + 14) * sin;
    const ex = mx + (cos >= 0 ? 1 : -1) * 14;
    const ey = my;
    const textAnchor = cos >= 0 ? "start" : "end";
    const pct = ((value / (totalVal || 1)) * 100).toFixed(1);
    return (
      <g>
        <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" />
        <circle cx={ex} cy={ey} r={2} fill={fill} stroke="none" />
        <text
          x={ex + (cos >= 0 ? 4 : -4)}
          y={ey}
          textAnchor={textAnchor}
          dominantBaseline="central"
          fill={fill}
          style={{ fontSize: 12, fontWeight: 600, fontFamily: "Arial, sans-serif" }}
        >
          {pct}%
        </text>
      </g>
    );
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden h-full flex flex-col">
      <div className="bg-[#4a5d0f] px-4 py-3 flex items-center justify-between">
        <h3 className="text-white text-sm font-semibold">Sales by Models</h3>
      </div>
      <div className="flex-1 p-4">
        {loading ? (
          <div className="flex items-center justify-center h-[260px] text-sm text-gray-500">Loading…</div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-[260px] text-sm text-gray-500">No sales data</div>
        ) : (
          <>
            <div className="relative">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart margin={{ top: 20, right: 40, bottom: 20, left: 40 }}>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={88}
                    paddingAngle={1}
                    dataKey="value"
                    nameKey="name"
                    stroke="none"
                    labelLine={false}
                    label={renderOutsideLabel(total)}
                    isAnimationActive={false}
                  >
                    {data.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, n) => [Number(v).toLocaleString(), n]}
                    contentStyle={{ borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold text-gray-900 tracking-tight">
                  {total.toLocaleString()}
                </span>
                <span className="text-[10px] font-semibold tracking-wider text-gray-500 mt-0.5">
                  TOTAL SALES
                </span>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 mt-2">
              {data.map((e) => {
                const pct = ((e.value / (total || 1)) * 100).toFixed(1);
                return (
                  <div key={e.name} className="flex items-center gap-1.5 text-[12px]" style={{ fontFamily: "Arial, sans-serif" }}>
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: e.color }} />
                    <span className="text-gray-800">
                      {e.name} <span className="text-gray-500">({e.value.toLocaleString()} • {pct}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SalesByModelsChart;
