import React from "react";
import { Package, CheckCircle2, Layers } from "lucide-react";
import type { DashboardStats } from "@/types/dashboard";

interface StoveInventoryCardProps {
  data: DashboardStats;
  getStoveProgressPercentage: () => number;
}

const StoveInventoryCard: React.FC<StoveInventoryCardProps> = ({ data, getStoveProgressPercentage }) => {
  const soldPct = getStoveProgressPercentage();
  const availablePct =
    data.totalStovesReceived > 0
      ? Math.round((data.totalStovesAvailable / data.totalStovesReceived) * 100)
      : 0;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Stove Inventory</p>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <Layers className="h-6 w-6 text-gray-500 shrink-0" />
          <div>
            <p className="text-sm text-gray-600">Received</p>
            <p className="text-2xl font-bold text-gray-900">{data.totalStovesReceived}</p>
            <p className="text-xs text-gray-500 mt-0.5">Total stoves in stock</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg border border-blue-100">
          <CheckCircle2 className="h-6 w-6 text-blue-600 shrink-0" />
          <div>
            <p className="text-sm text-gray-600">Sold</p>
            <p className="text-2xl font-bold text-blue-700">{data.totalStovesSold}</p>
            <p className="text-xs text-gray-500 mt-0.5">{soldPct}% of total</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-100">
          <Package className="h-6 w-6 text-green-600 shrink-0" />
          <div>
            <p className="text-sm text-gray-600">Available</p>
            <p className="text-2xl font-bold text-green-700">{data.totalStovesAvailable}</p>
            <p className="text-xs text-gray-500 mt-0.5">{availablePct}% of total</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StoveInventoryCard;
