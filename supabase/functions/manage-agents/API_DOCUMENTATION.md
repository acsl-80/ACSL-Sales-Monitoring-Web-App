# Agent Management API Documentation

This edge function provides comprehensive CRUD operations for managing sales agents in the Stove Transaction system.

## Base URL

```
/functions/v1/manage-agents
```

## Authentication

All requests require JWT authentication via the `Authorization` header:

```
Authorization: Bearer <your-jwt-token>
```

**Required Roles:**

- `admin`: Can manage agents within their organization
- `super_admin`: Can manage agents across all organizations

## API Endpoints

### 1. Get All Agents

**GET** `/functions/v1/manage-agents`

Retrieves a paginated list of agents based on user permissions.

**Query Parameters:**

- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)
- `search` (optional): Search by agent name or email
- `sortBy` (optional): Sort field (default: "created_at")
- `sortOrder` (optional): "asc" or "desc" (default: "desc")

**Response:**

```json
{
  "success": true,
  "message": "Found 5 agents",
  "data": [
    {
      "id": "uuid",
      "full_name": "John Doe",
      "email": "john@example.com",
      "phone": "+1234567890",
      "role": "agent",
      "organization_id": "org-uuid",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 1,
    "totalItems": 5,
    "itemsPerPage": 10,
    "hasNextPage": false,
    "hasPrevPage": false
  },
  "filters": {
    "search": "",
    "sortBy": "created_at",
    "sortOrder": "desc"
  },
  "timestamp": "2024-01-01T00:00:00Z",
  "performance": {
    "responseTime": "123ms",
    "operation": "GET"
  }
}
```

### 2. Get Single Agent

**GET** `/functions/v1/manage-agents/{agent-id}`

Retrieves details of a specific agent.

**Response:**

```json
{
  "success": true,
  "message": "Agent retrieved successfully",
  "data": {
    "id": "uuid",
    "full_name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "role": "agent",
    "organization_id": "org-uuid",
    "created_at": "2024-01-01T00:00:00Z"
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### 3. Create Agent

**POST** `/functions/v1/manage-agents`

Creates a new agent user.

**Request Body:**

```json
{
  "email": "newagent@example.com",
  "password": "securepassword",
  "full_name": "New Agent",
  "phone": "+1234567890",
  "organization_id": "org-uuid" // Optional for super_admin, ignored for admin
}
```

**Field Requirements:**

- `email`: Required, valid email format, must be unique
- `password`: Required, minimum 6 characters
- `full_name`: Required, non-empty string
- `phone`: Optional, string
- `organization_id`: Optional for super_admin, automatically set for admin users

**Response:**

```json
{
  "success": true,
  "message": "Agent created successfully",
  "data": {
    "id": "new-uuid",
    "full_name": "New Agent",
    "email": "newagent@example.com",
    "role": "agent",
    "organization_id": "org-uuid"
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### 4. Update Agent

**PUT/PATCH** `/functions/v1/manage-agents/{agent-id}`

Updates an existing agent's information.

**Request Body:**

```json
{
  "full_name": "Updated Name",
  "email": "updated@example.com",
  "phone": "+0987654321",
  "organization_id": "new-org-uuid" // Only super_admin can change this
}
```

**Notes:**

- All fields are optional
- At least one field must be provided
- Email must be unique if being updated
- Only super_admin can change organization_id

**Response:**

```json
{
  "success": true,
  "message": "Agent updated successfully",
  "data": {
    "id": "uuid",
    "full_name": "Updated Name",
    "email": "updated@example.com",
    "phone": "+0987654321",
    "role": "agent",
    "organization_id": "org-uuid",
    "created_at": "2024-01-01T00:00:00Z"
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### 5. Delete Agent

**DELETE** `/functions/v1/manage-agents/{agent-id}`

Deletes an agent from the system.

**Important Notes:**

- Cannot delete agents with existing sales records
- Deletes both authentication and profile data
- Action is irreversible

**Response:**

```json
{
  "success": true,
  "message": "Agent deleted successfully",
  "data": {
    "id": "deleted-uuid",
    "deleted_agent": {
      "id": "deleted-uuid",
      "full_name": "Deleted Agent",
      "email": "deleted@example.com"
    }
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## Error Responses

All endpoints may return the following error responses:

### Authentication Errors (401)

```json
{
  "success": false,
  "message": "Access denied - Admin privileges required",
  "error": "Unauthorized: Invalid or missing authentication token",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Permission Errors (403)

```json
{
  "success": false,
  "message": "Access denied - Admin privileges required",
  "error": "Unauthorized: Admin or Super Admin privileges required",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Validation Errors (400)

```json
{
  "success": false,
  "message": "validation: Email is required, Password is required and must be at least 6 characters",
  "error": "validation: Email is required, Password is required and must be at least 6 characters",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Not Found Errors (404)

```json
{
  "success": false,
  "message": "Agent not found or access denied",
  "error": "Agent not found or access denied",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Server Errors (500)

```json
{
  "success": false,
  "message": "Internal server error",
  "error": "Database error: [specific error message]",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Timeout Errors (408)

```json
{
  "success": false,
  "message": "Request timeout - operation took too long",
  "error": "Request timeout - operation took too long",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## Access Control

### Admin Users

- Can only manage agents within their own organization
- Cannot change an agent's organization
- Cannot create agents in other organizations

### Super Admin Users

- Can manage agents across all organizations
- Can specify organization when creating agents
- Can change an agent's organization during updates
- Can see all agents regardless of organization

## Business Rules

1. **Email Uniqueness**: Each agent must have a unique email address
2. **Sales Records**: Agents with existing sales records cannot be deleted
3. **Organization Inheritance**: Admin users create agents in their own organization
4. **Role Restriction**: This API only manages users with the "agent" role
5. **Password Security**: Minimum 6 characters for new agent passwords

## Performance

- Request timeout: 30 seconds
- Pagination limits: Maximum 100 items per page
- Response includes performance metrics
- Optimized queries with proper indexing

## Security Features

- JWT token validation
- Role-based access control
- Organization-level data isolation
- Input validation and sanitization
- SQL injection protection
- Rate limiting (handled by Supabase Edge Functions)
