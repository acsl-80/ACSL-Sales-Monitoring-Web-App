import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, TrendingUp, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/compat/navigation";
import type { DashboardStats } from "@/types/dashboard";

interface SalesOverviewProps {
  data: DashboardStats;
  formatCurrency: (amount: number) => string;
}

const SalesOverview: React.FC<SalesOverviewProps> = ({
  data,
  formatCurrency,
}) => {
  const router = useRouter();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-600" />
            Sales Status Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span className="text-sm text-gray-700">Completed Sales</span>
            </div>
            <span className="font-semibold">{data.completedSales}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <span className="text-sm text-gray-700">Pending Sales</span>
            </div>
            <span className="font-semibold">{data.pendingSales}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span className="text-sm text-gray-700">With Landmarks</span>
            </div>
            <span className="font-semibold">{data.stovesWithLandmark}</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            Performance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">
              {formatCurrency(data.totalSalesAmount)}
            </div>
            <p className="text-sm text-gray-600">Total Revenue Generated</p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-center text-sm">
            <div>
              <div className="font-semibold text-gray-900">
                {data.totalSales}
              </div>
              <div className="text-gray-600">Total Sales</div>
            </div>
            <div>
              <div className="font-semibold text-blue-600">
                {data.salesAgents}
              </div>
              <div className="text-gray-600">Active Agents</div>
            </div>
          </div>
          <Button
            onClick={() => router.push("/admin/sales")}
            className="w-full bg-green-600 hover:bg-green-700 text-white"
          >
            View Detailed Reports
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SalesOverview;
