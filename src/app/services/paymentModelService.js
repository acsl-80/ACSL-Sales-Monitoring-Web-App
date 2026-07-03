// Payment Model Service
// Direct Supabase client implementation (no edge functions required).
import { getSupabase } from "@/lib/supabaseClient";

const supabase = getSupabase();

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

class PaymentModelService {
  // ─── Payment Models CRUD ────────────────────────────────────────────────

  async getPaymentModels(params = {}) {
    const { show_all, status, search } = params;

    let query = supabase
      .from("payment_models")
      .select("*, creator:profiles!created_by(id, full_name, email)", {
        count: "exact",
      });

    if (show_all === "true" || show_all === true) {
      if (status === "active") query = query.eq("is_active", true);
      else if (status === "inactive") query = query.eq("is_active", false);
    } else {
      query = query.eq("is_active", true);
    }

    if (search && String(search).trim()) {
      query = query.ilike("name", `%${String(search).trim()}%`);
    }

    query = query.order("created_at", { ascending: false });

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    // Compute top used model from sales
    let top_model = null;
    try {
      const { data: salesData } = await supabase
        .from("sales")
        .select("payment_model_id")
        .not("payment_model_id", "is", null);

      if (salesData && salesData.length > 0) {
        const counts = {};
        for (const row of salesData) {
          const id = row.payment_model_id;
          if (!id) continue;
          counts[id] = (counts[id] || 0) + 1;
        }
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (entries.length > 0) {
          const [topId, useCount] = entries[0];
          const model = (data || []).find((m) => m.id === topId);
          const name =
            model?.name ||
            (
              await supabase
                .from("payment_models")
                .select("name")
                .eq("id", topId)
                .maybeSingle()
            ).data?.name ||
            "Unknown";
          top_model = { name, use_count: Number(useCount) };
        }
      }
    } catch (_) {
      // non-critical
    }

    return {
      success: true,
      message: `Found ${count || 0} payment models`,
      data: data || [],
      total: count || 0,
      top_model,
    };
  }

  async getPaymentModel(id) {
    const { data, error } = await supabase
      .from("payment_models")
      .select("*, creator:profiles!created_by(id, full_name, email)")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);

    const { count } = await supabase
      .from("organization_payment_models")
      .select("*", { count: "exact", head: true })
      .eq("payment_model_id", id);

    return {
      success: true,
      message: "Payment model retrieved successfully",
      data: { ...data, assigned_organizations_count: count || 0 },
    };
  }

  async createPaymentModel(payload) {
    const {
      name,
      description,
      duration_months,
      fixed_price,
      min_down_payment,
    } = payload || {};

    if (!name || !String(name).trim()) throw new Error("Name is required");
    if (!duration_months || Number(duration_months) < 1)
      throw new Error("Duration must be at least 1 month");
    if (!fixed_price || Number(fixed_price) <= 0)
      throw new Error("Fixed price must be greater than 0");
    const minDown = Number(min_down_payment) || 0;
    if (minDown < 0) throw new Error("Minimum down payment cannot be negative");
    if (minDown > Number(fixed_price))
      throw new Error("Minimum down payment cannot exceed fixed price");

    const userId = await currentUserId();
    if (!userId) throw new Error("Not authenticated");

    const { data, error } = await supabase
      .from("payment_models")
      .insert({
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        duration_months: Number(duration_months),
        fixed_price: Number(fixed_price),
        min_down_payment: minDown,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return {
      success: true,
      message: "Payment model created successfully",
      data,
    };
  }

  async updatePaymentModel(id, patch) {
    const updates = {};
    if (patch.name !== undefined) updates.name = String(patch.name).trim();
    if (patch.description !== undefined)
      updates.description = patch.description
        ? String(patch.description).trim()
        : null;
    if (patch.duration_months !== undefined) {
      if (Number(patch.duration_months) < 1)
        throw new Error("Duration must be at least 1 month");
      updates.duration_months = Number(patch.duration_months);
    }
    if (patch.fixed_price !== undefined) {
      if (Number(patch.fixed_price) <= 0)
        throw new Error("Fixed price must be greater than 0");
      updates.fixed_price = Number(patch.fixed_price);
    }
    if (patch.min_down_payment !== undefined)
      updates.min_down_payment = Number(patch.min_down_payment) || 0;
    if (patch.is_active !== undefined) updates.is_active = !!patch.is_active;

    if (Object.keys(updates).length === 0)
      throw new Error("No fields to update");

    const { data, error } = await supabase
      .from("payment_models")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    return {
      success: true,
      message: "Payment model updated successfully",
      data,
    };
  }

  async deletePaymentModel(id) {
    // Check if any sales reference this model
    const { count: salesCount } = await supabase
      .from("sales")
      .select("*", { count: "exact", head: true })
      .eq("payment_model_id", id);

    if (salesCount && salesCount > 0) {
      const { data, error } = await supabase
        .from("payment_models")
        .update({ is_active: false })
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return {
        success: true,
        message:
          "Payment model deactivated (has associated sales, cannot hard delete)",
        data,
      };
    }

    await supabase
      .from("organization_payment_models")
      .delete()
      .eq("payment_model_id", id);

    const { error } = await supabase
      .from("payment_models")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);

    return { success: true, message: "Payment model deleted successfully" };
  }

  // ─── Organization Payment Model Assignments ──────────────────────────────

  async getOrgPaymentModels(orgId) {
    const { data, error } = await supabase
      .from("organization_payment_models")
      .select("*, payment_model:payment_models(*)")
      .eq("organization_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true, data: data || [] };
  }

  async setOrgPaymentModels(orgId, paymentModelIds) {
    const ids = Array.isArray(paymentModelIds) ? paymentModelIds : [];
    const userId = await currentUserId();
    if (!userId) throw new Error("Not authenticated");

    const { data: existing, error: exErr } = await supabase
      .from("organization_payment_models")
      .select("payment_model_id")
      .eq("organization_id", orgId);
    if (exErr) throw new Error(exErr.message);

    const existingIds = new Set((existing || []).map((r) => r.payment_model_id));
    const nextIds = new Set(ids);

    const toRemove = [...existingIds].filter((x) => !nextIds.has(x));
    const toAdd = [...nextIds].filter((x) => !existingIds.has(x));

    if (toRemove.length > 0) {
      const { error: delErr } = await supabase
        .from("organization_payment_models")
        .delete()
        .eq("organization_id", orgId)
        .in("payment_model_id", toRemove);
      if (delErr) throw new Error(delErr.message);
    }

    if (toAdd.length > 0) {
      const rows = toAdd.map((pmId) => ({
        organization_id: orgId,
        payment_model_id: pmId,
        assigned_by: userId,
      }));
      const { error: insErr } = await supabase
        .from("organization_payment_models")
        .insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    return {
      success: true,
      message: "Assignments updated",
      data: { added: toAdd.length, removed: toRemove.length },
    };
  }

  async removeOrgPaymentModel(orgId, modelId) {
    const { error } = await supabase
      .from("organization_payment_models")
      .delete()
      .eq("organization_id", orgId)
      .eq("payment_model_id", modelId);
    if (error) throw new Error(error.message);
    return { success: true, message: "Assignment removed" };
  }

  // ─── Installment Payments ────────────────────────────────────────────────

  async getInstallmentPayments(saleId) {
    const { data, error } = await supabase
      .from("installment_payments")
      .select("*")
      .eq("sale_id", saleId)
      .order("payment_date", { ascending: false });
    if (error) throw new Error(error.message);

    const payments = data || [];
    const total_paid = payments.reduce(
      (acc, p) => acc + Number(p.amount || 0),
      0,
    );

    // Pull sale + payment model context for the modal
    let payment_model = null;
    let sale_amount = 0;
    try {
      const { data: sale } = await supabase
        .from("sales")
        .select("amount, total_paid, payment_model_id")
        .eq("id", saleId)
        .maybeSingle();
      if (sale) {
        sale_amount = Number(sale.amount || 0);
        if (sale.payment_model_id) {
          const { data: pm } = await supabase
            .from("payment_models")
            .select("*")
            .eq("id", sale.payment_model_id)
            .maybeSingle();
          payment_model = pm || null;
        }
      }
    } catch (_) {
      // non-critical
    }

    const fixed_price = Number(payment_model?.fixed_price || sale_amount || 0);
    const remaining_balance = Math.max(0, fixed_price - total_paid);
    const progress_percent = fixed_price > 0 ? Math.min(100, Math.round((total_paid / fixed_price) * 100)) : 0;
    const payment_status =
      total_paid <= 0
        ? "not_applicable"
        : remaining_balance <= 0
        ? "fully_paid"
        : "partially_paid";

    const summary = {
      total_paid,
      payment_count: payments.length,
      balance: remaining_balance,
      remaining: remaining_balance,
      remaining_balance,
      sale_amount,
      total_amount: fixed_price,
      fixed_price,
      progress_percent,
      payment_status,
      is_installment: true,
    };

    return { success: true, data: payments, summary, payment_model };
  }

  async recordInstallmentPayment(saleId, payload) {
    const userId = await currentUserId();
    if (!userId) throw new Error("Not authenticated");

    const insertRow = {
      sale_id: saleId,
      amount: Number(payload.amount),
      payment_method: payload.payment_method,
      proof_image_url: payload.proof_image_url || null,
      proof_image_id: payload.proof_image_id || null,
      notes: payload.notes || null,
      recorded_by: userId,
      payment_date:
        payload.payment_date || new Date().toISOString().slice(0, 10),
    };

    const { data, error } = await supabase
      .from("installment_payments")
      .insert(insertRow)
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Ensure the sale row reflects the new payment (in case no DB trigger handles it)
    try {
      const { data: saleRow } = await supabase
        .from("sales")
        .select("amount, total_paid")
        .eq("id", saleId)
        .single();
      if (saleRow) {
        const newTotalPaid =
          (Number(saleRow.total_paid) || 0) + Number(payload.amount);
        const total = Number(saleRow.amount) || 0;
        const newStatus =
          total > 0 && newTotalPaid >= total
            ? "fully_paid"
            : newTotalPaid > 0
            ? "partially_paid"
            : "pending";
        await supabase
          .from("sales")
          .update({ total_paid: newTotalPaid, payment_status: newStatus })
          .eq("id", saleId);
      }
    } catch (e) {
      console.warn("[recordInstallmentPayment] sale totals update failed", e);
    }

    return { success: true, message: "Payment recorded", data };
  }
}

const paymentModelService = new PaymentModelService();
export default paymentModelService;
