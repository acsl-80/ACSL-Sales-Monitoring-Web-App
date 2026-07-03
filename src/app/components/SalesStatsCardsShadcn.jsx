
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Banknote,
  ShoppingCart,
  Users,
  Target,
  Activity,
  BarChart3,
} from "lucide-react";

const SalesStatsCards = ({ stats = {} }) => {
  const {
    totalSales = 0,
    totalAmount = 0,
    totalCustomers = 0,
    avgSaleAmount = 0,
    todaySales = 0,
    todayAmount = 0,
    growthRate = 0,
    conversionRate = 0,
    topStates = [],
    recentSales = [],
    monthlyTarget = 1000000,
    achievement = 0,
  } = stats;

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num) => {
    return new Intl.NumberFormat("en-US").format(num);
  };

  const getGrowthColor = (rate) => {
    if (rate > 0) return "text-green-600";
    if (rate < 0) return "text-red-600";
    return "text-gray-600";
  };

  const getGrowthIcon = (rate) => {
    if (rate > 0) return <TrendingUp className="w-4 h-4" />;
    if (rate < 0) return <TrendingDown className="w-4 h-4" />;
    return <Activity className="w-4 h-4" />;
  };

  const progressPercentage = Math.min((totalAmount / monthlyTarget) * 100, 100);

  const statsCards = [
    {
      title: "Total Sales",
      value: formatNumber(totalSales),
      subValue: `Today: ${formatNumber(todaySales)}`,
      icon: <ShoppingCart className="w-6 h-6" />,
      color: "from-brand-800 to-brand-900",
      textColor: "text-brand-700",
      bgColor: "bg-brand-50",
    },
    {
      title: "Total Revenue",
      value: formatCurrency(totalAmount),
      subValue: `Today: ${formatCurrency(todayAmount)}`,
      icon: <Banknote className="w-6 h-6" />,
      color: "from-brand-700 to-brand-800",
      textColor: "text-brand-700",
      bgColor: "bg-brand-50",
    },
    {
      title: "Total Customers",
      value: formatNumber(totalCustomers),
      subValue: `Avg per sale: ${(
        totalCustomers / Math.max(totalSales, 1)
      ).toFixed(1)}`,
      icon: <Users className="w-6 h-6" />,
      color: "from-gray-600 to-gray-700",
      textColor: "text-gray-600",
      bgColor: "bg-gray-50",
    },
    {
      title: "Average Sale",
      value: formatCurrency(avgSaleAmount),
      subValue: `Growth: ${growthRate >= 0 ? "+" : ""}${growthRate.toFixed(
        1
      )}%`,
      icon: <BarChart3 className="w-6 h-6" />,
      color: "from-slate-600 to-slate-700",
      textColor: "text-slate-600",
      bgColor: "bg-slate-50",
    },
  ];

  return (
    <div className="w-full space-y-6">
      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statsCards.map((stat, index) => (
          <Card
            key={index}
            className="relative overflow-hidden border-0 shadow-lg hover:shadow-xl transition-all duration-300"
          >
            <CardContent className="p-0">
              <div className={`h-2 bg-gradient-to-r ${stat.color}`}></div>
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      {stat.title}
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mb-1">
                      {stat.value}
                    </p>
                    <div className="flex items-center text-sm text-gray-500">
                      {stat.title === "Average Sale" && (
                        <span
                          className={`flex items-center ${getGrowthColor(
                            growthRate
                          )} mr-1`}
                        >
                          {getGrowthIcon(growthRate)}
                        </span>
                      )}
                      {stat.subValue}
                    </div>
                  </div>
                  <div className={`p-3 rounded-full ${stat.bgColor}`}>
                    <span className={stat.textColor}>{stat.icon}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Additional Stats Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Target Progress */}
        <Card className="shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Target className="w-5 h-5 text-brand-700" />
              Monthly Target
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Progress</span>
                <span className="text-sm font-medium">
                  {progressPercentage.toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-brand-700 to-brand-800 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  Current: {formatCurrency(totalAmount)}
                </span>
                <span className="text-gray-600">
                  Target: {formatCurrency(monthlyTarget)}
                </span>
              </div>
              <div className="pt-2">
                <Badge
                  variant={
                    progressPercentage >= 100
                      ? "default"
                      : progressPercentage >= 75
                      ? "secondary"
                      : "outline"
                  }
                  className="text-xs"
                >
                  {progressPercentage >= 100
                    ? "Target Achieved!"
                    : progressPercentage >= 75
                    ? "On Track"
                    : "Needs Attention"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top Performing States */}
        <Card className="shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <BarChart3 className="w-5 h-5 text-brand-700" />
              Top States
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topStates.slice(0, 5).map((state, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        index === 0
                          ? "bg-yellow-400"
                          : index === 1
                          ? "bg-gray-400"
                          : index === 2
                          ? "bg-amber-600"
                          : "bg-gray-300"
                      }`}
                    ></div>
                    <span className="text-sm font-medium text-gray-700">
                      {state.name}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-900">
                      {formatNumber(state.count)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatCurrency(state.amount)}
                    </div>
                  </div>
                </div>
              ))}
              {topStates.length === 0 && (
                <div className="text-center text-gray-500 py-4">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No data available</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Performance Metrics */}
        <Card className="shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-brand-700" />
              Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Conversion Rate */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-600">Conversion Rate</span>
                  <span className="text-sm font-medium">
                    {conversionRate.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-brand-600 to-brand-700 h-2 rounded-full"
                    style={{ width: `${Math.min(conversionRate, 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Achievement Rate */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-600">
                    Achievement Rate
                  </span>
                  <span className="text-sm font-medium">
                    {achievement.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-gray-600 to-gray-700 h-2 rounded-full"
                    style={{ width: `${Math.min(achievement, 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Growth Rate Badge */}
              <div className="pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Growth Rate</span>
                  <Badge
                    variant={
                      growthRate > 0
                        ? "default"
                        : growthRate < 0
                        ? "destructive"
                        : "outline"
                    }
                    className="flex items-center gap-1"
                  >
                    {getGrowthIcon(growthRate)}
                    {growthRate >= 0 ? "+" : ""}
                    {growthRate.toFixed(1)}%
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SalesStatsCards;
