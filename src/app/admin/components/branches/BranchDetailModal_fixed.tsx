import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { Branch } from "@/types/branches";
import { Building2, MapPin, User, Calendar, Mail } from "lucide-react";

interface BranchDetailModalProps {
  open: boolean;
  branch: Branch | null;
  onClose: () => void;
}

const BranchDetailModal: React.FC<BranchDetailModalProps> = ({
  open,
  branch,
  onClose,
}) => {
  if (!branch) return null;

  const formatDate = (dateString: string) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      return "Invalid Date";
    }
  };

  const InfoItem = ({
    icon: Icon,
    label,
    value,
  }: {
    icon: React.ComponentType<any>;
    label: string;
    value: string | React.ReactNode;
  }) => (
    <div className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
      <Icon className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="text-sm text-gray-900 break-words">{value}</p>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Building2 className="h-5 w-5 text-brand-600" />
            <span>Branch Details</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Branch Basic Info */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Basic Information
            </h3>

            <InfoItem
              icon={Building2}
              label="Branch Name"
              value={branch.name}
            />

            <InfoItem
              icon={Building2}
              label="Branch ID"
              value={
                <div className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                  {branch.id}
                </div>
              }
            />
          </div>

          {/* Location Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Location</h3>

            <InfoItem icon={MapPin} label="Country" value={branch.country} />

            {branch.state && (
              <InfoItem icon={MapPin} label="State" value={branch.state} />
            )}

            {branch.lga && (
              <InfoItem
                icon={MapPin}
                label="Local Government Area"
                value={branch.lga}
              />
            )}
          </div>

          {/* Organization Information */}
          {branch.organizations && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Organization
              </h3>

              <InfoItem
                icon={Building2}
                label="Organization Name"
                value={branch.organizations.partner_name}
              />

              <InfoItem
                icon={Mail}
                label="Partner Email"
                value={branch.organizations.email}
              />

              <InfoItem
                icon={Building2}
                label="Organization ID"
                value={
                  <div className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                    {branch.organizations.id}
                  </div>
                }
              />
            </div>
          )}

          {/* Created By Information */}
          {branch.profiles && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Created By
              </h3>

              <InfoItem
                icon={User}
                label="Full Name"
                value={branch.profiles.full_name}
              />

              <InfoItem
                icon={Mail}
                label="Email"
                value={branch.profiles.email}
              />
            </div>
          )}

          {/* Timestamps */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Timestamps</h3>

            <InfoItem
              icon={Calendar}
              label="Created At"
              value={formatDate(branch.created_at)}
            />

            <InfoItem
              icon={Calendar}
              label="Last Updated"
              value={formatDate(branch.updated_at)}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BranchDetailModal;
