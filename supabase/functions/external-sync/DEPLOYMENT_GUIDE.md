# External Sync API Deployment Guide

## Prerequisites

1. **Supabase CLI installed** and authenticated
2. **Database setup** with external_app_tokens table
3. **Edge Functions enabled** on your Supabase project

## Deployment Steps

### 1. Set Up Database

First, run the SQL script to set up the token management system:

```sql
-- Run this in your Supabase SQL Editor
-- File: supabase_codes/sql_queries/setup-external-app-tokens.sql
```

This will:

- Insert a test token for development
- Create functions for token management
- Set up proper security policies

### 2. Deploy Edge Functions

Deploy both external sync functions:

```bash
# Deploy single organization sync
supabase functions deploy external-sync

# Deploy CSV bulk sync
supabase functions deploy external-csv-sync
```

### 3. Set Environment Variables

Ensure your Supabase project has the required environment variables:

- `SUPABASE_URL` (automatically available)
- `SUPABASE_SERVICE_ROLE_KEY` (automatically available)

### 4. Generate Production Tokens

Replace the test token with production tokens:

```sql
-- First, run the setup script if you haven't already
-- File: supabase_codes/sql_queries/setup-external-app-tokens.sql

-- Generate a new token for your external application
SELECT * FROM generate_external_app_token(
    'Your Production App',
    'Production application for syncing organization data',
    ARRAY['your-production-domain.com', 'your-staging-domain.com']
);

-- Deactivate the test token
SELECT revoke_external_app_token('test-token-12345');
```

### 5. Test the Deployment

1. **Import the Postman collection**: `External_Sync_API_Postman_Collection.json`
2. **Update variables** with your production credentials
3. **Test all endpoints** to ensure they work correctly

### 6. Monitor Usage

Use this query to monitor API usage:

```sql
-- View token usage statistics
SELECT * FROM list_external_app_tokens();
```

## API Endpoints

Once deployed, your APIs will be available at:

- **Single Sync**: `https://your-project-id.supabase.co/functions/v1/external-sync`
- **CSV Sync**: `https://your-project-id.supabase.co/functions/v1/external-csv-sync`

## Security Considerations

1. **Token Management**: Regularly rotate tokens for production applications
2. **URL Restrictions**: Always specify allowed URLs for production tokens
3. **Monitoring**: Set up alerts for unusual usage patterns
4. **Rate Limiting**: Consider implementing rate limiting if needed

## Troubleshooting

### Function Not Found

- Ensure functions are deployed: `supabase functions list`
- Check function logs: `supabase functions logs external-sync`

### Authentication Errors

- Verify environment variables are set
- Check token validity in database
- Ensure URL restrictions are properly configured

### Database Errors

- Verify external_app_tokens table exists
- Check RLS policies are properly set
- Ensure service role has necessary permissions
