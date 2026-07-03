// CSV Import operations for organizations
import { validateOrganizationData } from "./validate.ts";
import {
  createUserInAuth,
  generateSecurePassword,
  sendWelcomeEmail,
} from "./user-utils.ts";

export interface CSVRowData {
  "Sales Reference": string;
  "Sales Date": string;
  Customer: string;
  State: string;
  Branch: string;
  Quantity: string;
  "Downloaded by": string;
  "Stove IDs": string;
  "Sales Factory": string;
  "Sales Rep": string;
  "Partner ID": string;
  "Partner Address": string;
  "Partner Contact Person": string;
  "Partner Contact Phone": string;
  "Partner Alternative Phone": string;
  "Partner Email": string;
}

export interface ProcessedOrganizationData {
  partner_id: string;
  partner_name: string;
  branch: string;
  state: string;
  contact_person?: string;
  contact_phone?: string;
  alternative_phone?: string;
  email?: string;
  address?: string;
}

export async function importCSVData(
  supabase: any,
  csvData: CSVRowData[],
  userId: string
) {
  console.log(`📊 Processing CSV import with ${csvData.length} rows...`);

  const results = {
    created: [] as any[],
    updated: [] as any[],
    errors: [] as any[],
    stove_ids: {
      imported: 0,
      skipped: 0,
      errors: [] as string[],
    },
    summary: {
      total_rows: csvData.length,
      organizations_created: 0,
      organizations_updated: 0,
      errors_count: 0,
      stove_ids_imported: 0,
      stove_ids_skipped: 0,
    },
  };

  // Group CSV rows by Partner ID to avoid duplicates in the same import
  const organizationsByPartnerId = new Map<string, ProcessedOrganizationData>();
  // Group stove IDs by Partner ID for processing after organization creation
  const stoveIdsByPartnerId = new Map<string, string[]>();

  // Process CSV rows and extract unique organizations
  for (const row of csvData) {
    try {
      const partnerId = row["Partner ID"]?.trim();
      if (!partnerId) {
        results.errors.push({
          row_data: row,
          error: "Missing Partner ID",
          type: "validation_error",
        });
        continue;
      }

      // Convert CSV row to organization data
      const orgData: ProcessedOrganizationData = {
        partner_id: partnerId,
        partner_name: row["Customer"]?.trim() || "Unknown Partner",
        branch: row["Branch"]?.trim() || "Main Branch",
        state: row["State"]?.trim() || "Unknown State",
        contact_person: row["Partner Contact Person"]?.trim() || null,
        contact_phone: row["Partner Contact Phone"]?.trim() || null,
        alternative_phone: row["Partner Alternative Phone"]?.trim() || null,
        email: row["Partner Email"]?.trim() || null,
        address: row["Partner Address"]?.trim() || null,
      };

      // Clean up empty strings to null
      Object.keys(orgData).forEach((key) => {
        if (
          orgData[key as keyof ProcessedOrganizationData] === "" ||
          orgData[key as keyof ProcessedOrganizationData] === "N/A"
        ) {
          (orgData as any)[key] = null;
        }
      });

      // Store the organization data (this will overwrite if same Partner ID appears multiple times)
      organizationsByPartnerId.set(partnerId, orgData);

      // Extract and store stove IDs for this Partner ID
      const stoveIdsString = row["Stove IDs"]?.trim();
      if (stoveIdsString && stoveIdsString !== "N/A" && stoveIdsString !== "") {
        const stoveIds = stoveIdsString
          .split(",")
          .map((id: string) => id.trim())
          .filter((id: string) => id && id !== "N/A");

        if (stoveIds.length > 0) {
          // Merge with existing stove IDs for this partner (in case of multiple rows)
          const existingStoveIds = stoveIdsByPartnerId.get(partnerId) || [];
          const allStoveIds = [...existingStoveIds, ...stoveIds];
          // Remove duplicates using Set
          const uniqueStoveIds = [...new Set(allStoveIds)];
          stoveIdsByPartnerId.set(partnerId, uniqueStoveIds);
        }
      }
    } catch (error: any) {
      results.errors.push({
        row_data: row,
        error: error.message,
        type: "processing_error",
      });
    }
  }

  console.log(
    `🔍 Found ${organizationsByPartnerId.size} unique organizations to process`
  );
  console.log(
    `🏷️ Found stove IDs for ${stoveIdsByPartnerId.size} organizations`
  );

  // Process each unique organization
  for (const [partnerId, orgData] of organizationsByPartnerId) {
    try {
      let organizationId: string;
      let organizationResult: any;

      // Check if organization with this Partner ID already exists
      const { data: existingOrg, error: fetchError } = await supabase
        .from("organizations")
        .select("*")
        .eq("partner_id", partnerId)
        .single();

      if (fetchError && fetchError.code !== "PGRST116") {
        // Some other error occurred
        results.errors.push({
          partner_id: partnerId,
          error: `Database error: ${fetchError.message}`,
          type: "database_error",
        });
        continue;
      }

      if (existingOrg) {
        // Organization exists - update it
        console.log(
          `📝 Updating existing organization with Partner ID: ${partnerId}`
        );

        organizationResult = await updateExistingOrganization(
          supabase,
          existingOrg.id,
          orgData,
          userId
        );

        organizationId = existingOrg.id;
        results.updated.push(organizationResult);
        results.summary.organizations_updated++;
      } else {
        // Organization doesn't exist - create it
        console.log(
          `➕ Creating new organization with Partner ID: ${partnerId}`
        );

        organizationResult = await createNewOrganizationFromCSV(
          supabase,
          orgData,
          userId
        );

        organizationId = organizationResult.organization.id;
        results.created.push(organizationResult);
        results.summary.organizations_created++;
      }

      // Process stove IDs for this organization
      const stoveIds = stoveIdsByPartnerId.get(partnerId);
      if (stoveIds && stoveIds.length > 0) {
        console.log(
          `🏷️ Processing ${stoveIds.length} stove IDs for Partner ID: ${partnerId}`
        );

        const stoveIdResult = await processStoveIdsForOrganization(
          supabase,
          organizationId,
          stoveIds,
          partnerId
        );

        // Update results with stove ID processing info
        results.stove_ids.imported += stoveIdResult.imported;
        results.stove_ids.skipped += stoveIdResult.skipped;
        results.stove_ids.errors.push(...stoveIdResult.errors);

        // Add stove ID info to the organization result
        if (organizationResult) {
          organizationResult.stove_ids = stoveIdResult;
        }
      }
    } catch (error: any) {
      console.error(
        `❌ Error processing Partner ID ${partnerId}:`,
        error.message
      );
      results.errors.push({
        partner_id: partnerId,
        organization_data: orgData,
        error: error.message,
        type: "processing_error",
      });
      results.summary.errors_count++;
    }
  }

  // Final summary
  results.summary.errors_count = results.errors.length;
  results.summary.stove_ids_imported = results.stove_ids.imported;
  results.summary.stove_ids_skipped = results.stove_ids.skipped;

  console.log(`✅ CSV Import completed:`, results.summary);

  return {
    message: "CSV import completed with organizations and stove IDs",
    data: results,
  };
}

async function updateExistingOrganization(
  supabase: any,
  organizationId: string,
  orgData: ProcessedOrganizationData,
  userId: string
) {
  // Validate the update data
  const validation = validateOrganizationData(orgData, "update");
  if (!validation.isValid) {
    throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
  }

  // Prepare organization update data
  const updateData = {
    partner_name: orgData.partner_name,
    branch: orgData.branch,
    state: orgData.state,
    contact_person: orgData.contact_person,
    contact_phone: orgData.contact_phone,
    alternative_phone: orgData.alternative_phone,
    email: orgData.email,
    address: orgData.address,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  // Update the organization
  const { data: updatedOrganization, error: updateError } = await supabase
    .from("organizations")
    .update(updateData)
    .eq("id", organizationId)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to update organization: ${updateError.message}`);
  }

  return {
    action: "updated",
    organization: updatedOrganization,
    partner_id: orgData.partner_id,
  };
}

async function createNewOrganizationFromCSV(
  supabase: any,
  orgData: ProcessedOrganizationData,
  userId: string
) {
  // Validate the organization data
  const validation = validateOrganizationData(orgData, "create");
  if (!validation.isValid) {
    throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
  }

  // Generate organization ID
  const organizationId = crypto.randomUUID();

  // Prepare organization data for creation
  const organizationData = {
    id: organizationId,
    partner_id: orgData.partner_id, // The global ID from CSV
    partner_name: orgData.partner_name,
    branch: orgData.branch,
    state: orgData.state,
    contact_person: orgData.contact_person,
    contact_phone: orgData.contact_phone,
    alternative_phone: orgData.alternative_phone,
    email: orgData.email,
    address: orgData.address,
    created_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Create the organization
  const { data: newOrganization, error: orgError } = await supabase
    .from("organizations")
    .insert([organizationData])
    .select()
    .single();

  if (orgError) {
    throw new Error(`Failed to create organization: ${orgError.message}`);
  }

  // Auto-generate admin user details from organization data
  const adminEmail =
    orgData.email ||
    `${orgData.partner_name
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9]/g, "")}@admin.com`;
  const adminFullName = `${orgData.partner_name} Admin`;

  let adminUser: any = null;
  let emailSent = false;

  try {
    // Check if admin email already exists in auth
    const { data: existingUsers, error: userCheckError } =
      await supabase.auth.admin.listUsers();

    if (!userCheckError) {
      const emailExists = existingUsers.users.some(
        (user: any) => user.email === adminEmail
      );

      if (!emailExists) {
        // Generate secure password
        const generatedPassword = generateSecurePassword();
        console.log(
          `🔑 Generated secure password for admin user: ${adminEmail}`
        );

        // Create admin user in Supabase Auth
        adminUser = await createUserInAuth(
          supabase,
          {
            email: adminEmail,
            fullName: adminFullName,
            organizationId: organizationId,
            role: "admin",
          },
          generatedPassword
        );

        console.log(`✅ Admin user created: ${adminUser.userId}`);

        // Send welcome email
        const emailResult = await sendWelcomeEmail(
          orgData.partner_name,
          adminEmail,
          generatedPassword,
          adminFullName
        );

        if (emailResult.status) {
          emailSent = true;
          console.log("✅ Welcome email sent successfully");
        } else {
          console.warn("⚠️ Failed to send welcome email:", emailResult.error);
        }
      } else {
        console.log(
          `⚠️ Admin email ${adminEmail} already exists, skipping user creation`
        );
      }
    }
  } catch (error: any) {
    console.warn("⚠️ Failed to create admin user:", error.message);
    // Don't fail the organization creation if user creation fails
  }

  return {
    action: "created",
    organization: newOrganization,
    partner_id: orgData.partner_id,
    admin_user: adminUser
      ? {
          id: adminUser.userId,
          email: adminEmail,
          full_name: adminFullName,
          role: "admin",
          password_sent: emailSent,
        }
      : null,
  };
}

async function processStoveIdsForOrganization(
  supabase: any,
  organizationId: string,
  stoveIds: string[],
  partnerId: string
): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
}> {
  console.log(
    `🏷️ Processing stove IDs for organization ${organizationId}:`,
    stoveIds.length,
    "stove IDs"
  );

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const stoveId of stoveIds) {
    try {
      const { error } = await supabase.from("stove_ids").insert([
        {
          stove_id: stoveId,
          organization_id: organizationId,
          status: "available",
        },
      ]);

      if (error) {
        if (error.code === "23505") {
          // Unique constraint violation - stove ID already exists
          skipped++;
          console.log(
            `⚠️ Stove ID ${stoveId} already exists, skipped`
          );
        } else {
          errors.push(`Partner ID ${partnerId}, Stove ID ${stoveId}: ${error.message}`);
          console.error(
            `❌ Failed to insert stove ID ${stoveId}:`,
            error.message
          );
        }
      } else {
        imported++;
        console.log(`✅ Imported stove ID: ${stoveId}`);
      }
    } catch (error: any) {
      errors.push(`Partner ID ${partnerId}, Stove ID ${stoveId}: ${error.message}`);
      console.error(
        `❌ Error processing stove ID ${stoveId}:`,
        error.message
      );
    }
  }

  console.log(
    `🏷️ Stove IDs processing completed for Partner ID ${partnerId}: ${imported} imported, ${skipped} skipped, ${errors.length} errors`
  );

  return { imported, skipped, errors };
}

export function validateCSVData(csvData: any[]): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!Array.isArray(csvData)) {
    return { isValid: false, errors: ["CSV data must be an array"] };
  }

  if (csvData.length === 0) {
    return { isValid: false, errors: ["CSV data cannot be empty"] };
  }

  // Check if required columns exist in the first row
  const requiredColumns = [
    "Sales Reference",
    "Customer",
    "State",
    "Branch",
    "Partner ID",
    "Stove IDs", // Added Stove IDs as expected column
  ];

  const firstRow = csvData[0];
  const missingColumns = requiredColumns.filter((col) => !(col in firstRow));

  if (missingColumns.length > 0) {
    errors.push(`Missing required columns: ${missingColumns.join(", ")}`);
  }

  // Check for rows without Partner ID
  const rowsWithoutPartnerId = csvData.filter(
    (row, index) =>
      !row["Partner ID"] || row["Partner ID"].toString().trim() === ""
  );

  if (rowsWithoutPartnerId.length > 0) {
    errors.push(`${rowsWithoutPartnerId.length} rows missing Partner ID`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
