import { createClientComponentClient } from "@/lib/supabaseClient";

export interface BlockingSale {
  stove_serial_no: string | null;
  sales_reference: string | null;
  sales_date: string | null;
  partner_name: string | null;
  sale_id: string;
}

export async function checkPurchaseCancellable(transferId: string): Promise<BlockingSale[]> {
  const supabase = createClientComponentClient();
  const { data, error } = await supabase.rpc("check_purchase_cancellable", {
    _transfer_id: transferId,
  });
  if (error) throw new Error(error.message);
  return (data || []) as BlockingSale[];
}

export async function cancelPurchase(transferId: string, reason: string): Promise<string> {
  const supabase = createClientComponentClient();
  const { data, error } = await supabase.rpc("cancel_purchase", {
    _transfer_id: transferId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface CancelledPurchaseRecord {
  id: string;
  original_transfer_id: string | null;
  transaction_id: string | null;
  organization_id: string | null;
  partner_id: string | null;
  partner_name: string | null;
  state: string | null;
  branch: string | null;
  sales_factory: string | null;
  sales_date: string | null;
  transfer_date: string | null;
  stove_count: number;
  stove_ids_snapshot: Array<{ stove_id: string; factory?: string; sales_reference?: string }>;
  cancellation_reason: string;
  cancelled_by: string | null;
  cancelled_at: string;
}

export async function listCancelledPurchases(): Promise<CancelledPurchaseRecord[]> {
  const supabase = createClientComponentClient();
  const { data, error } = await supabase
    .from("cancelled_purchases")
    .select("*")
    .order("cancelled_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data || []) as CancelledPurchaseRecord[];
}
