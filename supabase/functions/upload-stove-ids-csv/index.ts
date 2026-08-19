
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { parse } from "https://esm.sh/csv-parse@5.5.4/sync";

function withCors(res: Response) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return res;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", { status: 200 }));
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const organizationId = formData.get("organization_id") as string;

  if (!file || !organizationId) {
    return withCors(new Response(
      JSON.stringify({
        success: false,
        message: "Missing file or organization_id",
      }),
      { status: 400 }
    ));
  }

  const csvText = await file.text();

  let records;
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
    });
  } catch (e) {
    return withCors(new Response(
      JSON.stringify({
        success: false,
        message: "CSV parsing failed",
        error: e.message,
      }),
      { status: 400 }
    ));
  }

  const stoveIdSet = new Set<string>();
  for (const row of records) {
    if (row["Stove IDs"]) {
      row["Stove IDs"]
        .split(",")
        .map((id: string) => id.trim())
        .forEach((id: string) => {
          if (id) stoveIdSet.add(id);
        });
    }
  }

  let imported = 0;
  let skipped = 0;
  let errors: string[] = [];

  for (const stoveId of stoveIdSet) {
    const { error } = await supabase.from("stove_ids").insert([
      {
        stove_id: stoveId,
        organization_id: organizationId,
        status: "available",
      },
    ]);
    if (error) {
      if (error.code === "23505") {
        skipped++;
      } else {
        errors.push(`Stove ID ${stoveId}: ${error.message}`);
      }
    } else {
      imported++;
    }
  }

  return withCors(new Response(
    JSON.stringify({
      success: true,
      imported,
      skipped,
      errors,
      message: `Imported: ${imported}, Skipped (duplicates): ${skipped}`,
    }),
    { status: 200 }
  ));
});
