import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DashboardStats } from "@/types/dashboard";
import { useRouter } from "@/compat/navigation";

interface PendingSalesAlertProps {
  pendingSales: number;
}

const PendingSalesAlert: React.FC<PendingSalesAlertProps> = ({
  pendingSales,
}) => {
  const router = useRouter();
  if (pendingSales <= 0) return null;
  return (
    <Card className="border-l-4 border-l-yellow-500 bg-yellow-50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <div>
              <p className="font-semibold text-yellow-800">
                {pendingSales} Pending Sales Require Attention
              </p>
              <p className="text-sm text-yellow-700">
                Review and process pending sales to maintain workflow efficiency
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => router.push("/admin/sales?filter=pending")}
            className="bg-yellow-600 hover:bg-yellow-700 text-white"
          >
            Review Sales
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default PendingSalesAlert;
