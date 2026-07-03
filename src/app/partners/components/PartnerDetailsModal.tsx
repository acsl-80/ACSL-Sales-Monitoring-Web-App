
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Building2, MapPin, Phone, Mail, User, Calendar, GitBranch, Package, ShoppingCart, Boxes } from "lucide-react";

interface PartnerDetailsModalProps {
  partner: {
    id: string;
    partner_name: string;
    branch: string | null;
    state: string | null;
    contact_person?: string | null;
    contact_phone?: string | null;
    email?: string | null;
    assigned_at: string;
    total_sales?: number | null;
    approved_sales?: number | null;
    pending_sales?: number | null;
  };
  onClose: () => void;
}

const DetailItem = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) => (
  <div className="space-y-0">
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

const PartnerDetailsModal: React.FC<PartnerDetailsModalProps> = ({ partner, onClose }) => {
  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-brand" />
            Partner Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          {/* Partner Information */}
          <SectionCard title="Partner Information">
            <div className="grid grid-cols-2 gap-3">
              <DetailItem label="Partner Name" value={partner.partner_name} />
              <DetailItem label="State" value={partner.state} />
              <DetailItem
                label="Branch"
                value={
                  partner.branch ? (
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3 text-gray-400" />
                      {partner.branch}
                    </span>
                  ) : null
                }
              />
            </div>
          </SectionCard>

          {/* Contact Details */}
          <SectionCard title="Contact Details">
            <div className="grid grid-cols-2 gap-3">
              <DetailItem
                label="Contact Person"
                value={
                  partner.contact_person ? (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3 text-gray-400" />
                      {partner.contact_person}
                    </span>
                  ) : null
                }
              />
              <DetailItem
                label="Phone"
                value={
                  partner.contact_phone ? (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3 text-gray-400" />
                      {partner.contact_phone}
                    </span>
                  ) : null
                }
              />
              <DetailItem
                label="Email"
                value={
                  partner.email ? (
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3 text-gray-400" />
                      {partner.email}
                    </span>
                  ) : null
                }
              />
            </div>
          </SectionCard>

          {/* Stove Statistics */}
          <SectionCard title="Stove IDs">
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center justify-center bg-brand/5 border border-brand/20 rounded-md py-2 px-1">
                <Package className="h-3.5 w-3.5 text-brand mb-1" />
                <p className="text-base font-bold text-brand leading-none">
                  {(partner.total_sales ?? 0).toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 text-center">Stoves Received</p>
              </div>
              <div className="flex flex-col items-center justify-center bg-green-50 border border-green-200 rounded-md py-2 px-1">
                <ShoppingCart className="h-3.5 w-3.5 text-green-600 mb-1" />
                <p className="text-base font-bold text-green-700 leading-none">
                  {(partner.approved_sales ?? 0).toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 text-center">Stoves Sold</p>
              </div>
              <div className="flex flex-col items-center justify-center bg-orange-50 border border-orange-200 rounded-md py-2 px-1">
                <Boxes className="h-3.5 w-3.5 text-orange-500 mb-1" />
                <p className="text-base font-bold text-orange-600 leading-none">
                  {(partner.pending_sales ?? 0).toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 text-center">Stoves In Stock</p>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="flex justify-end pt-2 border-t border-gray-100">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PartnerDetailsModal;
