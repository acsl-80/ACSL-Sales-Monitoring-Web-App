import { Address, ImageData } from "./superAdminSales";

export interface AdminSales {
  organizations: any;
  id: string;
  transaction_id: string;
  stove_serial_no: string;
  sales_date: string; // ISO date string
  contact_person: string;
  contact_phone: string;
  end_user_name: string;
  aka: string;
  state_backup: string;
  lga_backup: string;
  phone: string;
  other_phone: string;
  amount: number;
  signature: string; // Base64 image string
  created_by: string;
  organization_id: string;
  address_id: string;
  stove_image_id: ImageData;
  agreement_image_id: ImageData;
  created_at: string; // ISO timestamp
  status: string; // could be "completed" | "pending" | ...
  address: Address;
  agent_approved?: boolean;
  partner_id?: string;
  partner_name?: string;

  // Agent info (joined from profiles via created_by)
  agent_name?: string;
  creator?: {
    id: string;
    full_name: string;
    email: string;
    phone?: string;
    role?: string;
  };

  // Installment payment fields
  is_installment?: boolean;
  payment_model_id?: string;
  total_paid?: number;
  payment_status?: string;
  payment_model?: {
    id: string;
    name: string;
    duration_months: number;
    fixed_price: number;
  };

  // New fields from user agreement form
  retailer_branch?: string;
  pot_quantity?: number | null;
  heat_retention_device?: boolean;
  previous_stove_type?: string;
  previous_stove_other?: string;
  meals_per_day?: string;
  cooking_fuel_source?: string;
  cooking_location?: string;
  terms_accepted?: {
    poaGoverned?: boolean;
    monitoring?: boolean;
    noResell?: boolean;
    emissionReductions?: boolean;
    noExport?: boolean;
    demonstration?: boolean;
  } | null;
};
