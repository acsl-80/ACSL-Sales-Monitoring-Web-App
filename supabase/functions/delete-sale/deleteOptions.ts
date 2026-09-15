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

  // Ask the Data Center first (D56). A sale with logged calls, a verdict or a
  // correction is refused before the stove is touched, because the release
  // below and the delete are two calls: a refusal after the release would
  // leave the stove free while the sale still stands.
  const { data: work, error: workError } = await supabase.rpc("sale_call_work", { _sale_id: saleId });
  if (workError) {
    throw new Error(`Failed to check the sale's call-centre work: ${workError.message}`);
  }
  const attempts = Number(work?.attempts ?? 0);
  const corrections = Number(work?.corrections ?? 0);
  const verdict = work?.verdict ?? null;
  if (attempts > 0 || corrections > 0 || verdict) {
    const parts = [`${attempts} logged call${attempts === 1 ? "" : "s"}`];
    if (verdict) parts.push(`a verdict of ${String(verdict).replace(/_/g, " ")}`);
    if (corrections > 0) parts.push(`${corrections} correction${corrections === 1 ? "" : "s"}`);
    const err = new Error(
      `This sale carries call-centre work (${parts.join(", ")}). Cancel the sale instead of deleting it, so the record and its history stay.`,
    );
    (err as Error & { code?: string }).code = "call_work_attached";
    throw err;
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
    // The stove was released a moment ago for a delete that did not happen;
    // put it back so the sale keeps its stove.
    if (sale.stove_serial_no) {
      await supabase
        .from("stove_ids")
        .update({ sale_id: saleId, status: "sold" })
        .eq("stove_id", sale.stove_serial_no)
        .is("sale_id", null);
    }
    throw new Error(`Failed to delete sale: ${deleteError.message}`);
  }

  console.log("✅ Sale deleted successfully:", saleId);

  return {
    message: "Sale deleted successfully",
    data: { id: saleId, transaction_id: sale.transaction_id },
  };
}
