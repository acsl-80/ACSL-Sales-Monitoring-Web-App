/**
 * The Agents Performance Report's "Records Collected" chart.
 *
 * Slice 11c of the 2026-09-02 review (finding F7). The chart paged the agent
 * roster through three role loops, read the sales table twice per two hundred
 * agents, and bucketed the rows by month in the browser with no regard to the
 * year, so every January of every year landed in one bar. It now asks the
 * database for one year's twelve months in one call and draws them. The year
 * follows the page's chosen start date, else this year.
 */

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
import { chartYear, useAgentRecordsByMonth } from "../hooks/useAgentRecordsByMonth";

interface AgentRecordsChartProps {
  title: string;
  tooltipLabel: string;
  /** The page's chosen start date; its year is the chart's year. */
  dateFrom?: string | null;
}

const AgentRecordsChart = ({ title, tooltipLabel, dateFrom }: AgentRecordsChartProps) => {
  const year = chartYear(dateFrom);
  const { monthly, isPending, error } = useAgentRecordsByMonth(year);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
        <span className="text-[10px] font-semibold tracking-[0.15em] text-gray-400 uppercase">
          {title} {year}
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={monthly} margin={{ top: 24, right: 16, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="agentMonthlyBarFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4a5d0f" />
              <stop offset="100%" stopColor="#eef3c4" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax))]}
          />
          <Tooltip
            formatter={(v) => [Number(v).toLocaleString(), tooltipLabel]}
            contentStyle={{ borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }}
          />
          <Bar dataKey="value" fill="url(#agentMonthlyBarFill)" barSize={42} radius={[3, 3, 0, 0]} />
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
      {isPending && <p className="text-xs text-gray-400 mt-2 text-center">Loading {title.toLowerCase()}...</p>}
      {error && !isPending && <p className="text-xs text-red-600 mt-2 text-center">{error}</p>}
    </div>
  );
};

export default AgentRecordsChart;
