// Add to your existing types/sales.ts or create types/receipt.ts
import { SuperAdminSale } from "./superAdminSales";

export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  logo?: string;
}

export interface ReceiptProps {
  sale: SuperAdminSale;
  companyInfo?: CompanyInfo;
}

export interface DownloadReceiptOptions {
  filename?: string;
  quality?: number;
  scale?: number;
}
