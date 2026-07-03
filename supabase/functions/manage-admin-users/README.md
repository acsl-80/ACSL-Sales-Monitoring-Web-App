# Manage Admin Users Edge Function

## Overview

A comprehensive Supabase Edge Function for super admins to manage admin users within the organization. This function provides full CRUD operations with proper authentication, validation, and organization binding.

## Features

- ✅ **Create Admin Users**: Create new admin users and tie them to organizations
- ✅ **Read Operations**: Get single admin user or list all with pagination and filtering
- ✅ **Update Operations**: Update admin user details and organization assignments
- ✅ **Delete Operations**: Remove admin users with dependency warnings
- ✅ **Super Admin Only**: Strict role-based access control
- ✅ **Organization Binding**: Admin users are tied to specific organizations via foreign key
- ✅ **Input Validation**: Comprehensive validation for all inputs
- ✅ **Error Handling**: Proper error responses with meaningful messages
- ✅ **Performance Monitoring**: Response time tracking and logging
- ✅ **CORS Support**: Cross-origin request handling

## File Structure

```
manage-admin-users/
├── index.ts                # Main entry point and request handler
├── authenticate.ts         # Super admin authentication logic
├── cors.ts                # CORS handling utilities
├── route-handler.ts       # HTTP method routing
├── read-operations.ts     # GET operations (fetch admin users)
├── write-operations.ts    # POST/PUT operations (create/update admin users)
├── delete-operations.ts   # DELETE operations (remove admin users)
├── validate.ts           # Input validation logic
├── API_DOCUMENTATION.md  # Complete API documentation
├── DEPLOYMENT-GUIDE.md   # Deployment instructions
└── README.md            # This file
```

## Quick Start

### 1. Deploy

```bash
supabase functions deploy manage-admin-users
```

### 2. Test

```bash
curl -X GET "https://YOUR_PROJECT.supabase.co/functions/v1/manage-admin-users" \
  -H "Authorization: Bearer YOUR_SUPER_ADMIN_TOKEN"
```

### 3. Create Admin User

```bash
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/manage-admin-users" \
  -H "Authorization: Bearer YOUR_SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "John Doe",
    "email": "john.doe@example.com",
    "organization_id": "your-org-uuid"
  }'
```

## API Operations

| Method   | Endpoint                   | Description                          | Auth Required |
| -------- | -------------------------- | ------------------------------------ | ------------- |
| `GET`    | `/manage-admin-users`      | List all admin users with pagination | Super Admin   |
| `GET`    | `/manage-admin-users/{id}` | Get specific admin user              | Super Admin   |
| `POST`   | `/manage-admin-users`      | Create new admin user                | Super Admin   |
| `PUT`    | `/manage-admin-users/{id}` | Update admin user                    | Super Admin   |
| `DELETE` | `/manage-admin-users/{id}` | Delete admin user                    | Super Admin   |

## Authorization

**Required Role**: `super_admin`

The function validates that the requesting user has the `super_admin` role before allowing any operations. This ensures that only authorized personnel can manage admin users.

## Organization Binding

Admin users are tied to organizations through the `organization_id` foreign key. Key behaviors:

- ✅ Organization must exist and be active
- ✅ Admin users inherit organization context
- ✅ Organization details included in responses
- ✅ Validation ensures organization exists before assignment

## Input Validation

### Create Admin User

- `full_name`: Required, string, max 100 chars, letters/spaces/hyphens/apostrophes only
- `email`: Required, valid email format, unique, max 255 chars
- `organization_id`: Required, valid UUID, must reference existing active organization
- `password`: Optional, min 8 chars, must contain uppercase/lowercase/number

### Update Admin User

- All fields optional
- Same validation rules as create
- Cannot update password (use separate endpoint)

## Error Handling

The function provides comprehensive error handling with appropriate HTTP status codes:

- `400`: Validation errors
- `403`: Unauthorized (not super admin)
- `404`: Resource not found
- `408`: Request timeout
- `500`: Internal server error

## Performance Features

- ⚡ 30-second request timeout
- ⚡ Response time tracking
- ⚡ Optimized database queries
- ⚡ Pagination for large datasets
- ⚡ Proper database indexing

## Security Features

- 🔒 JWT token validation
- 🔒 Role-based access control
- 🔒 Input sanitization
- 🔒 SQL injection prevention
- 🔒 CORS protection
- 🔒 Password strength requirements

## Database Dependencies

### Required Tables

- `profiles`: User profiles with role and organization binding
- `organizations`: Organization master data

### Required Columns

- `profiles.role`: Must support 'super_admin', 'admin', 'agent'
- `profiles.organization_id`: Foreign key to organizations table
- `organizations.status`: Must support 'active', 'inactive', 'suspended'

## Usage Examples

### List Admin Users with Filtering

```javascript
const response = await fetch(
  `${baseUrl}/manage-admin-users?organization_id=${orgId}&page=1&limit=10`,
  {
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
    },
  }
);
```

### Create Admin User

```javascript
const response = await fetch(`${baseUrl}/manage-admin-users`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${superAdminToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    full_name: "Jane Smith",
    email: "jane.smith@acme.com",
    organization_id: "org-uuid-here",
  }),
});
```

### Update Admin User

```javascript
const response = await fetch(`${baseUrl}/manage-admin-users/${userId}`, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${superAdminToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    full_name: "Jane Johnson",
    organization_id: "new-org-uuid",
  }),
});
```

## Monitoring

### Logs

```bash
# View function logs
supabase functions logs manage-admin-users

# Follow logs in real-time
supabase functions logs manage-admin-users --follow
```

### Metrics

- Response time (included in each response)
- Success/error rates
- Request volume
- Operation types

## Related Functions

This function works in conjunction with:

- `manage-organizations`: Organization management
- `get-user-profile`: User profile retrieval
- `create-agent`: Agent user creation (for admins)

## Contributing

When modifying this function:

1. Follow the established file structure
2. Maintain comprehensive validation
3. Include proper error handling
4. Update documentation
5. Test all operations
6. Verify security measures

## Troubleshooting

### Common Issues

**Authentication Failed**

- Verify JWT token is valid
- Check user exists with super_admin role
- Ensure proper Authorization header format

**Validation Errors**

- Check required fields are provided
- Verify data types and formats
- Ensure organization_id references valid organization

**Database Errors**

- Verify table structure matches requirements
- Check RLS policies allow super admin access
- Ensure proper indexes exist

### Debug Mode

Add debug logging by setting environment variable:

```bash
DEBUG=true
```

## Version Information

- **Current Version**: 1.0.0
- **Supabase Functions**: v1
- **Node Runtime**: Deno
- **Dependencies**: @supabase/supabase-js@2

## License

This function is part of the Stove Transaction App project and follows the project's licensing terms.
