# Organizations Management API Documentation

## Overview

The Organizations Management API provides comprehensive CRUD operations for managing organizations along with their associated admin users in the stove transaction system. This API is restricted to **Super Admin users only**.

**Key Features:**

- Creates organizations with linked admin users automatically
- Generates secure passwords and sends welcome emails
- Maintains synchronization between organizations and users
- Supports soft delete for data integrity
- Full user management lifecycle

## Base URL

```
https://your-project.supabase.co/functions/v1/manage-organizations
```

## Authentication

All requests require a valid JWT token with **super admin** privileges.

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## API Endpoints

### 1. Get All Organizations

Retrieve a paginated list of all organizations with their admin users.

**Endpoint:** `GET /manage-organizations`

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Number of records per page (max 100) |
| `offset` | number | 0 | Number of records to skip |
| `search` | string | - | Search in name, email, or city |
| `status` | string | - | Filter by status: `active`, `inactive`, `suspended`, `deleted` |
| `sortBy` | string | `created_at` | Sort field |
| `sortOrder` | string | `desc` | Sort order: `asc` or `desc` |
| `include_admin_users` | boolean | true | Include admin user data in response |

**Example Request:**

```http
GET /manage-organizations?limit=25&offset=0&search=stove&status=active&include_admin_users=true
Authorization: Bearer YOUR_JWT_TOKEN
```

**Example Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Stove Solutions Nigeria",
      "branch": "Lagos Main",
      "partner_email": "contact@stovesolutions.ng",
      "contact_phone": "+234123456789",
      "state": "Lagos",
      "contact_person": "John Doe",
      "alternative_phone": "+234987654321",
      "address": "123 Business Street",
      "city": "Lagos",
      "country": "Nigeria",
      "description": "Leading stove distributor",
      "status": "active",
      "created_at": "2025-08-11T10:00:00.000Z",
      "updated_at": "2025-08-11T10:00:00.000Z",
      "created_by": "user-uuid",
      "admin_user": {
        "id": "456e7890-e89b-12d3-a456-426614174001",
        "email": "admin@stovesolutions.ng",
        "full_name": "John Doe",
        "phone": "+234987654321",
        "role": "admin",
        "has_changed_password": true,
        "created_at": "2025-08-11T10:00:00.000Z"
      }
    }
  ],
  "pagination": {
    "limit": 25,
    "offset": 0,
    "total": 15,
    "totalPages": 1
  },
  "message": "Retrieved 15 organizations with admin user data",
  "timestamp": "2025-08-11T10:30:00.123Z",
  "performance": {
    "responseTime": "320ms",
    "operation": "GET"
  }
}
```

### 2. Get Single Organization

Retrieve details of a specific organization with its admin user.

**Endpoint:** `GET /manage-organizations/{organization-id}`

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `organization-id` | string (UUID) | Yes | Organization ID |

**Example Request:**

```http
GET /manage-organizations/123e4567-e89b-12d3-a456-426614174000
Authorization: Bearer YOUR_JWT_TOKEN
```

**Example Response:**

```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Stove Solutions Nigeria",
      "branch": "Lagos Main",
      "partner_email": "contact@stovesolutions.ng",
      "contact_phone": "+234123456789",
      "state": "Lagos",
      "contact_person": "John Doe",
      "alternative_phone": "+234987654321",
      "address": "123 Business Street",
      "city": "Lagos",
      "country": "Nigeria",
      "description": "Leading stove distributor",
      "status": "active",
      "created_at": "2025-08-11T10:00:00.000Z",
      "updated_at": "2025-08-11T10:00:00.000Z",
      "created_by": "user-uuid"
    },
    "admin_user": {
      "id": "456e7890-e89b-12d3-a456-426614174001",
      "email": "admin@stovesolutions.ng",
      "full_name": "John Doe",
      "phone": "+234987654321",
      "role": "admin",
      "has_changed_password": true,
      "created_at": "2025-08-11T10:00:00.000Z"
    }
  },
  "message": "Organization retrieved successfully",
  "timestamp": "2025-08-11T10:30:00.123Z",
  "performance": {
    "responseTime": "180ms",
    "operation": "GET"
  }
}
```

---

### 3. Create Organization with Admin User

Create a new organization along with its admin user. This endpoint will:

1. Validate organization and admin user data
2. Generate a secure password for the admin user
3. Create the admin user in Supabase Auth
4. Send a welcome email with login credentials
5. Create the organization record (only after email success)

**Endpoint:** `POST /manage-organizations`

**Request Body:**

```json
{
  "name": "New Organization Name", // Required: string, max 100 chars, Partner/Organization name
  "branch": "Lagos Branch", // Required: string, max 100 chars, Branch name as string
  "partner_email": "contact@neworg.com", // Required: string, unique email
  "contact_phone": "+234123456789", // Required: string, max 20 chars
  "state": "Lagos", // Required: string, max 100 chars
  "contact_person": "John Doe", // Optional: string, max 100 chars
  "alternative_phone": "+234987654321", // Optional: string, max 20 chars
  "address": "123 Business Street", // Optional: string, max 255 chars
  "city": "Lagos", // Optional: string, max 100 chars
  "country": "Nigeria", // Optional: string, defaults to "Nigeria"
  "description": "Organization description", // Optional: string, max 500 chars
  "status": "active", // Optional: "active", "inactive", "suspended"

  // Admin User Fields (Required)
  "admin_full_name": "Admin Full Name", // Required: string, max 100 chars
  "admin_email": "admin@neworg.com" // Required: string, unique email
}
```

**Minimal Request (Required Fields Only):**

```json
{
  "name": "Simple Organization",
  "branch": "Main Branch",
  "partner_email": "contact@org.com",
  "contact_phone": "+234123456789",
  "state": "Lagos",
  "admin_full_name": "Admin Name",
  "admin_email": "admin@org.com"
}
```

**Example Request:**

```http
POST /manage-organizations
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "name": "Green Energy Solutions",
  "branch": "Abuja Main",
  "partner_email": "info@greenenergy.ng",
  "contact_phone": "+234555123456",
  "state": "FCT",
  "contact_person": "Alice Johnson",
  "city": "Abuja",
  "description": "Clean energy solutions provider",
  "admin_full_name": "Alice Johnson",
  "admin_email": "alice@greenenergy.ng"
}
```

**Example Response:**

```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "456e7890-e89b-12d3-a456-426614174001",
      "name": "Green Energy Solutions",
      "branch": "Abuja Main",
      "partner_email": "info@greenenergy.ng",
      "contact_phone": "+234555123456",
      "state": "FCT",
      "contact_person": "Alice Johnson",
      "alternative_phone": null,
      "address": null,
      "city": "Abuja",
      "country": "Nigeria",
      "description": "Clean energy solutions provider",
      "status": "active",
      "created_at": "2025-08-11T10:30:00.000Z",
      "updated_at": "2025-08-11T10:30:00.000Z",
      "created_by": "super-admin-uuid"
    },
    "admin_user": {
      "id": "789e0123-e89b-12d3-a456-426614174002",
      "email": "alice@greenenergy.ng",
      "full_name": "Alice Johnson",
      "role": "admin",
      "password_sent": true,
      "has_changed_password": false
    },
    "email_sent": true
  },
  "message": "Organization and admin user created successfully. Welcome email sent.",
  "timestamp": "2025-08-11T10:30:00.123Z",
  "performance": {
    "responseTime": "2450ms",
    "operation": "POST"
  }
}
```

---

### 4. Update Organization and Admin User

Update an existing organization and optionally its admin user. Supports updating organization details, admin user email, and admin user name. If the admin email changes, a new password is generated and sent via email.

**Endpoint:** `PUT /manage-organizations/{organization-id}` or `PATCH /manage-organizations/{organization-id}`

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `organization-id` | string (UUID) | Yes | Organization ID |

**Request Body (All fields optional for updates):**

```json
{
  // Organization fields
  "name": "Updated Organization Name",
  "branch": "Updated Branch Name",
  "partner_email": "new@email.com",
  "contact_phone": "+234999888777",
  "contact_person": "New Contact Person",
  "alternative_phone": "+234111222333",
  "address": "New Address",
  "city": "New City",
  "state": "New State",
  "country": "Nigeria",
  "description": "Updated description",
  "status": "inactive",

  // Admin User fields (optional)
  "admin_full_name": "Updated Admin Name",
  "admin_email": "newemail@organization.com" // Will trigger password reset and email
}
```

**Example Request:**

```http
PUT /manage-organizations/123e4567-e89b-12d3-a456-426614174000
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "name": "Updated Stove Solutions",
  "branch": "Lagos Main",
  "status": "inactive",
  "description": "Updated company description",
  "admin_email": "newadmin@stovesolutions.ng"
}
```

**Example Response (with admin email change):**

```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Updated Stove Solutions",
      "branch": "Lagos Main",
      "partner_email": "contact@stovesolutions.ng",
      "contact_phone": "+234123456789",
      "state": "Lagos",
      "contact_person": "John Doe",
      "alternative_phone": "+234987654321",
      "address": "123 Business Street",
      "city": "Lagos",
      "country": "Nigeria",
      "description": "Updated company description",
      "status": "inactive",
      "created_at": "2025-08-11T10:00:00.000Z",
      "updated_at": "2025-08-11T11:15:00.000Z",
      "created_by": "user-uuid"
    },
    "admin_user": {
      "id": "456e7890-e89b-12d3-a456-426614174001",
      "email": "newadmin@stovesolutions.ng",
      "full_name": "John Doe",
      "role": "admin",
      "password_changed": true,
      "notification_sent": true
    }
  },
  "message": "Organization updated successfully. Admin user credentials updated and notification email sent.",
  "timestamp": "2025-08-11T11:15:00.123Z",
  "performance": {
    "responseTime": "1280ms",
    "operation": "PUT"
  }
}
```

---

### 5. Delete Organization

Delete an organization and disable its admin user. By default, this performs a **soft delete** (sets status to 'deleted' and disables the admin user). For permanent deletion, use the `hard_delete=true` query parameter.

**Endpoint:** `DELETE /manage-organizations/{organization-id}`

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `organization-id` | string (UUID) | Yes | Organization ID |

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `hard_delete` | boolean | false | Set to `true` for permanent deletion (IRREVERSIBLE) |

**Example Request (Soft Delete):**

```http
DELETE /manage-organizations/123e4567-e89b-12d3-a456-426614174000
Authorization: Bearer YOUR_JWT_TOKEN
```

**Example Response (Soft Delete):**

```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "Deleted Organization",
    "deletedAt": "2025-08-11T11:30:00.000Z",
    "admin_user_disabled": true,
    "soft_deleted": true
  },
  "message": "Organization soft-deleted successfully (status set to 'deleted')",
  "warnings": [
    "Organization had 5 associated sales records",
    "Organization had 3 associated users",
    "Organization admin user has been disabled"
  ],
  "timestamp": "2025-08-11T11:30:00.123Z",
  "performance": {
    "responseTime": "520ms",
    "operation": "DELETE"
  }
}
```

**Example Request (Hard Delete):**

```http
DELETE /manage-organizations/123e4567-e89b-12d3-a456-426614174000?hard_delete=true
Authorization: Bearer YOUR_JWT_TOKEN
```

**Example Response (Hard Delete):**

```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "Deleted Organization",
    "deletedAt": "2025-08-11T11:30:00.000Z",
    "admin_user_deleted": true,
    "hard_deleted": true
  },
  "message": "Organization permanently deleted (IRREVERSIBLE)",
  "warnings": [
    "This was a hard delete operation",
    "All data has been permanently removed",
    "This action cannot be undone"
  ],
  "timestamp": "2025-08-11T11:30:00.123Z",
  "performance": {
    "responseTime": "420ms",
    "operation": "DELETE"
  }
}
```

---

## Data Models

### Organization Object

```typescript
interface Organization {
  id: string; // UUID, auto-generated
  name: string; // Required, max 100 chars, Partner/Organization name
  branch: string; // Required, max 100 chars, Branch name as string
  partner_email: string; // Required, unique, valid email
  contact_phone: string; // Required, max 20 chars
  state: string; // Required, max 100 chars
  contact_person?: string; // Optional, max 100 chars
  alternative_phone?: string; // Optional, max 20 chars
  address?: string; // Optional, max 255 chars
  city?: string; // Optional, max 100 chars
  country?: string; // Optional, max 100 chars, defaults to "Nigeria"
  description?: string; // Optional, max 500 chars
  status: "active" | "inactive" | "suspended" | "deleted"; // Defaults to "active"
  created_at: string; // ISO timestamp, auto-generated
  updated_at: string; // ISO timestamp, auto-updated
  created_by?: string; // UUID of creator
}
```

### Admin User Object

```typescript
interface AdminUser {
  id: string; // UUID, auto-generated
  email: string; // Required, unique, valid email
  full_name: string; // Required, max 100 chars
  phone?: string; // Optional, max 20 chars
  role: "admin"; // Always "admin" for organization admin users
  has_changed_password: boolean; // false when password is first generated
  created_at: string; // ISO timestamp, auto-generated
  organization_id: string; // UUID reference to organization
}
```

### Create Organization Request

```typescript
interface CreateOrganizationRequest {
  // Organization fields
  name: string; // Required, max 100 chars, Partner/Organization name
  branch: string; // Required, max 100 chars, Branch name as string
  partner_email: string; // Required, unique email
  contact_phone: string; // Required, max 20 chars
  state: string; // Required, max 100 chars
  contact_person?: string; // Optional, max 100 chars
  alternative_phone?: string; // Optional, max 20 chars
  address?: string; // Optional, max 255 chars
  city?: string; // Optional, max 100 chars
  country?: string; // Optional, defaults to "Nigeria"
  description?: string; // Optional, max 500 chars
  status?: "active" | "inactive" | "suspended"; // Optional, defaults to "active"

  // Admin user fields
  admin_full_name: string; // Required, max 100 chars
  admin_email: string; // Required, unique email, different from partner_email
}
```

### Update Organization Request

```typescript
interface UpdateOrganizationRequest {
  // Organization fields (all optional)
  name?: string; // Max 100 chars, Partner/Organization name
  branch?: string; // Max 100 chars, Branch name as string
  partner_email?: string; // Unique email
  contact_phone?: string; // Max 20 chars
  contact_person?: string; // Max 100 chars
  alternative_phone?: string; // Max 20 chars
  address?: string; // Max 255 chars
  city?: string; // Max 100 chars
  state?: string; // Max 100 chars
  country?: string; // Max 100 chars
  description?: string; // Max 500 chars
  status?: "active" | "inactive" | "suspended"; // Cannot update to "deleted"

  // Admin user fields (optional)
  admin_full_name?: string; // Max 100 chars
  admin_email?: string; // Unique email, triggers password reset if changed
}
```

### Pagination Object

```typescript
interface Pagination {
  limit: number; // Records per page
  offset: number; // Records skipped
  total: number; // Total records matching filters
  totalPages: number; // Total pages available
}
```

---

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "message": "Human-readable error message",
  "error": "Technical error details",
  "timestamp": "2025-08-11T10:30:00.123Z",
  "retryable": true // Only present for 408/503 errors
}
```

### Common HTTP Status Codes

| Status | Meaning             | Description                               |
| ------ | ------------------- | ----------------------------------------- |
| 200    | Success             | Request completed successfully            |
| 400    | Bad Request         | Invalid request data or validation failed |
| 403    | Forbidden           | Not authorized (non-super admin)          |
| 404    | Not Found           | Organization not found                    |
| 408    | Request Timeout     | Request took too long (>30s)              |
| 409    | Conflict            | Organization name/email already exists    |
| 500    | Server Error        | Internal server error                     |
| 503    | Service Unavailable | Database temporarily unavailable          |

### Validation Errors

```json
{
  "success": false,
  "message": "Validation failed: Organization name is required, Admin user email must be a valid email address",
  "error": "Validation failed: Organization name is required, Admin user email must be a valid email address",
  "timestamp": "2025-08-11T10:30:00.123Z"
}
```

### User Creation Errors

```json
{
  "success": false,
  "message": "Failed to send welcome email: SMTP connection timeout",
  "error": "Failed to send welcome email: SMTP connection timeout",
  "timestamp": "2025-08-11T10:30:00.123Z"
}
```

### Email Service Errors

If the email service fails during organization creation, the entire operation is rolled back:

```json
{
  "success": false,
  "message": "Failed to send welcome email: Email service unavailable",
  "error": "Failed to send welcome email: Email service unavailable",
  "timestamp": "2025-08-11T10:30:00.123Z"
}
```

---

## Configuration

### Required Environment Variables

| Variable        | Description                            | Example                                   |
| --------------- | -------------------------------------- | ----------------------------------------- |
| `EMAIL_API_URL` | URL to your Node.js email microservice | `https://api.homestaq.com/api/send-email` |
| `ENVIRONMENT`   | Environment setting                    | `production` or `development`             |

### Email Service Integration

Your Node.js microservice handles all email logic internally. The edge function sends a simple JSON payload:

```json
{
  "email": "admin@organization.com",
  "user_name": "Admin Full Name",
  "organization_name": "Organization Name",
  "password": "generated_password",
  "type": "welcome-admin"
}
```

The microservice must return `{success: true}` on successful email sending. Organization creation fails if email sending fails (transactional safety).

---

## Frontend Integration Examples

### React/JavaScript Example

```javascript
// Enhanced API Service Class with User Management
class OrganizationsAPI {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async getAllOrganizations(params = {}) {
    const queryString = new URLSearchParams({
      include_admin_users: "true", // Include admin user data by default
      ...params,
    }).toString();

    const response = await fetch(
      `${this.baseUrl}/manage-organizations?${queryString}`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.json();
  }

  async getOrganization(id) {
    const response = await fetch(`${this.baseUrl}/manage-organizations/${id}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });
    return response.json();
  }

  async createOrganizationWithUser(data) {
    // Validate required fields
    if (
      !data.name ||
      !data.branch ||
      !data.partner_email ||
      !data.contact_phone ||
      !data.state ||
      !data.admin_full_name ||
      !data.admin_email
    ) {
      throw new Error("Missing required fields for organization creation");
    }

    const response = await fetch(`${this.baseUrl}/manage-organizations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async updateOrganization(id, data) {
    const response = await fetch(`${this.baseUrl}/manage-organizations/${id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async deleteOrganization(id, hardDelete = false) {
    const url = hardDelete
      ? `${this.baseUrl}/manage-organizations/${id}?hard_delete=true`
      : `${this.baseUrl}/manage-organizations/${id}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });
    return response.json();
  }
}

// Usage Examples
const api = new OrganizationsAPI(
  "https://your-project.supabase.co/functions/v1",
  "your-jwt-token"
);

// Get organizations with admin users
const organizations = await api.getAllOrganizations({
  limit: 25,
  offset: 0,
  search: "stove",
  status: "active",
  include_admin_users: "true",
});

// Create organization with admin user
const newOrg = await api.createOrganizationWithUser({
  name: "New Organization",
  branch: "Lagos Main",
  partner_email: "contact@organization.com",
  contact_phone: "+234123456789",
  state: "Lagos",
  admin_full_name: "Admin Name",
  admin_email: "admin@organization.com",
  city: "Lagos",
});

// Update organization and admin user
const updated = await api.updateOrganization("org-id", {
  status: "inactive",
  admin_email: "newemail@organization.com", // This will trigger password reset
});

// Soft delete (recommended)
const deleted = await api.deleteOrganization("org-id", false);

// Hard delete (permanent, use with caution)
const hardDeleted = await api.deleteOrganization("org-id", true);
```

### Flutter/Dart Example

```dart
class OrganizationsAPI {
  final String baseUrl;
  final String token;
  final http.Client client = http.Client();

  OrganizationsAPI(this.baseUrl, this.token);

  Map<String, String> get headers => {
    'Authorization': 'Bearer $token',
    'Content-Type': 'application/json',
  };

  Future<Map<String, dynamic>> getAllOrganizations({
    int limit = 50,
    int offset = 0,
    String? search,
    String? status,
    bool includeAdminUsers = true,
  }) async {
    final params = <String, String>{
      'limit': limit.toString(),
      'offset': offset.toString(),
      'include_admin_users': includeAdminUsers.toString(),
      if (search != null) 'search': search,
      if (status != null) 'status': status,
    };

    final uri = Uri.parse('$baseUrl/manage-organizations')
        .replace(queryParameters: params);

    final response = await client.get(uri, headers: headers);
    return json.decode(response.body);
  }

  Future<Map<String, dynamic>> createOrganizationWithUser(
      Map<String, dynamic> data) async {

    // Validate required fields
    final requiredFields = ['name', 'branch', 'partner_email', 'contact_phone', 'state', 'admin_full_name', 'admin_email'];
    for (final field in requiredFields) {
      if (!data.containsKey(field) || data[field] == null || data[field].toString().isEmpty) {
        throw Exception('Missing required field: $field');
      }
    }

    final response = await client.post(
      Uri.parse('$baseUrl/manage-organizations'),
      headers: headers,
      body: json.encode(data),
    );
    return json.decode(response.body);
  }

  Future<Map<String, dynamic>> updateOrganization(
      String id, Map<String, dynamic> data) async {
    final response = await client.put(
      Uri.parse('$baseUrl/manage-organizations/$id'),
      headers: headers,
      body: json.encode(data),
    );
    return json.decode(response.body);
  }

  Future<Map<String, dynamic>> deleteOrganization(String id, {bool hardDelete = false}) async {
    final uri = hardDelete
        ? Uri.parse('$baseUrl/manage-organizations/$id').replace(
            queryParameters: {'hard_delete': 'true'})
        : Uri.parse('$baseUrl/manage-organizations/$id');

    final response = await client.delete(uri, headers: headers);
    return json.decode(response.body);
  }
}

// Usage Example
class OrganizationService {
  final OrganizationsAPI _api;

  OrganizationService(this._api);

  Future<void> createNewOrganization() async {
    try {
      final result = await _api.createOrganizationWithUser({
        'name': 'Test Organization',
        'branch': 'Lagos Main',
        'partner_email': 'partner@test.com',
        'contact_phone': '+234123456789',
        'state': 'Lagos',
        'admin_full_name': 'Admin User',
        'admin_email': 'admin@test.com',
        'city': 'Lagos',
        'description': 'Test organization',
      });

      if (result['success'] == true) {
        print('Organization created successfully!');
        print('Admin email sent: ${result['data']['email_sent']}');
      } else {
        print('Error: ${result['message']}');
      }
    } catch (e) {
      print('Exception: $e');
    }
  }
}
```

---

## Performance Notes

- **Response Times**:
  - Read operations: Typically 200-500ms
  - Create operations: 2-5 seconds (includes user creation and email sending)
  - Update operations: 500ms-2 seconds (depending on whether email is sent)
  - Delete operations: 300-800ms
- **Rate Limiting**: No specific limits, but be mindful of reasonable usage
- **Caching**: Responses are not cached by default
- **Timeouts**: 30-second timeout for all operations
- **Email Service**: Email sending adds 1-3 seconds to creation/update operations

---

## Security Notes

1. **Super Admin Only**: Only users with `role: "super_admin"` can access this API
2. **JWT Required**: All requests must include a valid JWT token
3. **Input Validation**: All input is validated server-side
4. **SQL Injection Protection**: Built-in protection via Supabase client
5. **Unique Constraints**:
   - Organization names must be unique
   - Partner emails must be unique across organizations
   - Admin user emails must be unique across all users
6. **Password Security**: Generated passwords are 12+ characters with mixed case, numbers, and symbols
7. **Email Security**: Welcome emails are sent only after successful user creation
8. **Soft Delete**: Default deletion preserves data integrity
9. **Transaction Safety**: User creation and organization creation are properly rolled back on failure

---

## Migration Guide

### From Old API to New API

If you're migrating from the previous version that didn't include user management:

#### 1. Update Create Organization Calls

**Old Format:**

```json
{
  "name": "Organization Name",
  "partner_email": "contact@org.com"
}
```

**New Format:**

```json
{
  "name": "Organization Name",
  "branch": "Main Branch",
  "partner_email": "contact@org.com",
  "contact_phone": "+234123456789",
  "state": "Lagos",
  "admin_full_name": "Admin Full Name",
  "admin_email": "admin@org.com"
}
```

#### 2. Handle New Response Structure

**Old Response:**

```json
{
  "success": true,
  "data": { "id": "org-id", "name": "Org Name", ... },
  "message": "Organization created successfully"
}
```

**New Response:**

```json
{
  "success": true,
  "data": {
    "organization": { "id": "org-id", "name": "Org Name", ... },
    "admin_user": { "id": "user-id", "email": "admin@org.com", ... },
    "email_sent": true
  },
  "message": "Organization and admin user created successfully. Welcome email sent."
}
```

#### 3. Update Error Handling

Be prepared for new error types:

- Email service failures
- User creation failures
- Password generation issues

#### 4. Configure Email Service

Set up the required environment variables:

- `EMAIL_API_URL`
- `ENVIRONMENT`

---

## Support

For technical issues or questions about this API, please contact the backend development team.

**API Version:** 2.0  
**Last Updated:** September 5, 2025  
**Breaking Changes:** Yes (from v1.0 - now includes mandatory user creation)
