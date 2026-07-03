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
