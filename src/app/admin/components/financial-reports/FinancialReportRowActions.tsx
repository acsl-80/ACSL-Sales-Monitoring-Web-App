
import React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, History, Plus, Pencil, Trash2, Calendar, CheckCircle2, Clock, Eye, Ban } from "lucide-react";
import { AdminSales } from "@/types/adminSales";

interface FinancialReportRowActionsProps {
  sale: AdminSales;
  onViewDetails: (sale: AdminSales) => void;
  onViewHistory: (sale: AdminSales) => void;
  onRecordPayment: (sale: AdminSales) => void;
  onApproveSale?: (sale: AdminSales) => void;
  onEditSale?: (sale: AdminSales) => void;
  onDeleteSale?: (sale: AdminSales) => void;
  onCancelSale?: (sale: AdminSales) => void;
  viewFrom?: "admin" | "superAdmin" | "agent" | "partner";
}

const FinancialReportRowActions: React.FC<FinancialReportRowActionsProps> = ({
  sale, onViewDetails, onViewHistory, onRecordPayment, onApproveSale, onEditSale, onDeleteSale, onCancelSale, viewFrom = "admin",
}) => {
  const isInstallment = sale.is_installment === true;
  const totalPaid = sale.total_paid ?? (isInstallment ? 0 : sale.amount);
  const balance = Math.max(0, (sale.amount || 0) - totalPaid);
  const showPayButton = balance > 0;

  const durationMonths = sale.payment_model?.duration_months ?? 0;
  const paymentsMade = isInstallment
    ? Math.min(Math.ceil(totalPaid > 0 ? totalPaid / ((sale.amount || 1) / (durationMonths || 1)) : 0), durationMonths)
    : 0;
  const remaining = durationMonths - paymentsMade;

  return (
    <div className="flex items-center justify-center gap-1">
      {/* Record Payment button */}
      {showPayButton && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs flex items-center gap-1 border-[#4a5d0f] text-[#4a5d0f] hover:bg-[#eef3c4]"
          onClick={() => onRecordPayment(sale)}
        >
          <Plus className="h-3 w-3" />
          Record Payment
        </Button>
      )}

      {/* Approve button (ACSL Agent only) */}
      {/* {onApproveSale && !sale.agent_approved && (
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white flex items-center gap-1"
          onClick={() => onApproveSale(sale)}
        >
          <CheckCircle2 className="h-3 w-3" />
          Approve
        </Button>
      )} */}

      {/* More dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">

          {/* Sale Details */}
          <div className="px-3 py-2">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1.5">Sale Details</p>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <span className="font-medium">Phone:</span>
                <span>{sale.phone || "N/A"}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <span className="font-medium">Partner:</span>
                <span>{sale.organizations?.name || sale.organizations?.partner_name || sale.partner_name || "N/A"}</span>
              </div>
            </div>
          </div>

          <DropdownMenuSeparator />

          {/* Payment History */}
          <DropdownMenuItem
            onClick={() => onViewHistory(sale)}
            className="py-2 px-3 rounded-md hover:!bg-green-600 hover:!text-white cursor-pointer"
          >
            <History className="mr-2 h-4 w-4" />
            Payment History & Receipts
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Edit - Hide for agents */}
          {(viewFrom === "admin" || viewFrom === "partner") && onEditSale && (
            <DropdownMenuItem
              onClick={() => onEditSale(sale)}
              className="py-2 px-3 rounded-md hover:!bg-blue-600 hover:!text-white cursor-pointer"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit Sale
            </DropdownMenuItem>
          )}

          {/* Delete - Only visible to partner (admin) */}
          {(viewFrom === "admin" || viewFrom === "partner") && onDeleteSale && (
            <DropdownMenuItem
              onClick={() => onDeleteSale(sale)}
              className="py-2 px-3 rounded-md hover:!bg-red-600 hover:!text-white cursor-pointer text-red-600"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Sale
            </DropdownMenuItem>
          )}

          {/* Cancel Sale - available for admin/partner/superAdmin */}
          {onCancelSale && viewFrom !== "agent" && (
            <DropdownMenuItem
              onClick={() => onCancelSale(sale)}
              className="py-2 px-3 rounded-md hover:!bg-red-600 hover:!text-white cursor-pointer text-red-600"
            >
              <Ban className="mr-2 h-4 w-4" />
              Cancel Sale
            </DropdownMenuItem>
          )}

          {/* Payment Information Section */}
          <DropdownMenuSeparator />
          <div className="px-3 py-1.5">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1.5">Payment Info</p>
            <div className="space-y-1.5 text-sm">
              {/* Hide Plan as per request */}
              {/* <div className="flex items-center gap-2 text-gray-600">
                <Calendar className="h-3.5 w-3.5 text-gray-400" />
                <span className="font-medium">Plan:</span>
                <span>
                  {isInstallment
                    ? (sale.payment_model?.name ?? `Monthly (${durationMonths} installments)`)
                    : "Full Payment"}
                </span>
              </div> */}
              {isInstallment && (
                <>
                  <div className="flex items-center gap-2 text-gray-600">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span className="font-medium">Paid:</span>
                    <span>{paymentsMade} of {durationMonths}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                    <span className="font-medium">Remaining:</span>
                    <span>{remaining}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Details button */}
      {viewFrom !== "agent" && (
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs bg-[#4A5D0F] hover:bg-[#3a4a0c] text-white rounded-none"
          onClick={() => onViewDetails(sale)}
        >
          Details
        </Button>
      )}
    </div>
  );
};

export default FinancialReportRowActions;
