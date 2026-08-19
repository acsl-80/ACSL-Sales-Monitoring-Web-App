import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { authenticateUser } from "./authenticate.ts";
import { parseFilters } from "./parse-filters.ts";
import { buildQuery } from "./build-query.ts";
import { fetchRelatedData } from "./fetch-related.ts";
import { convertToCSV, prepareExportData } from "./export.ts";
serve(async (req)=>{
  console.log("🚀 Sales API started");
  console.log("📥 Request:", req.method, req.url);
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    console.log("✅ CORS preflight handled");
    return withCors(new Response("ok", {
      status: 200
    }));
  }
  try {
    // Smart timeout based on request complexity and network conditions
    const baseTimeout = 30000; // 30 seconds base
    const maxTimeout = 90000; // 90 seconds maximum
    // Calculate dynamic timeout based on filters
    const requestTimeout = calculateDynamicTimeout(req, baseTimeout, maxTimeout);
    console.log(`⏱️ Using ${requestTimeout / 1000}s timeout for this request`);
    const timeoutPromise = new Promise((_, reject)=>setTimeout(()=>reject(new Error('Request timeout - operation took too long')), requestTimeout));
    // Wrap the main logic in timeout
    const result = await Promise.race([
      executeMainLogic(req),
      timeoutPromise
    ]);
    return result;
  } catch (error) {
    console.error("❌ Edge function error:", error);
    // Enhanced error handling for network issues
    let errorMessage = "Internal server error";
    let statusCode = 500;
    if (error.message.includes('timeout')) {
      errorMessage = "Request timeout - please try with more specific filters or check your network connection";
      statusCode = 408;
    } else if (error.message.includes('network') || error.message.includes('connection')) {
      errorMessage = "Network connectivity issue - please check your internet connection and try again";
      statusCode = 503;
    } else if (error.message.includes('Database')) {
      errorMessage = "Database temporarily unavailable - please try again in a moment";
      statusCode = 503;
    }
    return withCors(new Response(JSON.stringify({
      success: false,
      message: errorMessage,
      error: error.message,
      timestamp: new Date().toISOString(),
      retryable: statusCode === 408 || statusCode === 503
    }), {
      status: statusCode
    }));
  }
});
async function executeMainLogic(req) {
  const startTime = Date.now(); // Track request time for network performance
  try {
    // Initialize Supabase client
    console.log("🔧 Initializing Supabase...");
    const authHeader = req.headers.get("Authorization");
    console.log("🔑 Auth header present:", !!authHeader);
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      global: {
        headers: {
          Authorization: authHeader ?? ""
        }
      }
    });
    // Authenticate user
    console.log("🔐 Authenticating user...");
    const { userRole, userId, userOrgId } = await authenticateUser(supabase);
    console.log(`✅ Authenticated as: ${userRole}`);
    // Parse request filters
    console.log("📋 Parsing filters...");
    const filters = await parseFilters(req);
    console.log(`✅ Parsed ${Object.keys(filters).length} filters`);
    // Enforce safety limits
    const MAX_LIMIT = 500;
    const safeLimit = Math.min(filters.limit || 100, MAX_LIMIT);
    filters.limit = safeLimit;
    console.log(`🛡️ Enforced safe limit: ${safeLimit}`);
    // Build and execute optimized query with joins
    console.log("🔍 Building optimized query with joins...");
    const { sales, totalRecords } = await buildQuery(supabase, filters, userRole, userOrgId);
    console.log(`✅ Found ${sales?.length || 0} sales records`);
    // Only fetch additional related data if specifically requested and not already included
    if (sales && sales.length > 0 && needsAdditionalFetching(filters)) {
      console.log("🔗 Fetching additional related data...");
      await fetchRelatedData(supabase, sales, filters);
      console.log("✅ Additional data attached");
    }
    // Handle export if requested
    if (filters.export && sales) {
      console.log("📤 Handling export...");
      const exportData = prepareExportData(sales, filters);
      if (filters.export === "csv") {
        console.log("📤 Converting to CSV...");
        const csv = convertToCSV(exportData);
        return withCors(new Response(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": "attachment; filename=sales-export.csv"
          }
        }));
      }
    }
    // Prepare response
    const limit = Math.min(filters.limit || 100, 1000);
    const responseTime = Date.now() - startTime;
    const response = {
      success: true,
      data: sales,
      pagination: {
        page: filters.page || 1,
        limit,
        offset: filters.offset || ((filters.page || 1) - 1) * limit,
        total: totalRecords || 0,
        totalPages: Math.ceil((totalRecords || 0) / limit)
      },
      filters: filters,
      timestamp: new Date().toISOString(),
      performance: {
        responseTime: `${responseTime}ms`,
        recordsPerSecond: Math.round((sales?.length || 0) / (responseTime / 1000)),
        networkQuality: responseTime < 2000 ? 'excellent' : responseTime < 5000 ? 'good' : responseTime < 10000 ? 'fair' : 'poor',
        recommendation: responseTime > 10000 ? 'Consider using more specific filters to improve performance' : 'Performance is within acceptable range'
      },
      debug: {
        totalRecordsInTable: totalRecords,
        queryResultCount: sales?.length || 0,
        userRole,
        userId
      }
    };
    console.log("📋 Response ready:", {
      success: response.success,
      records: response.debug.queryResultCount,
      total: response.debug.totalRecordsInTable,
      role: response.debug.userRole
    });
    return withCors(new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        "X-Total-Count": String(totalRecords || 0),
        "X-Response-Time": String(responseTime)
      }
    }));
  } catch (error) {
    console.error("❌ Edge function error:", error);
    return withCors(new Response(JSON.stringify({
      success: false,
      message: "Internal server error",
      error: error.message
    }), {
      status: 500
    }));
  }
}
// Helper function to determine if additional fetching is needed
function needsAdditionalFetching(filters) {
  // Only fetch additional data if specifically requested
  // and it's not already included in the main query
  return !!(filters.includeOrganization || filters.includeAddress || filters.includeCreator || filters.includeImages || filters.includeStoveImage || filters.includeAgreementImage);
}
// Calculate dynamic timeout based on request complexity
function calculateDynamicTimeout(req, baseTimeout, maxTimeout) {
  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    let timeout = baseTimeout;
    // Increase timeout based on request complexity
    const complexityFactors = [
      params.has('export'),
      params.has('includeAddress'),
      params.has('includeCreator'),
      params.has('includeImages'),
      params.has('search'),
      parseInt(params.get('limit') || '100') > 200,
      params.has('dateFrom') && params.has('dateTo')
    ];
    // Add 10 seconds for each complexity factor
    const complexityBonus = complexityFactors.filter(Boolean).length * 10000;
    timeout += complexityBonus;
    // For export requests, use maximum timeout
    if (params.has('export')) {
      timeout = maxTimeout;
    }
    // Never exceed max timeout
    return Math.min(timeout, maxTimeout);
  } catch (error) {
    console.log('⚠️ Error calculating timeout, using base:', error);
    return baseTimeout;
  }
}
