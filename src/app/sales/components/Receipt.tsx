import React from "react";
import { SuperAdminSale } from "@/types/superAdminSales";

interface ReceiptProps {
  sale: SuperAdminSale;
  companyInfo?: {
    name: string;
    address: string;
    phone: string;
    email: string;
    logo?: string;
  };
}

const Receipt: React.FC<ReceiptProps> = ({
  sale,
  companyInfo = {
    name: "Atmosfair",
    address: "123 Business Street, Lagos, Nigeria",
    phone: "+234 123 456 7890",
    email: "info@atmosfair.com",
  },
}) => {
  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return "Invalid Date";
    }
  };

  const formatCurrency = (amount?: number) => {
    if (!amount && amount !== 0) return "₦0.00";
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const calculateStoveAge = (salesDate?: string) => {
    if (!salesDate) return "N/A";
    const soldDate = new Date(salesDate);
    const now = new Date();
    let years = now.getFullYear() - soldDate.getFullYear();
    let months = now.getMonth() - soldDate.getMonth();
    let days = now.getDate() - soldDate.getDate();

    if (days < 0) {
      months--;
      days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    }
    if (months < 0) {
      years--;
      months += 12;
    }

    let result = [];
    if (years > 0) result.push(`${years}y`);
    if (months > 0) result.push(`${months}m`);
    if (days > 0) result.push(`${days}d`);
    return result.length ? result.join(" ") : "0d";
  };

  return (
    <div className="max-w-4xl mx-auto bg-white p-8 font-sans text-gray-900">
      {/* Header */}
      <div className="border-b-2 border-gray-200 pb-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {companyInfo.name}
            </h1>
            <p className="text-gray-600 text-sm leading-relaxed">
              {companyInfo.address}
            </p>
            <p className="text-gray-600 text-sm">{companyInfo.phone}</p>
            <p className="text-gray-600 text-sm">{companyInfo.email}</p>
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">RECEIPT</h2>
            <p className="text-gray-600 text-sm">
              Receipt #: {sale.transaction_id || sale.id}
            </p>
            <p className="text-gray-600 text-sm">
              Date: {formatDate(sale.sales_date || sale.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Customer & Transaction Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-1">
            Customer Information
          </h3>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium text-gray-700">Name:</span>{" "}
              {sale.end_user_name || "N/A"}
            </p>
            <p>
              <span className="font-medium text-gray-700">Phone:</span>{" "}
              {sale.phone || "N/A"}
            </p>
            {sale.other_phone && (
              <p>
                <span className="font-medium text-gray-700">Alt Phone:</span>{" "}
                {sale.other_phone}
              </p>
            )}
            <p>
              <span className="font-medium text-gray-700">Contact Person:</span>{" "}
              {sale.contact_person || "N/A"}
            </p>
            <p>
              <span className="font-medium text-gray-700">Location:</span>{" "}
              {sale.state_backup || sale.addresses?.state || "N/A"},{" "}
              {sale.lga_backup || sale.addresses?.city || "N/A"}
            </p>
            {sale.addresses?.full_address && (
              <p>
                <span className="font-medium text-gray-700">Address:</span>{" "}
                {sale.addresses.full_address}
              </p>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3 border-b border-gray-200 pb-1">
            Sale Information
          </h3>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium text-gray-700">Partner:</span>{" "}
              {sale.partner_name || sale.organizations?.name || "N/A"}
            </p>
            <p>
              <span className="font-medium text-gray-700">Status:</span>
              <span
                className={`ml-2 px-2 py-1 rounded text-xs font-medium ${
                  sale.status === "completed"
                    ? "bg-green-100 text-green-800"
                    : sale.status === "pending"
                    ? "bg-yellow-100 text-yellow-800"
                    : sale.status === "active"
                    ? "bg-blue-100 text-blue-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {sale.status || "N/A"}
              </span>
            </p>
            <p>
              <span className="font-medium text-gray-700">Sale Date:</span>{" "}
              {formatDate(sale.sales_date)}
            </p>
            <p>
              <span className="font-medium text-gray-700">Created:</span>{" "}
              {formatDate(sale.created_at)}
            </p>
            {sale.addresses?.latitude && sale.addresses?.longitude && (
              <p>
                <span className="font-medium text-gray-700">Coordinates:</span>{" "}
                {sale.addresses.latitude}, {sale.addresses.longitude}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Product Details */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b border-gray-200 pb-1">
          Product Details
        </h3>
        <div className="bg-gray-50 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left py-3 px-4 font-semibold text-gray-700 text-sm">
                  Item
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700 text-sm">
                  Serial Number
                </th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700 text-sm">
                  Age
                </th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700 text-sm">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="py-4 px-4 text-sm">Stove</td>
                <td className="py-4 px-4 text-sm font-mono">
                  {sale.stove_serial_no || "N/A"}
                </td>
                <td className="py-4 px-4 text-sm">
                  {calculateStoveAge(sale.sales_date)}
                </td>
                <td className="py-4 px-4 text-sm text-right font-semibold">
                  {formatCurrency(sale.amount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Total */}
      <div className="flex justify-end mb-8">
        <div className="w-64">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex justify-between items-center border-b border-gray-200 pb-2 mb-2">
              <span className="text-sm font-medium text-gray-700">
                Subtotal:
              </span>
              <span className="text-sm font-semibold">
                {formatCurrency(sale.amount)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-lg font-bold text-gray-900">Total:</span>
              <span className="text-lg font-bold text-gray-900">
                {formatCurrency(sale.amount)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t-2 border-gray-200 pt-6 text-center">
        <p className="text-sm text-gray-600 mb-2">
          Thank you for your business!
        </p>
        <p className="text-xs text-gray-500">
          This is a computer-generated receipt and does not require a signature.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Generated on{" "}
          {new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
};

export default Receipt;
