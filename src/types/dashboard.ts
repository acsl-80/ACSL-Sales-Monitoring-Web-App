// DashboardStats type for admin dashboard statistics response

export interface DashboardStats {
  totalSales: number;
  salesAgents: number;
  completedSales: number;
  stovesWithLandmark: number;
  pendingSales: number;
  totalSalesAmount: number;
  // Financial summary
  totalExpectedAmount: number;
  totalAmountPaid: number;
  totalAmountOwed: number;
  totalCustomers: number;
  customersOwing: number;
  organizationId: string;
  totalStovesReceived: number;
  totalStovesSold: number;
  totalStovesAvailable: number;
}

export interface DashboardStatsResponse {
  success: boolean;
  data: DashboardStats;
  message: string;
}
