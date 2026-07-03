import React from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SalesErrorAlertProps {
  error: string;
  onRetry: () => void;
}

const SalesErrorAlert: React.FC<SalesErrorAlertProps> = ({
  error,
  onRetry,
}) => (
  <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
    <AlertCircle className="h-5 w-5 text-red-600" />
    <span className="text-red-700">{error}</span>
    <Button variant="outline" size="sm" onClick={onRetry} className="ml-auto">
      Try Again
    </Button>
  </div>
);

export default SalesErrorAlert;
