# Deployment Guide - Manage Admin Users Edge Function

## Overview

This guide provides step-by-step instructions for deploying the `manage-admin-users` edge function to Supabase.

## Prerequisites

1. **Supabase CLI installed**

   ```bash
   npm install -g supabase
   ```

2. **Supabase project initialized**

   ```bash
   supabase init
   ```

3. **Authenticated with Supabase**

   ```bash
   supabase login
   ```

4. **Project linked to your Supabase instance**
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```

## Deployment Steps

### 1. Deploy the Edge Function

```bash
# Navigate to your project root
cd /path/to/your/project

# Deploy the edge function
supabase functions deploy manage-admin-users

# Or deploy with specific project reference
supabase functions deploy manage-admin-users --project-ref YOUR_PROJECT_REF
```

### 2. Set Environment Variables

Make sure your Supabase project has the following environment variables set:

```bash
# These are automatically available in Supabase Edge Functions
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. Verify Deployment

```bash
# Check function status
supabase functions list

# View function logs
supabase functions logs manage-admin-users

# Follow logs in real-time
supabase functions logs manage-admin-users --follow
```

## Testing the Deployment

### 1. Test with cURL

**Health Check (CORS preflight)**:

```bash
curl -X OPTIONS "https://YOUR_PROJECT_REF.supabase.co/functions/v1/manage-admin-users" \
  -H "Origin: http://localhost:3000" \
  -v
```

**Get Admin Users (requires super admin token)**:

```bash
curl -X GET "https://YOUR_PROJECT_REF.supabase.co/functions/v1/manage-admin-users" \
  -H "Authorization: Bearer YOUR_SUPER_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**Create Admin User**:

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/manage-admin-users" \
  -H "Authorization: Bearer YOUR_SUPER_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Test Admin",
    "email": "test.admin@example.com",
    "organization_id": "YOUR_ORGANIZATION_ID"
  }'
```

### 2. Test with Postman

Import the following collection for comprehensive testing:

```json
{
  "info": {
    "name": "Manage Admin Users API",
    "description": "Test collection for manage-admin-users edge function"
  },
  "variable": [
    {
      "key": "base_url",
      "value": "https://YOUR_PROJECT_REF.supabase.co/functions/v1/manage-admin-users"
    },
    {
      "key": "auth_token",
      "value": "YOUR_SUPER_ADMIN_JWT_TOKEN"
    }
  ],
  "item": [
    {
      "name": "Get All Admin Users",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{auth_token}}"
          }
        ],
        "url": "{{base_url}}"
      }
    },
    {
      "name": "Create Admin User",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{auth_token}}"
          },
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"full_name\": \"Test Admin\",\n  \"email\": \"test.admin@example.com\",\n  \"organization_id\": \"YOUR_ORGANIZATION_ID\"\n}"
        },
        "url": "{{base_url}}"
      }
    }
  ]
}
```

## Database Requirements

### Required Tables

Ensure the following tables exist with proper structure:

1. **profiles table**:

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'agent')),
  organization_id UUID REFERENCES organizations(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

2. **organizations table**:

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  partner_email TEXT NOT NULL,
  contact_phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'Nigeria',
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Required Indexes

```sql
-- For performance optimization
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_organization_id ON profiles(organization_id);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_organizations_status ON organizations(status);
```

### Row Level Security (RLS)

```sql
-- Enable RLS on tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Policies for profiles table
CREATE POLICY "Super admins can manage all profiles" ON profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

-- Policies for organizations table
CREATE POLICY "Super admins can manage all organizations" ON organizations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );
```

## Monitoring and Maintenance

### 1. Function Logs

Monitor function execution:

```bash
# View recent logs
supabase functions logs manage-admin-users --limit 100

# Filter by error level
supabase functions logs manage-admin-users --level error

# Follow logs in real-time
supabase functions logs manage-admin-users --follow
```

### 2. Performance Monitoring

Key metrics to monitor:

- Response time (included in function response)
- Error rate
- Request volume
- Database query performance

### 3. Common Issues and Solutions

**Issue: Function timeout**

- Solution: Optimize database queries, add proper indexes
- Check: Response time in function logs

**Issue: Authentication errors**

- Solution: Verify JWT token and user role
- Check: User exists in profiles table with super_admin role

**Issue: Validation errors**

- Solution: Check request payload format
- Check: API documentation for required fields

**Issue: Database constraint violations**

- Solution: Verify organization exists and is active
- Check: Email uniqueness constraints

## Security Considerations

1. **Token Validation**: Ensure JWT tokens are properly validated
2. **Role Verification**: Only super_admin role can access this function
3. **Input Sanitization**: All inputs are validated and sanitized
4. **CORS Configuration**: Properly configured for your domain
5. **Rate Limiting**: Consider implementing rate limiting for production

## Rollback Procedures

If you need to rollback the deployment:

```bash
# Deploy previous version (if available)
supabase functions deploy manage-admin-users --project-ref YOUR_PROJECT_REF

# Or delete the function entirely
supabase functions delete manage-admin-users --project-ref YOUR_PROJECT_REF
```

## Production Checklist

- [ ] Function deployed successfully
- [ ] Environment variables configured
- [ ] Database tables and indexes created
- [ ] RLS policies implemented
- [ ] Function tested with valid JWT token
- [ ] Error scenarios tested
- [ ] Monitoring and logging configured
- [ ] Documentation updated
- [ ] Team notified of new endpoint

## Support

For issues or questions:

1. Check function logs: `supabase functions logs manage-admin-users`
2. Verify database schema and permissions
3. Test with Postman collection
4. Review API documentation for proper usage

## Version History

- **v1.0.0**: Initial deployment with full CRUD operations
- Supports: Create, Read, Update, Delete admin users
- Authentication: Super admin only
- Validation: Comprehensive input validation
- Features: Pagination, filtering, organization binding
