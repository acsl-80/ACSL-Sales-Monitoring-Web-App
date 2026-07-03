import React from "react";
import { CreditCard, TrendingUp, TrendingDown, Users, AlertCircle } from "lucide-react";
import type { DashboardStats } from "@/types/dashboard";

interface DashboardStatsCardsProps {
  data: DashboardStats;
  formatCurrency: (amount: number) => string;
}

const DashboardStatsCards: React.FC<DashboardStatsCardsProps> = ({ data, formatCurrency }) => {
  const collectedPercent =
    data.totalExpectedAmount > 0
      ? ((data.totalAmountPaid / data.totalExpectedAmount) * 100).toFixed(1)
      : "0.0";
  const owedPercent =
    data.totalExpectedAmount > 0
      ? ((data.totalAmountOwed / data.totalExpectedAmount) * 100).toFixed(1)
      : "0.0";
  const owingPercent =
    data.totalCustomers > 0
      ? ((data.customersOwing / data.totalCustomers) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="space-y-4">
      {/* Financial Summary Row */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg border border-blue-100">
          <CreditCard className="h-6 w-6 text-blue-600 shrink-0" />
          <div>
            <p className="text-sm text-gray-600">Total Expected</p>
            <p className="text-2xl font-bold text-gray-900">
              {formatCurrency(data.totalExpectedAmount ?? data.totalSalesAmount ?? 0)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{data.totalSales} sales orders</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-100">
          <TrendingUp className="h-6 w-6 text-green-600 shrink-0" />
          <div>
            <p className="text-sm text-gray-600">Total Collected</p>
            <p className="text-2xl font-bold text-green-700">
              {formatCurrency(data.totalAmountPaid ?? 0)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{collectedPercent}% collected</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-100">
          <TrendingDown className="h-6 w-6 text-red-600 shrink-0" />
          <div>
            <p className="text-sm text-gray-600">Outstanding Balance</p>
            <p className="text-2xl font-bold text-red-700">
              {formatCurrency(data.totalAmountOwed ?? 0)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{owedPercent}% outstanding</p>
          </div>
        </div>
      </div>

      {/* Customer Summary Row */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex items-center gap-3 p-4 bg-purple-50 rounded-lg border border-purple-100">
          <Users className="h-6 w-6 text-purple-600 shrink-0" />
          <div>
            <p className="text-sm text-gray-600">Total Customers</p>
            <p className="text-2xl font-bold text-gray-900">{data.totalCustomers ?? data.totalSales ?? 0}</p>
            <p className="text-xs text-gray-500 mt-0.5">Total sales recorded</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-lg border border-amber-100">
          <AlertCircle className="h-6 w-6 text-amber-600 shrink-0" />
          <div>
            <p className="text-sm text-gray-600">Customers Owing</p>
            <p className="text-2xl font-bold text-amber-700">{data.customersOwing ?? 0}</p>
            <p className="text-xs text-gray-500 mt-0.5">{owingPercent}% with outstanding balance</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardStatsCards;
