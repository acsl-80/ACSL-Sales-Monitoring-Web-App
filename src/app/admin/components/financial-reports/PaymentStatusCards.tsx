
import React from "react";
import { FileText, CheckCircle2, Clock, AlertCircle } from "lucide-react";

interface PaymentStatusBreakdown {
  totalOrders: number;
  fullyPaid: number;
  partiallyPaid: number;
  unpaid: number;
}

interface PaymentStatusCardsProps {
  breakdown: PaymentStatusBreakdown;
  activeFilter?: string;
  onFilterClick?: (filter: string) => void;
}

const PaymentStatusCards: React.FC<PaymentStatusCardsProps> = ({
  breakdown,
  activeFilter,
  onFilterClick,
}) => {
  const total = breakdown.totalOrders || 1;

  const cards = [
    {
      label: "Total Orders",
      filter: "all",
      count: breakdown.totalOrders,
      percent: 100,
      icon: FileText,
      bg: "bg-blue-50",
      border: "border-blue-200",
      activeBorder: "border-blue-500",
      iconBg: "bg-blue-100",
      iconColor: "text-blue-700",
      textColor: "text-blue-900",
      labelColor: "text-blue-600",
      subColor: "text-blue-500",
    },
    {
      label: "Fully Paid",
      filter: "paid",
      count: breakdown.fullyPaid,
      percent: (breakdown.fullyPaid / total) * 100,
      icon: CheckCircle2,
      bg: "bg-green-50",
      border: "border-green-200",
      activeBorder: "border-green-600",
      iconBg: "bg-green-100",
      iconColor: "text-green-700",
      textColor: "text-green-900",
      labelColor: "text-green-600",
      subColor: "text-green-500",
    },
    {
      label: "Partially Paid",
      filter: "partial",
      count: breakdown.partiallyPaid,
      percent: (breakdown.partiallyPaid / total) * 100,
      icon: Clock,
      bg: "bg-amber-50",
      border: "border-amber-200",
      activeBorder: "border-amber-600",
      iconBg: "bg-amber-100",
      iconColor: "text-amber-700",
      textColor: "text-amber-900",
      labelColor: "text-amber-600",
      subColor: "text-amber-500",
    },
    {
      label: "Unpaid",
      filter: "unpaid",
      count: breakdown.unpaid,
      percent: (breakdown.unpaid / total) * 100,
      icon: AlertCircle,
      bg: "bg-red-50",
      border: "border-red-200",
      activeBorder: "border-red-600",
      iconBg: "bg-red-100",
      iconColor: "text-red-700",
      textColor: "text-red-900",
      labelColor: "text-red-600",
      subColor: "text-red-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const isActive = activeFilter === card.filter;
        const clickable = !!onFilterClick;
        return (
          <div
            key={card.label}
            onClick={() => onFilterClick?.(card.filter)}
            className={`${card.bg} border rounded-lg p-4 transition-all
              ${isActive ? `${card.activeBorder} shadow-md` : `${card.border}`}
              ${clickable ? "cursor-pointer hover:shadow-md hover:scale-[1.02]" : ""}
            `}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 ${card.iconBg} rounded-lg`}>
                <Icon className={`h-5 w-5 ${card.iconColor}`} />
              </div>
              <div>
                <p className={`text-sm ${card.labelColor} font-medium`}>{card.label}</p>
                <p className={`text-xl font-bold ${card.textColor}`}>{card.count}</p>
                {card.label !== "Total Orders" && (
                  <p className={`text-xs ${card.subColor}`}>{card.percent.toFixed(1)}% of total</p>
                )}
              </div>
            </div>
            {isActive && (
              <p className="text-xs font-semibold mt-2 opacity-70 text-center">
                ✓ Filter active — click again to clear
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PaymentStatusCards;
