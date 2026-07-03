# Agent Management Edge Function - Deployment Guide

This guide covers deploying and testing the modular agent management edge function.

## Prerequisites

1. **Supabase CLI** installed and authenticated
2. **Project Setup** with proper environment variables
3. **Database Schema** with profiles table and proper RLS policies

## Environment Variables Required

Ensure these are set in your Supabase project:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`

## Deployment Steps

### 1. Deploy the Function

```bash
# Navigate to your project root
cd path/to/your/supabase/project

# Deploy the manage-agents function
supabase functions deploy manage-agents

# Or deploy with environment variables
supabase functions deploy manage-agents --no-verify-jwt
```

### 2. Set Environment Variables (if not already set)

```bash
# Set required environment variables
supabase secrets set SUPABASE_URL=your_supabase_url
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
supabase secrets set SUPABASE_ANON_KEY=your_anon_key
```

### 3. Verify Deployment

```bash
# List deployed functions
supabase functions list

# Check function logs
supabase functions logs manage-agents
```

## Database Requirements

### Required Tables

The function expects these tables to exist:

#### 1. profiles table

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'agent')),
  organization_id UUID REFERENCES organizations(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2. organizations table (if not exists)

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3. sales table (for deletion checks)

```sql
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES profiles(id),
  -- other sales fields
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Required Indexes

```sql
-- Improve query performance
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_organization_role ON profiles(organization_id, role);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_sales_agent_id ON sales(agent_id);
```

### Row Level Security (RLS) Policies

The function uses service role key to bypass RLS, but ensure these policies exist:

```sql
-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Sample policies (adjust based on your needs)
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can view organization agents" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles admin_profile
      WHERE admin_profile.id = auth.uid()
      AND admin_profile.role IN ('admin', 'super_admin')
      AND (admin_profile.role = 'super_admin' OR admin_profile.organization_id = profiles.organization_id)
    )
  );
```

## Testing the Function

### 1. Test Authentication

```bash
# Get your JWT token first by logging in
curl -X POST 'https://your-project.supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: your_anon_key' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "your_password"
  }'
```

### 2. Test CRUD Operations

#### Create Agent

```bash
curl -X POST 'https://your-project.supabase.co/functions/v1/manage-agents' \
  -H 'Authorization: Bearer your_jwt_token' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "newagent@example.com",
    "password": "securepass123",
    "full_name": "New Agent",
    "phone": "+1234567890"
  }'
```

#### Get All Agents

```bash
curl -X GET 'https://your-project.supabase.co/functions/v1/manage-agents?page=1&limit=10' \
  -H 'Authorization: Bearer your_jwt_token'
```

#### Get Single Agent

```bash
curl -X GET 'https://your-project.supabase.co/functions/v1/manage-agents/agent-uuid' \
  -H 'Authorization: Bearer your_jwt_token'
```

#### Update Agent

```bash
curl -X PUT 'https://your-project.supabase.co/functions/v1/manage-agents/agent-uuid' \
  -H 'Authorization: Bearer your_jwt_token' \
  -H 'Content-Type: application/json' \
  -d '{
    "full_name": "Updated Agent Name",
    "phone": "+0987654321"
  }'
```

#### Delete Agent

```bash
curl -X DELETE 'https://your-project.supabase.co/functions/v1/manage-agents/agent-uuid' \
  -H 'Authorization: Bearer your_jwt_token'
```

## Troubleshooting

### Common Issues

#### 1. Function Not Found (404)

- Verify function is deployed: `supabase functions list`
- Check the URL path is correct
- Ensure project is linked: `supabase status`

#### 2. Authentication Errors (401)

- Verify JWT token is valid and not expired
- Check Authorization header format: `Bearer token`
- Ensure user exists in auth.users table

#### 3. Permission Errors (403)

- Check user role in profiles table
- Verify organization_id is set for admin users
- Ensure user has correct permissions

#### 4. Database Errors (500)

- Check function logs: `supabase functions logs manage-agents`
- Verify database schema matches requirements
- Check environment variables are set correctly

#### 5. Timeout Errors (408)

- Check database performance
- Verify network connectivity
- Consider adding indexes for better performance

### Debugging Commands

```bash
# View function logs in real-time
supabase functions logs manage-agents --follow

# Check function details
supabase functions list

# Test function locally
supabase functions serve manage-agents

# Check environment variables
supabase secrets list
```

## Migration from Single File

If migrating from the old `create-agent-user.ts` file:

1. **Backup existing function**:

   ```bash
   # Download current function
   supabase functions download create-agent-user
   ```

2. **Update client code** to use new endpoints:

   - Change `/create-agent-user` to `/manage-agents` (POST)
   - Add new endpoints for GET, PUT, DELETE operations

3. **Test thoroughly** before removing old function

4. **Remove old function** when confident:
   ```bash
   supabase functions delete create-agent-user
   ```

## Performance Optimization

1. **Database Indexes**: Ensure proper indexes are in place
2. **Pagination**: Use appropriate page sizes (default 10, max 100)
3. **Filtering**: Use search parameters to reduce data transfer
4. **Caching**: Consider implementing response caching for read operations

## Security Considerations

1. **Environment Variables**: Never commit secrets to version control
2. **JWT Validation**: Function validates JWT tokens properly
3. **Input Validation**: All inputs are validated before processing
4. **SQL Injection**: Using parameterized queries via Supabase client
5. **Rate Limiting**: Handled by Supabase Edge Functions platform

## Monitoring

Set up monitoring for:

- Function execution time
- Error rates
- Authentication failures
- Database query performance

Use Supabase dashboard and logs for monitoring function health and performance.
