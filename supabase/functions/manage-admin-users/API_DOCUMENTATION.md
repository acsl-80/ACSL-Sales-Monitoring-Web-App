# Admin Users Management API

## Overview

This edge function provides a comprehensive API for super admins to manage admin users. It allows creating, reading, updating, and deleting admin users while enforcing proper authorization and validation.

## Authentication

- **Required Role**: `super_admin`
- **Authorization**: Bearer token in Authorization header
- **Access Control**: Only super admins can access this endpoint

## API Endpoints

### Base URL

```
https://your-project.supabase.co/functions/v1/manage-admin-users
```

## Operations

### 1. Create Admin User

**Endpoint**: `POST /manage-admin-users`

Creates a new admin user and ties them to an organization.

**Request Body**:

```json
{
  "full_name": "John Doe",
  "email": "john.doe@example.com",
  "organization_id": "123e4567-e89b-12d3-a456-426614174000",
  "password": "SecurePass123!" // Optional - auto-generated if not provided
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "user-uuid",
    "full_name": "John Doe",
    "email": "john.doe@example.com",
    "role": "admin",
    "organization_id": "123e4567-e89b-12d3-a456-426614174000",
    "created_at": "2025-09-02T10:00:00Z",
    "updated_at": "2025-09-02T10:00:00Z",
    "organizations": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "ACME Corporation",
      "partner_email": "partner@acme.com",
      "contact_phone": "+1234567890",
      "city": "New York",
      "state": "NY",
      "country": "USA",
      "status": "active"
    }
  },
  "message": "Admin user created successfully",
  "auth_user_id": "auth-user-uuid"
}
```

### 2. Get All Admin Users

**Endpoint**: `GET /manage-admin-users`

Retrieves all admin users with pagination and filtering options.

**Query Parameters**:

- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)
- `organization_id` (optional): Filter by organization ID
- `search` (optional): Search by name or email
- `status` (optional): Filter by status

**Example**: `GET /manage-admin-users?page=1&limit=10&organization_id=123e4567-e89b-12d3-a456-426614174000`

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "id": "user-uuid",
      "full_name": "John Doe",
      "email": "john.doe@example.com",
      "role": "admin",
      "organization_id": "123e4567-e89b-12d3-a456-426614174000",
      "created_at": "2025-09-02T10:00:00Z",
      "updated_at": "2025-09-02T10:00:00Z",
      "organizations": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "name": "ACME Corporation",
        "partner_email": "partner@acme.com",
        "contact_phone": "+1234567890",
        "city": "New York",
        "state": "NY",
        "country": "USA",
        "status": "active"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  },
  "message": "Admin users retrieved successfully"
}
```

### 3. Get Single Admin User

**Endpoint**: `GET /manage-admin-users/{user_id}`

Retrieves a specific admin user by ID.

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "user-uuid",
    "full_name": "John Doe",
    "email": "john.doe@example.com",
    "role": "admin",
    "organization_id": "123e4567-e89b-12d3-a456-426614174000",
    "created_at": "2025-09-02T10:00:00Z",
    "updated_at": "2025-09-02T10:00:00Z",
    "organizations": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "ACME Corporation",
      "partner_email": "partner@acme.com",
      "contact_phone": "+1234567890",
      "city": "New York",
      "state": "NY",
      "country": "USA",
      "status": "active"
    }
  },
  "message": "Admin user retrieved successfully"
}
```

### 4. Update Admin User

**Endpoint**: `PUT /manage-admin-users/{user_id}` or `PATCH /manage-admin-users/{user_id}`

Updates an existing admin user.

**Request Body** (all fields optional):

```json
{
  "full_name": "John Smith",
  "email": "john.smith@example.com",
  "organization_id": "456e7890-e89b-12d3-a456-426614174001"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "user-uuid",
    "full_name": "John Smith",
    "email": "john.smith@example.com",
    "role": "admin",
    "organization_id": "456e7890-e89b-12d3-a456-426614174001",
    "created_at": "2025-09-02T10:00:00Z",
    "updated_at": "2025-09-02T10:15:00Z",
    "organizations": {
      "id": "456e7890-e89b-12d3-a456-426614174001",
      "name": "New Organization",
      "partner_email": "partner@neworg.com",
      "contact_phone": "+0987654321",
      "city": "Los Angeles",
      "state": "CA",
      "country": "USA",
      "status": "active"
    }
  },
  "message": "Admin user updated successfully"
}
```

### 5. Delete Admin User

**Endpoint**: `DELETE /manage-admin-users/{user_id}`

Deletes an admin user (soft delete or hard delete based on configuration).

**Response**:

```json
{
  "success": true,
  "data": {
    "deleted_user_id": "user-uuid",
    "deleted_user_email": "john.doe@example.com",
    "deleted_user_name": "John Doe"
  },
  "message": "Admin user deleted successfully",
  "warnings": [
    "This admin has created sales records",
    "This admin's organization has agent users"
  ]
}
```

## Error Responses

### 400 Bad Request

```json
{
  "success": false,
  "message": "Validation failed: Full name is required, Email must be a valid email address",
  "error": "Validation failed: Full name is required, Email must be a valid email address",
  "timestamp": "2025-09-02T10:00:00Z"
}
```

### 403 Forbidden

```json
{
  "success": false,
  "message": "Access denied - Super admin privileges required",
  "error": "Unauthorized: Super admin privileges required",
  "timestamp": "2025-09-02T10:00:00Z"
}
```

### 404 Not Found

```json
{
  "success": false,
  "message": "Admin user with ID user-uuid not found",
  "error": "Admin user with ID user-uuid not found",
  "timestamp": "2025-09-02T10:00:00Z"
}
```

### 408 Request Timeout

```json
{
  "success": false,
  "message": "Request timeout - operation took too long",
  "error": "Request timeout - operation took too long",
  "timestamp": "2025-09-02T10:00:00Z"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "message": "Internal server error",
  "error": "Database connection failed",
  "timestamp": "2025-09-02T10:00:00Z"
}
```

## Validation Rules

### Full Name

- Required for creation
- Must be a string
- Cannot be empty
- Maximum 100 characters
- Can only contain letters, spaces, hyphens, and apostrophes

### Email

- Required for creation
- Must be a valid email format
- Maximum 255 characters
- Must be unique across all users

### Organization ID

- Required for creation
- Must be a valid UUID format
- Organization must exist and be active

### Password

- Optional for creation (auto-generated if not provided)
- Minimum 8 characters
- Maximum 128 characters
- Must contain at least one lowercase letter, one uppercase letter, and one number
- Cannot be updated through this endpoint (use separate password reset flow)

## Business Rules

1. **Super Admin Only**: Only users with `super_admin` role can access this endpoint
2. **Organization Validation**: Admin users can only be assigned to active organizations
3. **Unique Email**: Email addresses must be unique across all users
4. **Role Enforcement**: This endpoint only creates/manages users with `admin` role
5. **Cascade Considerations**: Deleting an admin user may impact related records (warnings provided)

## Usage Examples

### Create Admin User with cURL

```bash
curl -X POST "https://your-project.supabase.co/functions/v1/manage-admin-users" \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Jane Smith",
    "email": "jane.smith@acme.com",
    "organization_id": "123e4567-e89b-12d3-a456-426614174000"
  }'
```

### Get Admin Users with Filters

```bash
curl -X GET "https://your-project.supabase.co/functions/v1/manage-admin-users?organization_id=123e4567-e89b-12d3-a456-426614174000&page=1&limit=10" \
  -H "Authorization: Bearer your-jwt-token"
```

### Update Admin User

```bash
curl -X PUT "https://your-project.supabase.co/functions/v1/manage-admin-users/user-uuid" \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Jane Johnson",
    "organization_id": "456e7890-e89b-12d3-a456-426614174001"
  }'
```

### Delete Admin User

```bash
curl -X DELETE "https://your-project.supabase.co/functions/v1/manage-admin-users/user-uuid" \
  -H "Authorization: Bearer your-jwt-token"
```

## Performance Considerations

- Request timeout: 30 seconds
- Pagination recommended for large datasets
- Database indexes on email, organization_id, and role for optimal performance
- Response time tracking included in responses

## Security Features

- JWT token validation
- Role-based access control
- Input validation and sanitization
- CORS protection
- SQL injection prevention through parameterized queries
- Password security requirements
