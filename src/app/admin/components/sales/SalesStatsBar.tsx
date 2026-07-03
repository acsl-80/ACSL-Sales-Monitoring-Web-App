import React from "react";

interface SalesStatsBarProps {
  salesData: any[];
  pagination: {
    total: number;
    page: number;
    totalPages: number;
  };
}

const SalesStatsBar: React.FC<SalesStatsBarProps> = ({
  salesData,
  pagination,
}) => (
  <div className="mt-4 text-sm text-gray-600 px-5">
    Showing {salesData.length} of {pagination.total} sales (Page{" "}
    {pagination.page} of {pagination.totalPages})
  </div>
);

export default SalesStatsBar;
