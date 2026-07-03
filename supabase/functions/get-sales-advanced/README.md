# Sales API - Modular Edge Function

This edge function has been refactored into smaller, focused modules for better maintainability and debugging.

## 📁 File Structure

```
get-sales-advanced/
├── index.ts                 # Main entry point - orchestrates all modules
├── auth/
│   └── authenticate.ts      # User authentication and role checking
├── filters/
│   └── parse-filters.ts     # Request filter parsing and validation
├── query/
│   └── build-query.ts      # Database query building and execution
├── data/
│   └── fetch-related.ts    # Fetching related data (organizations, addresses, etc.)
├── utils/
│   ├── cors.ts             # CORS handling utilities
│   └── export.ts           # CSV export functionality
└── response/
    └── builder.ts          # Response formatting and building
```

## 🔄 Flow

1. **index.ts** - Main orchestrator

   - Handles CORS preflight
   - Initializes Supabase client
   - Calls all other modules in sequence
   - Returns final response

2. **authenticate.ts** - Authentication

   - Validates JWT token
   - Fetches user profile
   - Fallback to email-based super admin check
   - Returns user role and organization

3. **parse-filters.ts** - Filter parsing

   - Parses JSON/URL parameters
   - Validates filter types
   - Returns structured filter object

4. **build-query.ts** - Query building

   - Tests table access
   - Builds SELECT fields
   - Applies all filters (date, location, stove, etc.)
   - Handles sorting and pagination
   - Executes main sales query

5. **fetch-related.ts** - Related data

   - Fetches organizations separately
   - Fetches addresses separately
   - Fetches creators (profiles) separately
   - Fetches images separately
   - Attaches all related data to sales records

6. **export.ts** - Export handling
   - Prepares data for export
   - Converts to CSV format
   - Handles field selection

## 🐛 Debugging

Each module has focused logging with emojis:

- 🚀 Main flow
- 🔐 Authentication
- 📋 Filter parsing
- 🔍 Query building
- 🔗 Related data fetching
- 📤 Export handling
- ❌ Errors

## 🛠️ Benefits

1. **Easier debugging** - Each module can be tested independently
2. **Better organization** - Related code is grouped together
3. **Reusability** - Modules can be reused in other edge functions
4. **Maintainability** - Changes are isolated to specific modules
5. **Clearer errors** - Module-specific error messages

## 🧪 Testing

To test individual modules:

1. Check authentication: Look for 🔐 logs
2. Check filters: Look for 📋 logs
3. Check query: Look for 🔍 logs
4. Check related data: Look for 🔗 logs

## 🚀 Current Status

- ✅ Modular structure implemented
- ✅ Authentication with email fallback
- ✅ Separate related data fetching (avoiding RLS issues)
- ✅ Export functionality
- ⏳ RLS policies need to be applied in Supabase dashboard

## 📝 Next Steps

1. Run the RLS policy SQL scripts in Supabase dashboard
2. Test the API with sample data
3. Debug any remaining RLS issues module by module
