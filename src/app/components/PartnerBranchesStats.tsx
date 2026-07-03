import React from "react";
import { Building2, MapPin, Calendar, TrendingUp } from "lucide-react";
import type { Branch } from "@/types/branches";

interface PartnerBranchesStatsProps {
  branchesData: Branch[];
  pagination: {
    total: number;
    page: number;
    totalPages: number;
  };
  organization: {
    name: string;
    id: string;
  };
}

const PartnerBranchesStats: React.FC<PartnerBranchesStatsProps> = ({
  branchesData,
  pagination,
  organization,
}) => {
  // Calculate stats
  const totalBranches = pagination.total;
  const countriesCount = new Set(branchesData.map((branch) => branch.country))
    .size;
  const statesCount = new Set(
    branchesData.filter((branch) => branch.state).map((branch) => branch.state)
  ).size;

  // Calculate recently created (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentlyCreated = branchesData.filter((branch) => {
    const createdAt = new Date(branch.created_at);
    return createdAt > sevenDaysAgo;
  }).length;

  const stats = [
    {
      title: "Total Branches",
      value: totalBranches,
      icon: Building2,
      color: "text-blue-600",
      bgColor: "bg-blue-100",
    },
    {
      title: "Countries",
      value: countriesCount,
      icon: MapPin,
      color: "text-green-600",
      bgColor: "bg-green-100",
    },
    {
      title: "States/Regions",
      value: statesCount,
      icon: MapPin,
      color: "text-purple-600",
      bgColor: "bg-purple-100",
    },
    {
      title: "New This Week",
      value: recentlyCreated,
      icon: TrendingUp,
      color: "text-orange-600",
      bgColor: "bg-orange-100",
    },
  ];

  return (
    <div className="bg-gray-50 border-b border-gray-200 p-4 lg:p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div
              key={index}
              className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    {stat.title}
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stat.value}
                  </p>
                </div>
                <div className={`p-3 rounded-full ${stat.bgColor}`}>
                  <Icon className={`h-6 w-6 ${stat.color}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary text */}
      <div className="mt-4 text-sm text-gray-600">
        Showing {branchesData.length} of {totalBranches} branches for{" "}
        <span className="font-medium text-gray-900">{organization.name}</span>
        {pagination.totalPages > 1 && (
          <span>
            {" "}
            (Page {pagination.page} of {pagination.totalPages})
          </span>
        )}
      </div>
    </div>
  );
};

export default PartnerBranchesStats;
