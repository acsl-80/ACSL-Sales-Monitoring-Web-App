
import React from "react";
import { Card, Row, Col, Statistic, Progress, Tooltip } from "antd";
import {
  DollarOutlined,
  ShoppingCartOutlined,
  UserOutlined,
  TrendingUpOutlined,
  CalendarOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";

const SalesStatsCards = ({ data = [], loading = false }) => {
  // Calculate statistics
  const stats = React.useMemo(() => {
    if (!data || data.length === 0) {
      return {
        totalSales: 0,
        totalAmount: 0,
        averageAmount: 0,
        uniqueCustomers: 0,
        thisMonth: 0,
        thisWeek: 0,
        topStates: [],
      };
    }

    const totalSales = data.length;
    const totalAmount = data.reduce((sum, item) => sum + (item.amount || 0), 0);
    const averageAmount = totalAmount / totalSales;

    // Get unique customers
    const uniqueCustomers = new Set(data.map((item) => item.endUserName)).size;

    // Calculate this month and week sales
    const now = new Date();
    const thisMonth = data.filter((item) => {
      const itemDate = new Date(item.salesDate || item.createdAt);
      return (
        itemDate.getMonth() === now.getMonth() &&
        itemDate.getFullYear() === now.getFullYear()
      );
    }).length;

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisWeek = data.filter((item) => {
      const itemDate = new Date(item.salesDate || item.createdAt);
      return itemDate >= weekAgo;
    }).length;

    // Top states
    const stateStats = {};
    data.forEach((item) => {
      const state = item.state || "Unknown";
      stateStats[state] = (stateStats[state] || 0) + 1;
    });

    const topStates = Object.entries(stateStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([state, count]) => ({
        state,
        count,
        percentage: (count / totalSales) * 100,
      }));

    return {
      totalSales,
      totalAmount,
      averageAmount,
      uniqueCustomers,
      thisMonth,
      thisWeek,
      topStates,
    };
  }, [data]);

  const statCards = [
    {
      title: "Total Sales",
      value: stats.totalSales,
      icon: <ShoppingCartOutlined />,
      color: "#1890ff",
      gradient: "from-blue-400 to-blue-600",
      prefix: "",
    },
    {
      title: "Total Revenue",
      value: stats.totalAmount,
      icon: <DollarOutlined />,
      color: "#52c41a",
      gradient: "from-green-400 to-green-600",
      prefix: "₦",
      formatter: true,
    },
    {
      title: "Average Sale",
      value: stats.averageAmount,
      icon: <TrendingUpOutlined />,
      color: "#722ed1",
      gradient: "from-purple-400 to-purple-600",
      prefix: "₦",
      formatter: true,
    },
    {
      title: "Unique Customers",
      value: stats.uniqueCustomers,
      icon: <UserOutlined />,
      color: "#fa8c16",
      gradient: "from-orange-400 to-orange-600",
      prefix: "",
    },
    {
      title: "This Month",
      value: stats.thisMonth,
      icon: <CalendarOutlined />,
      color: "#eb2f96",
      gradient: "from-pink-400 to-pink-600",
      prefix: "",
    },
    {
      title: "This Week",
      value: stats.thisWeek,
      icon: <CalendarOutlined />,
      color: "#13c2c2",
      gradient: "from-cyan-400 to-cyan-600",
      prefix: "",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Main Stats Grid */}
      <Row gutter={[16, 16]}>
        {statCards.map((stat, index) => (
          <Col xs={12} sm={8} lg={4} key={index}>
            <Card
              className="stat-card border-0 shadow-lg overflow-hidden"
              bodyStyle={{ padding: 0 }}
            >
              <div
                className={`p-4 bg-gradient-to-r ${stat.gradient} text-white relative overflow-hidden`}
              >
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-2xl opacity-80">{stat.icon}</div>
                    <div className="text-xs opacity-80 uppercase tracking-wider">
                      {stat.title}
                    </div>
                  </div>
                  <div className="text-xl font-bold">
                    <Statistic
                      value={stat.value}
                      prefix={stat.prefix}
                      formatter={
                        stat.formatter
                          ? (value) =>
                              `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                          : undefined
                      }
                      valueStyle={{
                        color: "white",
                        fontSize: "1.25rem",
                        fontWeight: "bold",
                      }}
                    />
                  </div>
                </div>

                {/* Background Pattern */}
                <div className="absolute top-0 right-0 w-16 h-16 opacity-20">
                  <div className="w-full h-full rounded-full bg-white transform translate-x-6 -translate-y-6"></div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Top States */}
      {stats.topStates.length > 0 && (
        <Card
          title={
            <div className="flex items-center space-x-2">
              <EnvironmentOutlined className="text-blue-500" />
              <span>Top Performing States</span>
            </div>
          }
          className="border-0 shadow-md"
        >
          <Row gutter={[16, 16]}>
            {stats.topStates.map((state, index) => (
              <Col xs={24} sm={8} key={index}>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-gray-800">
                      {state.state}
                    </span>
                    <span className="text-sm text-gray-600">
                      {state.count} sales
                    </span>
                  </div>
                  <Progress
                    percent={state.percentage}
                    size="small"
                    strokeColor={{
                      "0%": "#1890ff",
                      "100%": "#52c41a",
                    }}
                    format={(percent) => `${percent.toFixed(1)}%`}
                  />
                </div>
              </Col>
            ))}
          </Row>
        </Card>
      )}
    </div>
  );
};

export default SalesStatsCards;
