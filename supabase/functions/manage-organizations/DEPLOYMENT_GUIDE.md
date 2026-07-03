# CSV Import Feature - Deployment Guide

## Prerequisites

Before deploying the CSV import feature, ensure you have:

1. **Supabase CLI** installed and configured
2. **Super admin access** to your Supabase project
3. **Database access** for running SQL scripts
4. **Email service** configured for welcome emails

## Deployment Steps

### Step 1: Database Schema Updates

Run the SQL script to update your organizations table:

```bash
# Option 1: Using Supabase Dashboard
# 1. Go to your Supabase Dashboard
# 2. Navigate to SQL Editor
# 3. Copy and paste the contents of add-partner-id-to-organizations.sql
# 4. Execute the script

# Option 2: Using Supabase CLI
supabase db reset --local  # For local development
# Or apply migrations for production
```

**SQL Script Location**: `add-partner-id-to-organizations.sql`

### Step 2: Verify Database Changes

Check that the organizations table has been updated:

```sql
-- Verify new columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'organizations'
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Verify unique index on partner_id
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'organizations'
AND indexname = 'organizations_partner_id_key';
```

Expected columns:

- `id` (uuid, primary key)
- `partner_id` (text, unique when not null)
- `partner_name` (text, required)
- `branch` (text, required)
- `state` (text, required)
- `contact_person` (text, optional)
- `contact_phone` (text, optional)
- `alternative_phone` (text, optional)
- `email` (text, optional)
- `address` (text, optional)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `created_by` (uuid, foreign key)
- `updated_by` (uuid, foreign key)

### Step 3: Deploy Edge Function

Deploy the updated manage-organizations edge function:

```bash
# Deploy to production
supabase functions deploy manage-organizations

# Or deploy to staging first
supabase functions deploy manage-organizations --project-ref YOUR_STAGING_PROJECT_REF
```

### Step 4: Test Deployment

#### 4.1 Basic Functionality Test

```bash
# Test existing functionality still works
curl -X GET "https://YOUR_PROJECT.supabase.co/functions/v1/manage-organizations" \
  -H "Authorization: Bearer YOUR_SUPER_ADMIN_TOKEN"
```

#### 4.2 CSV Import Test

```bash
# Test CSV import with sample data
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/manage-organizations?import_csv=true" \
  -H "Authorization: Bearer YOUR_SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "Sales Reference": "TR-TEST1",
      "Sales Date": "10/2/2025",
      "Customer": "Test Organization",
      "State": "Lagos",
      "Branch": "Test Branch",
      "Quantity": "10",
      "Downloaded by": "ACSL Admin",
      "Stove IDs": "101034734",
      "Sales Factory": "Lagos",
      "Sales Rep": "Test Rep",
      "Partner ID": "TEST001",
      "Partner Address": "123 Test Street",
      "Partner Contact Person": "John Doe",
      "Partner Contact Phone": "08012345678",
      "Partner Alternative Phone": "N/A",
      "Partner Email": "john@testorg.com"
    }
  ]'
```

Expected response:

```json
{
  "success": true,
  "message": "CSV import completed",
  "data": {
    "created": [
      {
        "action": "created",
        "organization": {...},
        "admin_user": {...}
      }
    ],
    "updated": [],
    "errors": [],
    "summary": {
      "total_rows": 1,
      "organizations_created": 1,
      "organizations_updated": 0,
      "errors_count": 0
    }
  }
}
```

### Step 5: Verify Admin User Creation

Check that admin users are created correctly:

```sql
-- Check that admin user was created
SELECT u.id, u.email, p.full_name, p.role, p.organization_id
FROM auth.users u
JOIN public.profiles p ON u.id = p.id
WHERE p.role = 'admin'
AND p.organization_id IN (
  SELECT id FROM public.organizations WHERE partner_id = 'TEST001'
);
```

### Step 6: Test Update Functionality

Test that updating existing organizations works:

```bash
# Run the same import again - should update the existing organization
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/manage-organizations?import_csv=true" \
  -H "Authorization: Bearer YOUR_SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "Sales Reference": "TR-TEST1-UPDATED",
      "Customer": "Test Organization UPDATED",
      "State": "Lagos",
      "Branch": "Updated Branch",
      "Partner ID": "TEST001",
      "Partner Address": "456 Updated Street",
      "Partner Contact Person": "Jane Doe",
      "Partner Contact Phone": "08087654321",
      "Partner Email": "jane@testorg.com"
    }
  ]'
```

Expected response should show 1 updated organization and 0 created.

## Environment Configuration

### Environment Variables

Ensure these environment variables are set in your Supabase project:

```bash
# Supabase Configuration
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Email Service Configuration (for welcome emails)
EMAIL_SERVICE_URL=your_email_service_endpoint
EMAIL_API_KEY=your_email_api_key
```

### Row Level Security (RLS) Policies

Verify that RLS policies are properly configured:

```sql
-- Check existing policies on organizations table
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'organizations';

-- If no policies exist, create basic ones
-- Super admin full access
CREATE POLICY "Super admin full access" ON public.organizations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- Organization admin access to their own org
CREATE POLICY "Organization admin access" ON public.organizations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
      AND profiles.organization_id = organizations.id
    )
  );
```

## Monitoring and Logging

### Enable Function Logs

Monitor edge function execution:

```bash
# View function logs
supabase functions logs manage-organizations

# View logs in real-time
supabase functions logs manage-organizations --follow
```

### Database Monitoring

Monitor database performance:

```sql
-- Check import performance
SELECT
  partner_id,
  partner_name,
  created_at,
  updated_at,
  created_by
FROM public.organizations
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Check for errors or orphaned records
SELECT count(*) as total_orgs FROM public.organizations;
SELECT count(*) as orgs_with_partner_id FROM public.organizations WHERE partner_id IS NOT NULL;
SELECT count(*) as duplicate_partner_ids FROM (
  SELECT partner_id, count(*)
  FROM public.organizations
  WHERE partner_id IS NOT NULL
  GROUP BY partner_id
  HAVING count(*) > 1
) duplicates;
```

## Troubleshooting

### Common Issues

#### 1. "Column doesn't exist" errors

**Solution**: Run the database migration script again

```bash
# Check if columns exist
\d public.organizations

# Re-run migration if needed
```

#### 2. "Unique constraint violation" on partner_id

**Solution**: Check for existing duplicate partner_ids

```sql
SELECT partner_id, count(*)
FROM public.organizations
WHERE partner_id IS NOT NULL
GROUP BY partner_id
HAVING count(*) > 1;
```

#### 3. "Super admin privileges required" error

**Solution**: Verify user role

```sql
SELECT id, email, role FROM public.profiles WHERE id = 'USER_ID';
```

#### 4. Admin user creation fails

**Solution**: Check email service configuration and existing users

```sql
-- Check for existing users with same email
SELECT email FROM auth.users WHERE email = 'admin@example.com';
```

#### 5. Function timeout on large imports

**Solution**:

- Reduce batch size (max 1000 rows)
- Split large imports into smaller chunks
- Check function timeout settings

### Performance Optimization

For large-scale deployments:

1. **Database Indexing**:

```sql
-- Additional indexes for performance
CREATE INDEX IF NOT EXISTS idx_organizations_partner_name ON public.organizations(partner_name);
CREATE INDEX IF NOT EXISTS idx_organizations_state ON public.organizations(state);
CREATE INDEX IF NOT EXISTS idx_organizations_created_at ON public.organizations(created_at);
```

2. **Function Configuration**:

- Increase memory allocation if needed
- Monitor execution time and optimize queries
- Consider async processing for very large imports

3. **Connection Pooling**:

- Configure connection pooling for high-volume imports
- Monitor database connection usage

## Rollback Plan

If issues occur, here's how to rollback:

### 1. Disable CSV Import

Comment out the CSV import route in `route-handler.ts`:

```typescript
// Temporarily disable CSV import
// if (url.searchParams.get("import_csv") === "true") {
//   console.log("📊 Processing CSV import request");
//   // ... CSV import code
// }
```

### 2. Database Rollback

If needed, remove the partner_id column:

```sql
-- Remove partner_id column (CAUTION: This will lose data)
ALTER TABLE public.organizations DROP COLUMN IF EXISTS partner_id;

-- Remove the unique index
DROP INDEX IF EXISTS organizations_partner_id_key;
```

### 3. Redeploy Function

```bash
supabase functions deploy manage-organizations
```

## Post-Deployment Checklist

- [ ] Database schema updated successfully
- [ ] Edge function deployed without errors
- [ ] Basic CRUD operations still work
- [ ] CSV import test completed successfully
- [ ] Admin user creation verified
- [ ] Email service working
- [ ] RLS policies configured
- [ ] Monitoring and logging enabled
- [ ] Performance benchmarks established
- [ ] Rollback plan tested
- [ ] Documentation updated
- [ ] Team trained on new functionality

## Support and Maintenance

### Regular Maintenance Tasks

1. **Weekly**:

   - Review import error logs
   - Check database performance metrics
   - Monitor email delivery rates

2. **Monthly**:

   - Clean up test data
   - Review and optimize queries
   - Update documentation as needed

3. **Quarterly**:
   - Performance optimization review
   - Security audit of import functionality
   - Backup and disaster recovery testing

### Getting Help

For issues with deployment:

1. Check function logs: `supabase functions logs manage-organizations`
2. Review database logs for constraint violations
3. Verify environment variables and permissions
4. Test with minimal sample data first
5. Check the validation tests in `validation-tests.ts`

Remember to always test in a staging environment before deploying to production!
