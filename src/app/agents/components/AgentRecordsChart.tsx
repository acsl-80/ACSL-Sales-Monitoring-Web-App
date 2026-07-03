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
import { useAuth } from "../../contexts/useAuth";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const AGENT_ROLES = ["acsl_agent", "acsl_agent_manager"];

function bucketMonthlySales(rows: any[]) {
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

const AgentRecordsChart = ({
  title = "Records Collected",
  tooltipLabel = "Collected",
}: {
  title?: string;
  tooltipLabel?: string;
}) => {
  const { supabase } = useAuth();
  const [monthly, setMonthly] = useState(
    MONTHS.map((m) => ({ month: m, value: 0 }))
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!supabase) return;

    (async () => {
      try {
        // 1. Gather every user ID that has an ACSL agent role
        const { data: profilesData, error: profilesError } = await supabase
          .from("profiles")
          .select("id")
          .in("role", AGENT_ROLES);

        if (profilesError) throw profilesError;

        const agentIds = (profilesData || [])
          .map((p: any) => p.id)
          .filter(Boolean);

        if (agentIds.length === 0) {
          if (mounted) {
            setMonthly(MONTHS.map((m) => ({ month: m, value: 0 })));
            setLoading(false);
          }
          return;
        }

        // 2. Fetch sales created by those agents (batched IN queries)
        const BATCH = 200;
        const allSales: any[] = [];

        for (let i = 0; i < agentIds.length; i += BATCH) {
          const batch = agentIds.slice(i, i + BATCH);
          const { data, error } = await supabase
            .from("sales")
            .select("sales_date, quantity, created_at")
            .in("created_by", batch)
            .eq("is_archived", false);

          if (error) throw error;
          allSales.push(...(data || []));
        }

        if (mounted) {
          setMonthly(bucketMonthlySales(allSales));
        }
      } catch (e) {
        console.error("Agent records fetch failed:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [supabase]);

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
        <ComposedChart
          data={monthly}
          margin={{ top: 24, right: 16, left: 0, bottom: 8 }}
        >
          <defs>
            <linearGradient id="agentMonthlyBarFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4a5d0f" />
              <stop offset="100%" stopColor="#eef3c4" />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#e5e7eb"
            vertical={false}
          />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={{ stroke: "#e5e7eb" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax))]}
          />
          <Tooltip
            formatter={(v) => [Number(v).toLocaleString(), tooltipLabel]}
            contentStyle={{
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              fontSize: 12,
            }}
          />
          <Bar
            dataKey="value"
            fill="url(#agentMonthlyBarFill)"
            barSize={42}
            radius={[3, 3, 0, 0]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#f59e0b"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#f59e0b", stroke: "#f59e0b" }}
            activeDot={{ r: 5 }}
          >
            <LabelList
              dataKey="value"
              position="top"
              fontSize={11}
              fill="#374151"
            />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
      {loading && (
        <p className="text-xs text-gray-400 mt-2 text-center">
          Loading {title.toLowerCase()}…
        </p>
      )}
    </div>
  );
};

export default AgentRecordsChart;
