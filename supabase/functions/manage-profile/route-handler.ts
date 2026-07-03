// Route handler for manage-profile edge function
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withCors } from "./cors.ts";
import { getUserProfile } from "./read-operations.ts";
import { updateUserProfile } from "./update-operations.ts";

export async function handleRequest(
  req: Request,
  supabase: SupabaseClient,
  authenticatedUser: {
    id: string;
    email: string;
    role: string;
    username?: string;
    organization_id?: string;
  }
): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;

  console.log("📍 Route Handler - Processing request");
  console.log("🔗 URL:", url.href);
  console.log("🌐 Method:", method);
  console.log("👤 User:", authenticatedUser.email);

  try {
    // GET /manage-profile - Get user profile with organization details
    if (method === "GET" && url.pathname.endsWith("/manage-profile")) {
      console.log("📋 Route matched: GET /manage-profile");

      const result = await getUserProfile(
        supabase,
        authenticatedUser.id,
        authenticatedUser.role
      );

      if (!result.success) {
        return withCors(
          new Response(
            JSON.stringify({ success: false, error: result.error }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      return withCors(
        new Response(
          JSON.stringify({
            success: true,
            data: result.data,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    // PUT /manage-profile/update - Update profile (username, email, password)
    if (method === "PUT" && url.pathname.includes("/update")) {
      console.log("🔄 Route matched: PUT /manage-profile/update");

      const body = await req.json();

      // Validate required field: current_password
      if (!body.current_password) {
        return withCors(
          new Response(
            JSON.stringify({
              success: false,
              error: "Current password is required for verification",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      const result = await updateUserProfile(
        supabase,
        authenticatedUser.id,
        authenticatedUser.email,
        body
      );

      if (!result.success) {
        return withCors(
          new Response(
            JSON.stringify({ success: false, error: result.error }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      return withCors(
        new Response(
          JSON.stringify({
            success: true,
            message: result.message,
            updated_fields: result.updated_fields,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    // Route not found
    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          error: "Route not found",
          available_routes: [
            "GET /manage-profile - Get user profile and organization details",
            "PUT /manage-profile/update - Update username, email, and/or password",
          ],
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    );
  } catch (error) {
    console.error("Request handling error:", error);
    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          error: "Internal server error",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    );
  }
}
