import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

// Simple log wrapper
function log(...args: any[]) {
  console.log("🖼️", ...args);
}

serve(async (req) => {
  log("➡️ Incoming request:", req.method, req.url);

  // Handle preflight (CORS)
  if (req.method === "OPTIONS") {
    log("🛑 Preflight request (OPTIONS)");
    return new Response("ok", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Method not allowed. Use GET.",
      }),
      {
        status: 405,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      }
    );
  }

  // Create Supabase client
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") ?? "",
        },
      },
    }
  );

  try {
    // Authenticate user
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData?.user) {
      log("❌ Unauthorized:", authError);
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized",
        }),
        {
          status: 401,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
        }
      );
    }

    const userId = userData.user.id;
    log("🔐 Authenticated user:", userId);

    // Extract serial number from URL query parameters
    const url = new URL(req.url);
    const serialNumber = url.searchParams.get("serial_number");
    const returnType = url.searchParams.get("return_type") || "binary"; // 'binary' or 'details'

    if (!serialNumber) {
      log("❌ Missing serial number parameter");
      return new Response(
        JSON.stringify({
          success: false,
          message: "Missing required parameter: serial_number",
        }),
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
        }
      );
    }

    log("🔍 Looking for agreement image with serial number:", serialNumber);
    log("📋 Return type:", returnType);

    // Query to get the sale and its agreement image details
    const { data: salesData, error: salesError } = await supabase
      .from("sales")
      .select(
        `
        id,
        stove_serial_no,
        agreement_image_id,
        sales_date,
        contact_person,
        end_user_name,
        partner_name,
        status,
        uploads:agreement_image_id (
          id,
          public_id,
          url,
          type,
          created_at
        )
      `
      )
      .eq("stove_serial_no", serialNumber)
      .not("agreement_image_id", "is", null);

    if (salesError) {
      log("❌ Database error:", salesError);
      return new Response(
        JSON.stringify({
          success: false,
          message: "Database error occurred",
          error: salesError.message,
        }),
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!salesData || salesData.length === 0) {
      log("❌ No agreement image found for serial number:", serialNumber);
      return new Response(
        JSON.stringify({
          success: false,
          message: `No agreement image found for serial number: ${serialNumber}`,
        }),
        {
          status: 404,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
        }
      );
    }

    const saleData = salesData[0];
    const uploadData = saleData.uploads;

    if (!uploadData) {
      log("❌ Agreement image data not found");
      return new Response(
        JSON.stringify({
          success: false,
          message: "Agreement image data not found",
        }),
        {
          status: 404,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
        }
      );
    }

    log("✅ Found agreement image:", uploadData.public_id);

    // If return_type is 'details', return metadata only
    if (returnType === "details") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Agreement image details retrieved successfully",
          data: {
            sale: {
              id: saleData.id,
              stove_serial_no: saleData.stove_serial_no,
              sales_date: saleData.sales_date,
              contact_person: saleData.contact_person,
              end_user_name: saleData.end_user_name,
              partner_name: saleData.partner_name,
              status: saleData.status,
            },
            image: {
              id: uploadData.id,
              public_id: uploadData.public_id,
              url: uploadData.url,
              type: uploadData.type,
              created_at: uploadData.created_at,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
        }
      );
    }

    // For 'binary' return type, fetch the actual image file
    // Extract the storage path from the URL
    const urlObj = new URL(uploadData.url);
    const pathParts = urlObj.pathname.split("/");
    const storagePath = pathParts
      .slice(pathParts.indexOf("images") + 1)
      .join("/");

    log("📁 Storage path:", storagePath);

    // Download the file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("images")
      .download(storagePath);

    if (downloadError || !fileData) {
      log("❌ File download error:", downloadError);
      return new Response(
        JSON.stringify({
          success: false,
          message: "Failed to download image file",
          error: downloadError?.message,
        }),
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
        }
      );
    }

    log("✅ Image file downloaded successfully");

    // Determine content type based on file extension or upload type
    let contentType = "application/octet-stream";
    if (uploadData.type && uploadData.type.includes("/")) {
      contentType = uploadData.type;
    } else {
      // Try to determine from file extension
      const extension = storagePath.split(".").pop()?.toLowerCase();
      switch (extension) {
        case "jpg":
        case "jpeg":
          contentType = "image/jpeg";
          break;
        case "png":
          contentType = "image/png";
          break;
        case "gif":
          contentType = "image/gif";
          break;
        case "webp":
          contentType = "image/webp";
          break;
        case "svg":
          contentType = "image/svg+xml";
          break;
        default:
          contentType = "application/octet-stream";
      }
    }

    // Return the binary file
    return new Response(fileData, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="agreement_${serialNumber}.${storagePath
          .split(".")
          .pop()}"`,
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        "X-Serial-Number": serialNumber,
        "X-Upload-ID": uploadData.public_id,
      },
    });
  } catch (error) {
    log("🔥 Unexpected error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Unexpected error occurred",
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      }
    );
  }
});
