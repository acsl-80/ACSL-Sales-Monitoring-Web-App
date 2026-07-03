# Organization + User Management Refactoring Summary

## Overview

The manage-organizations Supabase Edge Function has been completely refactored to implement a comprehensive organization and user management system. The new flow creates organizations along with their admin users, handles password generation, email notifications, and maintains proper data synchronization.

## Key Changes Made

### 1. New User Management Utilities (`user-utils.ts`)

**Features Added:**

- Secure password generation (12+ characters with mixed case, numbers, symbols)
- User creation in Supabase Auth with profile synchronization
- Welcome email sending via external API integration
- User update functionality with email/password changes
- User disabling for soft delete operations
- Organization admin user lookup functionality

**Functions:**

- `generateSecurePassword()` - Creates cryptographically secure passwords
- `createUserInAuth()` - Creates users in auth and profiles table
- `sendWelcomeEmail()` - Sends credentials via external email API
- `updateUserInAuth()` - Updates user email/password with sync
- `disableUser()` - Soft delete by disabling user access
- `findOrganizationAdmin()` - Locates organization's admin user

### 2. Enhanced Validation (`validate.ts`)

**New Validation Rules:**

- Organization name (required, max 100 chars)
- Partner email (required, unique, valid format)
- Admin full name (required, max 100 chars)
- Admin email (required, unique, valid format, different from partner email)
- All existing organization field validations maintained

**Validation Interface:**

```typescript
interface CreateOrganizationWithUserData {
  // Organization fields
  name: string;
  partner_email: string;
  // ... other org fields

  // Admin user fields
  admin_full_name: string;
  admin_email: string;
}
```

### 3. Refactored Write Operations (`write-operations.ts`)

**Create Organization Flow:**

1. Validate organization + admin user data
2. Check for existing organization names/emails
3. Check for existing admin user email
4. Generate secure random password
5. Create admin user in Supabase Auth
6. Send welcome email via external API
7. Create organization record (only after email success)
8. Return comprehensive response with org + user data
9. Cleanup on failure (rollback user creation)

**Update Organization Flow:**

- Support updating organization details
- Support updating admin user name/email
- Regenerate password and send email if admin email changes
- Maintain synchronization between auth.users and profiles tables

### 4. Enhanced Delete Operations (`delete-operations.ts`)

**Soft Delete (Default):**

- Sets organization status to 'deleted'
- Disables admin user (banned_until future date)
- Updates profile role to 'disabled'
- Preserves all data for audit/recovery

**Hard Delete (Optional):**

- Permanently removes organization record
- Permanently deletes admin user from auth
- Use with extreme caution (`?hard_delete=true`)

### 5. Updated Read Operations (`read-operations.ts`)

**Enhanced Queries:**

- Single organization fetch includes admin user data
- List organizations optionally includes admin users (default: true)
- Efficient batch loading of admin users
- Graceful fallback if admin user queries fail

**New Query Parameters:**

- `include_admin_users=true/false` - Control admin user data inclusion

### 6. Updated Route Handler (`route-handler.ts`)

**New Features:**

- Support for hard delete via query parameter
- Proper routing for enhanced CRUD operations
- Maintains backward compatibility where possible

### 7. Comprehensive API Documentation (`API_DOCUMENTATION.md`)

**Complete Rewrite Including:**

- New request/response formats with admin user data
- Email service configuration requirements
- Migration guide from old API version
- Enhanced error handling documentation
- Frontend integration examples (React/Flutter)
- Security and performance notes

## Required Configuration

### Environment Variables

```bash
EMAIL_API_URL=https://api.homestaq.com/api/send-email
ENVIRONMENT=production # or development
```

### Email Service Integration

- Simple Node.js microservice endpoint that handles all email logic internally
- Just pass user data as JSON: `{email, user_name, organization_name, password, type}`
- Must return `{success: true}` on successful email sending
- Organization creation fails if email sending fails (transactional safety)

## API Changes Summary

### Create Organization (POST)

**Before:**

```json
{
  "name": "Organization Name",
  "partner_email": "partner@org.com"
}
```

**After:**

```json
{
  "name": "Organization Name",
  "partner_email": "partner@org.com",
  "admin_full_name": "Admin Name",
  "admin_email": "admin@org.com"
}
```

### Response Structure

**Before:**

```json
{
  "success": true,
  "data": {
    /* organization */
  },
  "message": "Organization created successfully"
}
```

**After:**

```json
{
  "success": true,
  "data": {
    "organization": {
      /* organization */
    },
    "admin_user": {
      /* admin user */
    },
    "email_sent": true
  },
  "message": "Organization and admin user created successfully. Welcome email sent."
}
```

### Update Organization (PUT/PATCH)

**New Fields:**

- `admin_full_name` - Update admin user name
- `admin_email` - Update admin email (triggers password reset + email)

### Delete Organization (DELETE)

**New Query Parameter:**

- `?hard_delete=true` - Permanent deletion (use with caution)
- Default: Soft delete (status='deleted', user disabled)

### Get Organizations (GET)

**New Query Parameter:**

- `?include_admin_users=true/false` - Include admin user data (default: true)

## Data Flow

### Organization Creation

```
Request → Validation → Check Duplicates → Generate Password →
Create User → Send Email → Create Organization → Response
```

### Organization Update

```
Request → Validation → Find Admin User → Update User (if needed) →
Send Email (if email changed) → Update Organization → Response
```

### Organization Delete

```
Request → Find Admin User → Disable User → Update Org Status → Response
```

## Security Enhancements

1. **Transactional Safety** - User creation rolled back on organization creation failure
2. **Email Verification** - Organization only created after email confirmation
3. **Secure Passwords** - 12+ character passwords with complexity requirements
4. **Soft Delete Default** - Preserves data integrity and audit trails
5. **Unique Constraints** - Prevents duplicate emails across organizations and users
6. **Input Validation** - Comprehensive server-side validation for all fields

## Breaking Changes

1. **Required Fields** - Admin user fields now required for organization creation
2. **Response Structure** - Different response format with nested user data
3. **Error Types** - New error types for email service and user creation failures
4. **Configuration** - Email service environment variables now required

## Migration Checklist

- [ ] Update frontend to include admin_full_name and admin_email in create requests
- [ ] Handle new response structure with organization and admin_user objects
- [ ] Configure email service API endpoint and credentials
- [ ] Update error handling for new error types
- [ ] Test soft delete behavior vs old hard delete
- [ ] Update any hardcoded expectations about response format

## Files Modified

1. `user-utils.ts` - NEW: User management utilities
2. `validate.ts` - Enhanced validation for user data
3. `write-operations.ts` - Refactored create/update with user management
4. `delete-operations.ts` - Added soft delete and user disabling
5. `read-operations.ts` - Enhanced with admin user data
6. `route-handler.ts` - Updated routing for new operations
7. `API_DOCUMENTATION.md` - Complete rewrite with new API spec

The refactoring provides a robust, secure, and user-friendly system for managing organizations with their admin users while maintaining data integrity and providing proper audit trails.
