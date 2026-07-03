import React from "react";
import type { Branch } from "@/types/branches";
import { Building2, MapPin, Globe } from "lucide-react";
import adminBranchesService from "@/app/services/adminBranchesService";

interface BranchesStatsBarProps {
  branchesData: Branch[];
  pagination: any;
}

const BranchesStatsBar: React.FC<BranchesStatsBarProps> = ({
  branchesData,
  pagination,
}) => {
  const stats = adminBranchesService.getBranchStats(branchesData);

  const StatCard = ({
    icon: Icon,
    label,
    value,
    color = "text-gray-600",
  }: {
    icon: React.ComponentType<any>;
    label: string;
    value: string | number;
    color?: string;
  }) => (
    <div className="flex items-center space-x-2 px-3 py-2 bg-white rounded-lg border border-gray-200">
      <Icon className={`h-4 w-4 ${color}`} />
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-semibold text-gray-900">{value}</p>
      </div>
    </div>
  );

  // Get top countries and states
  const topCountry = Object.entries(stats.byCountry).sort(
    ([, a], [, b]) => b - a
  )[0];
  const topState = Object.entries(stats.byState).sort(
    ([, a], [, b]) => b - a
  )[0];

  return (
    <div className="bg-gray-50 border-b border-gray-200 px-4 lg:px-6 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <StatCard
          icon={Building2}
          label="Total Branches"
          value={pagination?.total || stats.total}
          color="text-brand-600"
        />

        {/* {topCountry && (
          <StatCard
            icon={Globe}
            label="Top Country"
            value={`${topCountry[0]} (${topCountry[1]})`}
            color="text-blue-600"
          />
        )} */}

        {/* {topState && (
          <StatCard
            icon={MapPin}
            label="Top State"
            value={`${topState[0]} (${topState[1]})`}
            color="text-green-600"
          />
        )} */}

        {stats.recentlyCreated > 0 && (
          <StatCard
            icon={Building2}
            label="Recently Created"
            value={`${stats.recentlyCreated} (7 days)`}
            color="text-purple-600"
          />
        )}

        {pagination && (
          <div className="ml-auto text-sm text-gray-600">
            Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
            {pagination.total} branches
          </div>
        )}
      </div>
    </div>
  );
};

export default BranchesStatsBar;
