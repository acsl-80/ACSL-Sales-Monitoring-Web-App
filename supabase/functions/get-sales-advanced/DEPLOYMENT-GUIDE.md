# Flattened Files for Supabase Dashboard

Since Supabase dashboard doesn't support folders, here are all the files you need to create manually in your edge function:

## 📁 Files to Create in Supabase Dashboard

### 1. `index.ts` (Main file)

- Copy content from: `get-sales-advanced/index.ts`
- This is the main entry point

### 2. `authenticate.ts`

- Copy content from: `get-sales-advanced/authenticate.ts`
- Handles user authentication and role checking

### 3. `cors.ts`

- Copy content from: `get-sales-advanced/cors.ts`
- CORS handling utilities

### 4. `parse-filters.ts`

- Copy content from: `get-sales-advanced/parse-filters.ts`
- Request filter parsing

### 5. `build-query.ts`

- Copy content from: `get-sales-advanced/build-query.ts`
- Database query building and execution

### 6. `fetch-related.ts`

- Copy content from: `get-sales-advanced/fetch-related.ts`
- Fetching related data separately

### 7. `export.ts`

- Copy content from: `get-sales-advanced/export.ts`
- CSV export functionality

## 🚀 Steps to Deploy

1. **Create new edge function** in Supabase dashboard called `get-sales-advanced`

2. **Copy each file** above into separate files in the dashboard:

   - Create `index.ts` with the main content
   - Create `authenticate.ts` with authentication content
   - Create `cors.ts` with CORS content
   - And so on...

3. **All imports are now relative to root** (e.g., `./authenticate.ts`, `./cors.ts`)

4. **Deploy the function**

5. **Configure Environment Variables**:

   - Ensure `SUPABASE_SERVICE_ROLE_KEY` is set in your Supabase project settings
   - The function uses service role key to bypass RLS policies for admin operations

6. **Fix RLS Policy (REQUIRED)**:
   Your logs show that addresses and creators are not being fetched due to RLS policy issues.

   **Run this SQL to fix all table access issues:**

   ```sql
   -- Add service role policies for all tables used by the edge function

   -- Profiles table (for creators)
   DROP POLICY IF EXISTS "service_role_access" ON "public"."profiles";
   CREATE POLICY "service_role_access" ON "public"."profiles"
   AS PERMISSIVE FOR ALL
   TO service_role
   USING (true)
   WITH CHECK (true);

   -- Addresses table
   DROP POLICY IF EXISTS "service_role_access" ON "public"."addresses";
   CREATE POLICY "service_role_access" ON "public"."addresses"
   AS PERMISSIVE FOR ALL
   TO service_role
   USING (true)
   WITH CHECK (true);

   -- Organizations table
   DROP POLICY IF EXISTS "service_role_access" ON "public"."organizations";
   CREATE POLICY "service_role_access" ON "public"."organizations"
   AS PERMISSIVE FOR ALL
   TO service_role
   USING (true)
   WITH CHECK (true);

   -- Sales table
   DROP POLICY IF EXISTS "service_role_access" ON "public"."sales";
   CREATE POLICY "service_role_access" ON "public"."sales"
   AS PERMISSIVE FOR ALL
   TO service_role
   USING (true)
   WITH CHECK (true);

   -- Uploads table
   DROP POLICY IF EXISTS "service_role_access" ON "public"."uploads";
   CREATE POLICY "service_role_access" ON "public"."uploads"
   AS PERMISSIVE FOR ALL
   TO service_role
   USING (true)
   WITH CHECK (true);
   ```

   **Note**: The updated fetch-related.ts now includes enhanced debugging to help identify any remaining issues.

   **IMPORTANT**: Make sure to copy the updated `fetch-related.ts` file to your Supabase dashboard - it includes fixes for address and creator fetching.

   **CACHE ISSUE NOTICE**: If you're getting cached responses, add cache-busting headers by updating the response in `index.ts` to include:

   ```typescript
   headers: {
     "Content-Type": "application/json",
     "Cache-Control": "no-cache, no-store, must-revalidate",
     "Pragma": "no-cache",
     "Expires": "0"
   }
   ```

   ```

   ```

7. **Test with your JSON payload**:

   **Important**: You need to include the Authorization header with a valid JWT token.

   **Header:**

   ```
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

   **Body:**

   ```json
   {
     "includeOrganization": true,
     "includeStoveImage": true,
     "includeAgreementImage": true,
     "includeAddress": true,
     "includeCreator": true,
     "limit": 5
   }
   ```

8. **How to get JWT token:**

   - Log in to your app with superadmin@mail.com
   - Get the JWT token from your app's authentication system
   - Use tools like Postman or curl to include the Authorization header

9. **Example curl command:**
   ```bash
   curl -X POST https://your-project.supabase.co/functions/v1/get-sales-advanced \
   -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE" \
   -H "Content-Type: application/json" \
   -d '{
     "includeOrganization": true,
     "includeImages": true,
     "limit": 5
   }'
   ```

## 🔧 Benefits of This Structure

- ✅ **No folders needed** - All files in root
- ✅ **Easy to debug** - Each module has focused logging
- ✅ **Easy to edit** - Find and fix issues in specific files
- ✅ **Modular** - Can test individual components
- ✅ **Clean imports** - Simple relative paths

## 🐛 Debugging

Each file logs with specific emojis:

- 🚀 Main flow (index.ts)
- 🔐 Authentication (authenticate.ts)
- 📋 Filter parsing (parse-filters.ts)
- 🔍 Query building (build-query.ts)
- 🔗 Related data (fetch-related.ts)
- 📤 Export (export.ts)

### 🚨 Common Issues

**1. Related data not fetching (addresses, creators, etc.)**

- **Problem**: You're not seeing logs like "📍 Fetching addresses separately..."
- **Solution**: You must explicitly request related data with include flags:
  ```json
  {
    "includeAddress": true, // ← Required for addresses
    "includeCreator": true, // ← Required for creators
    "includeOrganization": true, // ← Required for organizations
    "includeImages": true, // ← Required for images
    "limit": 5
  }
  ```
- **Note**: Basic payload like `{"limit": 5}` will only return sales records without related data

**UPDATE**: ✅ **Addresses, Organizations, and Images are now working!** Only creators still have RLS issues.

**2. Cached responses**

- **Problem**: Getting old filter values in response
- **Solution**: Edge function now includes cache-busting headers
- **Workaround**: Use completely different payload values for testing

**3. Creators not fetching - DATA INTEGRITY ISSUE IDENTIFIED**

- **Problem**: `� Do any match? false` - The `created_by` IDs in sales records don't exist in profiles table
- **Root Cause**: Foreign key references are broken - sales.created_by points to non-existent profiles.id values
- **Example**: Sales record has `created_by: "c4528607-5820-4d85-a1cc-1b2bc035efd4"` but this ID doesn't exist in profiles table
- **Solutions**:

  **Option A (Recommended): Add missing profiles**

  ```sql
  -- Insert missing creator profiles
  INSERT INTO profiles (id, full_name, email, role, created_at) VALUES
  ('c4528607-5820-4d85-a1cc-1b2bc035efd4', 'Missing Creator 1', 'creator1@example.com', 'agent', NOW()),
  ('4a47be86-a4fd-466b-ba8d-40370c25607b', 'Missing Creator 2', 'creator2@example.com', 'agent', NOW());
  ```

  **Option B: Update sales records to point to existing profiles**

  ```sql
  -- First, find existing profile IDs
  SELECT id, full_name, email FROM profiles LIMIT 5;

  -- Then update sales records to use existing profile IDs
  UPDATE sales SET created_by = 'existing-profile-id-here' WHERE created_by IN ('c4528607-5820-4d85-a1cc-1b2bc035efd4', '4a47be86-a4fd-466b-ba8d-40370c25607b');
  ```

Much easier to find issues now! 🎉

## ℹ️ Updated: Graceful Handling of Missing Users

**Creators showing as null (Normal behavior)**

- **Scenario**: `ℹ️ No creators found for the requested IDs - users may no longer exist`
- **Explanation**: Sales records may reference users who have been deleted from the system
- **Behavior**: The API gracefully returns `creator: null` for sales with non-existent users
- **This is normal**: Users can be deleted while their sales records remain for historical purposes
- **No action needed**: The system handles this scenario gracefully and returns data as expected
