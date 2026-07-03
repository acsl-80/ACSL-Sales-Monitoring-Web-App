import React from "react";
import { UserPlus, ShoppingCart, Package } from "lucide-react";
import { useRouter } from "@/compat/navigation";

const QuickActions: React.FC = () => {
  const router = useRouter();

  const actions = [
    {
      label: "Manage Agents",
      icon: UserPlus,
      href: "/admin/agents",
      color: "text-green-600",
      bg: "hover:bg-green-50 border-green-200",
    },
    {
      label: "Manage Sales",
      icon: ShoppingCart,
      href: "/admin/sales",
      color: "text-blue-600",
      bg: "hover:bg-blue-50 border-blue-200",
    },
    {
      label: "Manage Stoves",
      icon: Package,
      href: "/stove-management",
      color: "text-purple-600",
      bg: "hover:bg-purple-50 border-purple-200",
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ label, icon: Icon, href, color, bg }) => (
        <button
          key={label}
          onClick={() => router.push(href)}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md border bg-white transition-colors cursor-pointer ${color} ${bg}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
};

export default QuickActions;
