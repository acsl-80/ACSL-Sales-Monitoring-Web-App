// Related data fetcher module
import { Filters } from "./parse-filters.ts";

export async function fetchRelatedData(
  supabase: any,
  sales: any[],
  filters: Filters
) {
  console.log("🔗 Fetching additional related data...");

  if (!sales || sales.length === 0) {
    console.log("🔗 No sales data to process");
    return sales;
  }

  console.log(
    `🔗 Processing ${sales.length} sales records for additional data`
  );

  // Use Promise.all for parallel fetching to improve performance
  const fetchPromises: Promise<void>[] = [];

  // Organization, address and creator are needed everywhere, so they are fetched
  // unconditionally (not gated behind include* flags) whenever they aren't already
  // present from the main-query joins. Each is a single indexed IN query.
  if (!sales[0]?.organizations && !sales[0]?.organization) {
    fetchPromises.push(fetchOrganizations(supabase, sales));
  }

  if (!sales[0]?.addresses && !sales[0]?.address) {
    fetchPromises.push(fetchAddresses(supabase, sales));
  }

  if (!sales[0]?.creator) {
    fetchPromises.push(fetchCreators(supabase, sales));
  }

  if (!sales[0]?.updated_by_profile) {
    fetchPromises.push(fetchModifiers(supabase, sales));
  }

  // Installment payment counts are needed for the Payment column summary.
  fetchPromises.push(fetchInstallmentSummaries(supabase, sales));

  if (
    (filters.includeImages ||
      filters.includeStoveImage ||
      filters.includeAgreementImage) &&
    !sales[0]?.stove_image &&
    !sales[0]?.agreement_image
  ) {
    fetchPromises.push(fetchImages(supabase, sales));
  }

  // Execute all fetches in parallel
  if (fetchPromises.length > 0) {
    console.log(
      `🚀 Executing ${fetchPromises.length} additional fetch operations in parallel...`
    );
    await Promise.all(fetchPromises);
    console.log("✅ All additional fetches completed");
  } else {
    console.log("ℹ️ All required data already included in main query");
  }

  return sales;
}

async function fetchOrganizations(supabase: any, sales: any[]) {
  console.log("🏢 Fetching organizations optimized...");

  const orgIds = [
    ...new Set(
      sales
        .map((sale) => sale.organization_id)
        .filter((id) => id !== null && id !== undefined)
    ),
  ];

  if (orgIds.length === 0) {
    console.log("🏢 No organization IDs to fetch");
    return;
  }

  console.log(`🏢 Fetching ${orgIds.length} unique organizations`);

  const { data: organizations, error: orgsError } = await supabase
    .from("organizations")
    .select("id, partner_name, branch, state, email, created_at")
    .in("id", orgIds);

  if (orgsError) {
    console.log("❌ Error fetching organizations:", orgsError.message);
    return;
  }

  console.log(
    `🏢 Successfully fetched ${organizations?.length || 0} organizations`
  );

  // Create a Map for O(1) lookup instead of O(n) for each sale
  const orgMap = new Map(organizations?.map((org) => [org.id, org]) || []);

  // Attach organizations to sales records
  sales.forEach((sale) => {
    if (sale.organization_id) {
      sale.organization = orgMap.get(sale.organization_id) || null;
    }
  });
}

async function fetchAddresses(supabase: any, sales: any[]) {
  console.log("📍 Fetching addresses optimized...");

  const addressIds = [
    ...new Set(
      sales
        .map((sale) => sale.address_id)
        .filter((id) => id !== null && id !== undefined)
    ),
  ];

  if (addressIds.length === 0) {
    console.log("📍 No address IDs to fetch");
    return;
  }

  console.log(`📍 Fetching ${addressIds.length} unique addresses`);

  const { data: addresses, error: addressError } = await supabase
    .from("addresses")
    .select(
      "id, city, state, street, country, latitude, longitude, full_address, created_at"
    )
    .in("id", addressIds);

  if (addressError) {
    console.log("❌ Error fetching addresses:", addressError.message);
    return;
  }

  console.log(`📍 Successfully fetched ${addresses?.length || 0} addresses`);

  // Create a Map for O(1) lookup
  const addressMap = new Map(addresses?.map((addr) => [addr.id, addr]) || []);

  // Attach addresses to sales records
  sales.forEach((sale) => {
    if (sale.address_id) {
      sale.address = addressMap.get(sale.address_id) || null;
    }
  });
}

async function fetchCreators(supabase: any, sales: any[]) {
  console.log("👤 Fetching creators optimized...");

  const creatorIds = [
    ...new Set(
      sales
        .map((sale) => sale.created_by)
        .filter((id) => id !== null && id !== undefined)
    ),
  ];

  if (creatorIds.length === 0) {
    console.log("👤 No creator IDs to fetch");
    return;
  }

  console.log(`👤 Fetching ${creatorIds.length} unique creators`);

  const { data: creators, error: creatorsError } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role")
    .in("id", creatorIds);

  if (creatorsError) {
    console.log("❌ Error fetching creators:", creatorsError.message);
    return;
  }

  console.log(`👤 Successfully fetched ${creators?.length || 0} creators`);

  // Create a Map for O(1) lookup
  const creatorMap = new Map(
    creators?.map((creator) => [creator.id, creator]) || []
  );

  // Attach creators to sales records
  sales.forEach((sale) => {
    if (sale.created_by) {
      sale.creator = creatorMap.get(sale.created_by) || null;
    }
  });
}

async function fetchModifiers(supabase: any, sales: any[]) {
  console.log("✏️ Fetching last-modified profiles...");

  const ids = [
    ...new Set(
      sales
        .map((s) => s.updated_by)
        .filter((id) => id !== null && id !== undefined)
    ),
  ];

  if (ids.length === 0) {
    sales.forEach((s) => (s.updated_by_profile = null));
    return;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);

  if (error) {
    console.log("❌ Error fetching modifiers:", error.message);
    return;
  }

  const map = new Map((data || []).map((p: any) => [p.id, p]));
  sales.forEach((sale) => {
    sale.updated_by_profile = sale.updated_by ? map.get(sale.updated_by) || null : null;
  });
}

async function fetchImages(supabase: any, sales: any[]) {
  console.log("🖼️ Fetching images optimized...");

  // Collect all unique image IDs
  const stoveImageIds = sales
    .map((sale) => sale.stove_image_id)
    .filter((id) => id !== null && id !== undefined);
  const agreementImageIds = sales
    .map((sale) => sale.agreement_image_id)
    .filter((id) => id !== null && id !== undefined);
  const allImageIds = [...new Set([...stoveImageIds, ...agreementImageIds])];

  if (allImageIds.length === 0) {
    console.log("🖼️ No image IDs to fetch");
    return;
  }

  console.log(`🖼️ Fetching ${allImageIds.length} unique images`);

  const { data: images, error: imagesError } = await supabase
    .from("uploads")
    .select("id, public_id, url, type, created_by, created_at")
    .in("id", allImageIds);

  if (imagesError) {
    console.log("❌ Error fetching images:", imagesError.message);
    return;
  }

  console.log(`🖼️ Successfully fetched ${images?.length || 0} images`);

  // Create a Map for O(1) lookup
  const imageMap = new Map(images?.map((img) => [img.id, img]) || []);

  // Attach images to sales records
  sales.forEach((sale) => {
    if (sale.stove_image_id) {
      sale.stove_image = imageMap.get(sale.stove_image_id) || null;
    }
    if (sale.agreement_image_id) {
      sale.agreement_image = imageMap.get(sale.agreement_image_id) || null;
    }
  });
}

async function fetchInstallmentSummaries(supabase: any, sales: any[]) {
  console.log("💳 Fetching installment payment summaries...");

  const installmentSaleIds = [
    ...new Set(
      sales
        .filter((sale) => sale.is_installment)
        .map((sale) => sale.id)
        .filter((id) => id !== null && id !== undefined)
    ),
  ];

  if (installmentSaleIds.length === 0) {
    console.log("💳 No installment sales to summarize");
    sales.forEach((sale) => {
      sale.installment_summary = null;
    });
    return;
  }

  console.log(
    `💳 Fetching payment counts for ${installmentSaleIds.length} installment sales`
  );

  const { data: payments, error: paymentsError } = await supabase
    .from("installment_payments")
    .select("sale_id")
    .in("sale_id", installmentSaleIds);

  if (paymentsError) {
    console.log("❌ Error fetching installment payments:", paymentsError.message);
    return;
  }

  // Count payments per sale
  const paymentCountMap = new Map<string, number>();
  payments?.forEach((payment: any) => {
    paymentCountMap.set(
      payment.sale_id,
      (paymentCountMap.get(payment.sale_id) || 0) + 1
    );
  });

  sales.forEach((sale) => {
    if (!sale.is_installment) {
      sale.installment_summary = null;
      return;
    }

    const totalInstallments = sale.payment_model?.duration_months || 1;
    const paymentCount = paymentCountMap.get(sale.id) || 0;

    // A sale can be settled ahead of schedule (lump-sum / one-off payment), so
    // the payment-row count understates progress. Balance is the source of
    // truth: once nothing is owed the schedule is closed out — no installments
    // left, no next due date.
    const amount = Number(sale.amount ?? 0);
    const totalPaid = Number(sale.total_paid ?? 0);
    const settled =
      sale.payment_status === "fully_paid" || (amount > 0 && totalPaid >= amount);

    const paidInstallments = settled
      ? totalInstallments
      : Math.min(paymentCount, totalInstallments);
    const leftInstallments = settled
      ? 0
      : Math.max(0, totalInstallments - paidInstallments);

    let nextDueDate: string | null = null;
    if (leftInstallments > 0) {
      const baseDate = new Date(sale.sales_date || sale.created_at);
      if (!isNaN(baseDate.getTime())) {
        baseDate.setMonth(baseDate.getMonth() + paidInstallments);
        nextDueDate = baseDate.toISOString();
      }
    }

    sale.installment_summary = {
      total_installments: totalInstallments,
      paid_installments: paidInstallments,
      left_installments: leftInstallments,
      next_due_date: nextDueDate,
      installment_amount:
        sale.payment_model?.fixed_price && totalInstallments
          ? Number((sale.payment_model.fixed_price / totalInstallments).toFixed(2))
          : undefined,
    };
  });

  console.log("✅ Installment payment summaries attached");
}

function logRelatedDataResults(sales: any[]) {
  if (sales.length === 0) return;

  const sampleSale = sales[0];
  console.log("🔗 Sample sale with related data:");
  console.log(`   - Has address: ${!!sampleSale.address}`);
  console.log(`   - Has creator: ${!!sampleSale.creator}`);
  console.log(`   - Has organization: ${!!sampleSale.organization}`);
  console.log(`   - Has stove_image: ${!!sampleSale.stove_image}`);
  console.log(`   - Has agreement_image: ${!!sampleSale.agreement_image}`);
}
