// Custom hook for admin dashboard functionality
import { useState, useEffect } from "react";
import adminDashboardService from "../services/adminDashboardService";

export const useAdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState(null);
  const [error, setError] = useState(null);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await adminDashboardService.getDashboardStats();

      if (response.success) {
        setDashboardData(response.data);
      } else {
        setError(response.error || "Failed to load dashboard data");
      }
    } catch (err) {
      console.error("Dashboard error:", err);
      setError("An unexpected error occurred while loading dashboard data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  return {
    loading,
    dashboardData,
    error,
    refetch: fetchDashboardData,
  };
};

export default useAdminDashboard;
