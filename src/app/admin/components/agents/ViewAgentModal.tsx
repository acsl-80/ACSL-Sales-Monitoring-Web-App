
import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Shield,
  Edit,
} from "lucide-react";
import { SalesAgent } from "@/types/salesAgent";

interface ViewAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: SalesAgent | null;
  onEdit?: (agent: SalesAgent) => void;
  onViewPerformance?: (agent: SalesAgent) => void;
}

interface AgentStats {
  totalSales: number;
  totalAmount: number;
  avgSaleAmount: number;
  statusBreakdown: Record<string, number>;
}

const DetailItem = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) => (
  <div className="space-y-0.5">
    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
      {label}
    </p>
    <p className="text-xs font-medium">
      {value ?? <span className="text-gray-400">N/A</span>}
    </p>
  </div>
);

const SectionCard = ({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={`bg-muted/30 rounded-lg p-3 border border-border/50 ${className}`}>
    <h3 className="text-[10px] font-semibold text-primary uppercase tracking-wider border-b border-primary/20 pb-0.5 mb-2">
      {title}
    </h3>
    {children}
  </div>
);

const ViewAgentModal: React.FC<ViewAgentModalProps> = ({
  isOpen,
  onClose,
  agent,
  onEdit,
}) => {
  const [stats, setStats] = useState<AgentStats | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStats(null);
    }
  }, [isOpen]);

  const formatDate = (dateString: string) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (error) {
      return "Invalid Date";
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "NGN",
    }).format(amount);
  };

  const getPasswordStatusBadge = (hasChanged: boolean | undefined) => {
    return hasChanged ? (
      <Badge className="bg-green-100 text-green-800 border-green-200">
        <Shield className="h-3 w-3 mr-1" />
        Password Changed
      </Badge>
    ) : (
      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
        <Shield className="h-3 w-3 mr-1" />
        Default Password
      </Badge>
    );
  };

  if (!agent) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent size="4xl" className="max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Agent Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Agent Header */}
          <div className="flex items-center gap-4 p-3 bg-brand-light rounded-lg border border-gray-200">
            <div className="bg-gradient-to-br from-brand-800 to-brand-900 w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white font-semibold text-xl">
                {agent.full_name?.charAt(0)?.toUpperCase() || "A"}
              </span>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900">
                {agent.full_name || "N/A"}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                {getPasswordStatusBadge(agent.has_changed_password)}
              </div>
            </div>
          </div>

          {/* Info Sections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SectionCard title="Contact Information">
              <div className="grid grid-cols-2 gap-3">
                <DetailItem label="Email" value={agent.email} />
                <DetailItem label="Phone" value={agent.phone || "Not provided"} />
                <DetailItem label="Joined" value={formatDate(agent.created_at)} />
                <DetailItem
                  label="Last Login"
                  value={agent.last_login ? formatDate(agent.last_login) : "Never"}
                />
              </div>
            </SectionCard>

            <SectionCard title="Performance Overview">
              <div className="grid grid-cols-2 gap-3">
                <DetailItem
                  label="Total Stoves Sold"
                  value={
                    agent.total_sold !== undefined && agent.total_sold !== null
                      ? agent.total_sold.toLocaleString()
                      : "0"
                  }
                />
                <DetailItem
                  label="Last Login"
                  value={agent.last_login ? formatDate(agent.last_login) : "Never"}
                />
                {stats && (
                  <>
                    <DetailItem label="Total Revenue" value={formatCurrency(stats.totalAmount)} />
                    <DetailItem label="Avg Sale Amount" value={formatCurrency(stats.avgSaleAmount)} />
                  </>
                )}
              </div>
            </SectionCard>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            {onEdit && (
              <Button
                variant="outline"
                onClick={() => onEdit(agent)}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit Agent
              </Button>
            )}
            <Button onClick={onClose} className="bg-brand hover:bg-brand/90 text-white">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ViewAgentModal;
