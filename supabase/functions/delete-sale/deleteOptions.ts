// Delete operation for a sale

export async function deleteSale(
  supabase: any,
  saleId: string,
  userRole: string,
  organizationId: string | null
) {
  console.log("🗑️ Deleting sale:", saleId);

  if (!saleId) {
    throw new Error("Sale ID is required");
  }

  // Fetch the sale first to verify it exists and check org ownership
  let query = supabase
    .from("sales")
    .select("id, organization_id, transaction_id, stove_serial_no")
    .eq("id", saleId)
    .single();

  const { data: sale, error: fetchError } = await query;

  if (fetchError || !sale) {
    if (fetchError?.code === "PGRST116") {
      throw new Error("Sale not found");
    }
    throw new Error(`Failed to fetch sale: ${fetchError?.message}`);
  }

  // Admins can only delete sales in their own organization
  if (userRole === "admin" && organizationId && sale.organization_id !== organizationId) {
    throw new Error("Unauthorized: You can only delete sales from your organization");
  }

  // Release the stove back to available before deleting the sale
  // (stove_ids.sale_id has a check constraint that blocks deleting a referenced sale)
  if (sale.stove_serial_no) {
    const { error: stoveResetError } = await supabase
      .from("stove_ids")
      .update({ sale_id: null, status: "available" })
      .eq("stove_id", sale.stove_serial_no);

    if (stoveResetError) {
      console.warn("⚠️ Could not reset stove status:", stoveResetError.message);
    }
  }

  // Delete the sale
  const { error: deleteError } = await supabase
    .from("sales")
    .delete()
    .eq("id", saleId);

  if (deleteError) {
    console.error("❌ Error deleting sale:", deleteError);
    throw new Error(`Failed to delete sale: ${deleteError.message}`);
  }

  console.log("✅ Sale deleted successfully:", saleId);

  return {
    message: "Sale deleted successfully",
    data: { id: saleId, transaction_id: sale.transaction_id },
  };
}
