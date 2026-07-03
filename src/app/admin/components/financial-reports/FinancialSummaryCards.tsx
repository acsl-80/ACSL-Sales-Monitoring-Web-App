
import React from "react";
import { CreditCard, TrendingUp, TrendingDown } from "lucide-react";

interface FinancialSummary {
  totalReceivable: number;
  totalCollected: number;
  outstandingBalance: number;
  salesCount: number;
  collectedPercent: number;
  outstandingPercent: number;
}

interface FinancialSummaryCardsProps {
  summary: FinancialSummary;
}

const formatCurrency = (amount: number) =>
  `₦${(amount ?? 0).toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;

const FinancialSummaryCards: React.FC<FinancialSummaryCardsProps> = ({
  summary,
}) => {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Total Receivable */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-500">
            Total Receivable
          </span>
          <div className="h-9 w-9 rounded-full bg-blue-50 flex items-center justify-center">
            <CreditCard className="h-4 w-4 text-blue-600" />
          </div>
        </div>
        <div className="text-2xl font-bold text-gray-900">
          {formatCurrency(summary.totalReceivable)}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {summary.salesCount} sales order{summary.salesCount !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Total Collected */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-500">
            Total Collected
          </span>
          <div className="h-9 w-9 rounded-full bg-green-50 flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-green-600" />
          </div>
        </div>
        <div className="text-2xl font-bold text-green-600">
          {formatCurrency(summary.totalCollected)}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {summary.collectedPercent.toFixed(1)}% collected
        </p>
      </div>

      {/* Outstanding Balance */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-500">
            Outstanding Balance
          </span>
          <div className="h-9 w-9 rounded-full bg-red-50 flex items-center justify-center">
            <TrendingDown className="h-4 w-4 text-red-600" />
          </div>
        </div>
        <div className="text-2xl font-bold text-red-600">
          {formatCurrency(summary.outstandingBalance)}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {summary.outstandingPercent.toFixed(1)}% outstanding
        </p>
      </div>
    </div>
  );
};

export default FinancialSummaryCards;
