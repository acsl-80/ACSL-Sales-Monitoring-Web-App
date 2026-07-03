/* eslint-disable @next/next/no-img-element */
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Download, Eye, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SuperAdminSale } from "@/types/superAdminSales";
import { Checkbox } from "../../../components/ui/checkbox";

const getPaymentStatusBadge = (sale: SuperAdminSale) => {
  if (!sale.is_installment) return null;
  const status = sale.payment_status;
  if (status === "fully_paid") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">
        Fully Paid
      </Badge>
    );
  }
  if (status === "partially_paid") {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
          Partially Paid
        </Badge>
        <span className="text-xs text-gray-500">
          ₦{(sale.total_paid ?? 0).toLocaleString()} / ₦{sale.amount.toLocaleString()}
        </span>
      </div>
    );
  }
  return (
    <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">
      Installment
    </Badge>
  );
};

type SalesTableProps = {
  displayData: SuperAdminSale[];
  tableLoading: boolean;
  searchTerm: string;
  formatDate: (dateString: string) => string;
  getStoveAge: (salesDate: string) => string;
  exportSales: (filters: any, format: string) => void;
  handleDownloadReceipt: (sale: SuperAdminSale) => void;
  handleShowAttachments: (sale: SuperAdminSale) => void;
  handleDelete: (sale: SuperAdminSale) => void;
  selectedItems: Set<string>;
  onSelectItem: (itemId: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
};

const SalesTable = ({
  displayData,
  tableLoading,
  searchTerm,
  formatDate,
  handleDownloadReceipt,
  handleShowAttachments,
  handleDelete,
  selectedItems,
  onSelectItem,
  onSelectAll,
}: SalesTableProps) => {
  const allCurrentPageSelected =
    displayData.length > 0 &&
    displayData.every((sale) => selectedItems.has(sale.id.toString()));

  const someSelected = displayData.some((sale) =>
    selectedItems.has(sale.id.toString()),
  );

  return (
    <Table>
      <TableHeader className="bg-brand">
        <TableRow className="hover:bg-brand">
          <TableHead className="text-white py-2 px-2 first:rounded-tl-lg w-10">
            <Checkbox
              checked={allCurrentPageSelected}
              onCheckedChange={(checked: boolean) => onSelectAll(checked)}
              aria-label="Select all items on this page"
              ref={((el: HTMLInputElement | null) => {
                if (el)
                  el.indeterminate = someSelected && !allCurrentPageSelected;
              }) as any}
              className="border-white data-[state=checked]:bg-white data-[state=checked]:text-brand"
            />
          </TableHead>
          <TableHead className="text-white py-2 px-2 whitespace-nowrap">Transaction ID</TableHead>
          <TableHead className="text-white py-2 px-2 whitespace-nowrap">Sales Date</TableHead>
          <TableHead className="text-white py-2 px-2 whitespace-nowrap">End User</TableHead>
          <TableHead className="text-white py-2 px-2 whitespace-nowrap">Phone Number</TableHead>
          <TableHead className="text-white py-2 px-2 whitespace-nowrap">State</TableHead>
          <TableHead className="text-white py-2 px-2 whitespace-nowrap">Stove ID</TableHead>
          <TableHead className="text-white py-2 px-2 whitespace-nowrap">Payment Model</TableHead>
          <TableHead className="text-white py-2 px-2 whitespace-nowrap text-right">Expected Amount</TableHead>
          <TableHead className="text-white py-2 px-2 whitespace-nowrap text-right">Amount Paid</TableHead>
          <TableHead className="text-white py-2 px-2 whitespace-nowrap text-right">Balance</TableHead>
          <TableHead className="text-center text-white py-2 px-2 last:rounded-tr-lg whitespace-nowrap">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className={tableLoading ? "opacity-40" : ""}>
        {displayData.length === 0 ? (
          <TableRow>
            <TableCell colSpan={12} className="text-center py-8">
              <div className="text-gray-500">
                {searchTerm
                  ? "No sales found matching your search."
                  : "No sales data available."}
              </div>
            </TableCell>
          </TableRow>
        ) : (
          displayData.map((sale: SuperAdminSale, index: number) => {
            const isSelected = selectedItems.has(sale.id.toString());
            const balance = sale.amount - (sale.total_paid ?? 0);

            return (
              <TableRow
                key={sale.id}
                className={`${
                  index % 2 === 0 ? "bg-white" : "bg-brand-light"
                } hover:bg-gray-50`}
              >
                <TableCell className="px-2 py-2">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked: boolean) =>
                      onSelectItem(sale.id.toString(), checked)
                    }
                    aria-label={`Select sale ${sale.transaction_id || sale.id}`}
                  />
                </TableCell>
                <TableCell className="px-2 py-2 font-medium text-xs whitespace-nowrap">
                  {sale.transaction_id ?? sale.id}
                </TableCell>
                <TableCell className="px-2 py-2 text-xs whitespace-nowrap">
                  {formatDate(sale.sales_date ?? "")}
                </TableCell>
                <TableCell className="px-2 py-2 text-xs whitespace-nowrap">
                  {sale.end_user_name ?? "N/A"}
                </TableCell>
                <TableCell className="px-2 py-2 text-xs whitespace-nowrap">
                  {sale.phone ?? "N/A"}
                </TableCell>
                <TableCell className="px-2 py-2 text-xs whitespace-nowrap">
                  {sale.state_backup ?? sale.addresses?.state ?? "N/A"}
                </TableCell>
                <TableCell className="px-2 py-2 text-xs whitespace-nowrap">
                  {sale.stove_serial_no ?? "N/A"}
                </TableCell>
                <TableCell className="px-2 py-2 text-xs whitespace-nowrap">
                  {sale.payment_model?.name ?? "Full Payment"}
                </TableCell>
                <TableCell className="px-2 py-2 text-xs whitespace-nowrap text-right">
                  ₦{sale.amount.toLocaleString()}
                </TableCell>
                <TableCell className="px-2 py-2 text-xs whitespace-nowrap text-right">
                  ₦{(sale.total_paid ?? 0).toLocaleString()}
                </TableCell>
                <TableCell className="px-2 py-2 text-xs whitespace-nowrap text-right">
                  {balance > 0 ? (
                    <span className="text-red-600 font-medium">₦{balance.toLocaleString()}</span>
                  ) : (
                    <span className="text-green-600 font-medium">₦0</span>
                  )}
                </TableCell>
                <TableCell className="px-2 py-2 cursor-pointer text-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-6 w-6 p-0">
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={async () => {
                          try {
                            const { formatSalesDataToCSV, downloadCSV } =
                              await import("../../../utils/csvExportUtils");
                            const csvContent = formatSalesDataToCSV([sale]);
                            const filename = `sale-${
                              sale.transaction_id || sale.id
                            }-${new Date().toISOString().split("T")[0]}.csv`;
                            downloadCSV(csvContent, filename);
                          } catch (error) {
                            console.error("Export error:", error);
                          }
                        }}
                      >
                        <Download className="mr-2 h-4 w-4" /> Export CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDownloadReceipt(sale)}
                      >
                        <Download className="mr-2 h-4 w-4" /> Download Receipt
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleShowAttachments(sale)}
                      >
                        <Eye className="mr-2 h-4 w-4" /> View Attachments
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(sale)}
                        className="text-red-600"
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
};

export default SalesTable;
