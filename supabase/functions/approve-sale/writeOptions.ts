// Approve sale operation
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

export async function approveSale(
  supabase: any,
  saleId: string,
  userId: string,
  userRole: string
) {
  console.log("✅ Approving sale:", saleId, "by:", userId);

  // Fetch the sale
  const { data: sale, error: saleError } = await supabase
    .from("sales")
    .select("id, organization_id, agent_approved")
    .eq("id", saleId)
    .single();

  if (saleError) {
    if (saleError.code === "PGRST116") throw new Error("Sale not found");
    throw new Error(`Database error: ${saleError.message}`);
  }

  if (sale.agent_approved) {
    throw new Error("Sale is already approved");
  }

  // If caller is acsl_agent (formerly super_admin_agent), verify they are assigned to this sale's org
  if (userRole === "acsl_agent" || userRole === "super_admin_agent") {
    const { assignedOrgIds } = await resolveAssignedOrgIds(supabase, userId);
    if (!assignedOrgIds.includes(sale.organization_id)) {
      throw new Error("Unauthorized: You are not assigned to this organization");
    }
  }

  // Update the sale
  const { data: updated, error: updateError } = await supabase
    .from("sales")
    .update({
      agent_approved: true,
      agent_approved_at: new Date().toISOString(),
      agent_approved_by: userId,
    })
    .eq("id", saleId)
    .select("id, agent_approved, agent_approved_at, agent_approved_by, organization_id, stove_serial_no")
    .single();

  if (updateError) throw new Error(`Database error: ${updateError.message}`);

  console.log("✅ Sale approved:", saleId);

  return {
    message: "Sale approved successfully",
    data: updated,
  };
}
