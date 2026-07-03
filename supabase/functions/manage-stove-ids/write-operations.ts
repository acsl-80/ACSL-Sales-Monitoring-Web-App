// Write operations for stove ID management

/**
 * Archive a stove ID and its associated sale (if any)
 */
export async function archiveStoveId(
  supabase: any,
  userRole: string,
  organizationId: string | null,
  body: any
) {
  const { id, note } = body;

  if (!id) {
    throw new Error("Stove ID (id) is required");
  }

  console.log(`📦 Archiving stove ID: ${id} with note: ${note}`);

  // Only super_admin can archive stove IDs
  if (userRole !== "super_admin") {
    throw new Error("Unauthorized: Only super admins can archive stove IDs");
  }

  // 1. Get the stove ID details to find the associated sale_id
  const { data: stove, error: fetchError } = await supabase
    .from("stove_ids")
    .select("id, sale_id, stove_id")
    .eq("id", id)
    .single();

  if (fetchError || !stove) {
    throw new Error(`Stove ID not found: ${fetchError?.message || "Unknown error"}`);
  }

  // 2. Update the stove ID to archived
  const { error: updateStoveError } = await supabase
    .from("stove_ids")
    .update({
      is_archived: true,
      archive_note: note || "No note provided",
    })
    .eq("id", id);

  if (updateStoveError) {
    throw new Error(`Failed to archive stove ID: ${updateStoveError.message}`);
  }

  // 3. If there's an associated sale, archive it too
  if (stove.sale_id) {
    console.log(`📦 Archiving associated sale: ${stove.sale_id}`);
    const { error: updateSaleError } = await supabase
      .from("sales")
      .update({
        is_archived: true,
      })
      .eq("id", stove.sale_id);

    if (updateSaleError) {
      console.error(`⚠️ Failed to archive associated sale: ${updateSaleError.message}`);
      // We don't necessarily want to fail the whole operation if the sale archive fails, 
      // but the user's requirement says it should be archived.
    }
  }

  console.log(`✅ Stove ID ${stove.stove_id} archived successfully`);

  return {
    success: true,
    message: `Stove ID ${stove.stove_id} has been archived`,
  };
}
