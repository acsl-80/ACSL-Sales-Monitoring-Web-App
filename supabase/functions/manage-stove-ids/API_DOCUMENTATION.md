# Stove ID Management API Documentation

## Overview

This edge function provides comprehensive stove ID management capabilities with role-based access control, pagination, and filtering.

## Base URL

```
https://your-project.supabase.co/functions/v1/manage-stove-ids
```

## Authentication

All requests require authentication via Bearer token in the Authorization header:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

## User Roles

### Super Admin

- **Access**: All stove IDs across all organizations
- **Filters**: Can filter by organization name, stove ID, status, date range
- **Data Returned**: Stove ID, Status, Used By, Location, Date Sold, Organization details

### Admin

- **Access**: Only stove IDs for their organization
- **Filters**: Can filter by stove ID, status, date range
- **Data Returned**: Stove ID, Status, Date Sold, Sold To

## Endpoints

### GET /manage-stove-ids

Retrieve paginated stove IDs with optional filters.

#### Query Parameters

| Parameter           | Type    | Required | Default | Description                                    |
| ------------------- | ------- | -------- | ------- | ---------------------------------------------- |
| `page`              | integer | No       | 1       | Page number (1-indexed)                        |
| `page_size`         | integer | No       | 25      | Items per page (25, 50, or 100)                |
| `stove_id`          | string  | No       | -       | Filter by stove ID (partial match)             |
| `status`            | string  | No       | -       | Filter by status ("available" or "sold")       |
| `organization_name` | string  | No       | -       | Filter by organization name (super_admin only) |
| `date_from`         | string  | No       | -       | Filter by created date from (ISO 8601 format)  |
| `date_to`           | string  | No       | -       | Filter by created date to (ISO 8601 format)    |

#### Request Example

```bash
curl -X GET \
  'https://your-project.supabase.co/functions/v1/manage-stove-ids?page=1&page_size=25&status=sold' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

#### Response Format

```json
{
  "data": [
    {
      "id": "uuid",
      "stove_id": "STOVE-001",
      "status": "sold",
      "created_at": "2024-01-15T10:30:00Z",
      "organization_id": "org-uuid",
      "organization_name": "Partner Organization",
      "branch": "Branch Name",
      "location": "State/Location",
      "sale_id": "sale-uuid",
      "sale_date": "2024-02-20T14:00:00Z",
      "sold_to": "Customer Name"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 25,
    "total_count": 150,
    "total_pages": 6
  }
}
```

#### Response Fields

| Field               | Type           | Description                                 |
| ------------------- | -------------- | ------------------------------------------- |
| `id`                | string         | Unique stove ID record identifier           |
| `stove_id`          | string         | The actual stove ID                         |
| `status`            | string         | "available" or "sold"                       |
| `created_at`        | string         | When the stove ID was created               |
| `organization_id`   | string         | Associated organization UUID                |
| `organization_name` | string         | Partner organization name                   |
| `branch`            | string         | Branch name                                 |
| `location`          | string         | State/location of organization              |
| `sale_id`           | string \| null | Associated sale UUID (null if not sold)     |
| `sale_date`         | string \| null | Date when stove was sold (null if not sold) |
| `sold_to`           | string \| null | Customer name (null if not sold)            |

## Status Codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| 200  | Success                                 |
| 400  | Bad Request - Invalid parameters        |
| 401  | Unauthorized - Invalid or missing token |
| 405  | Method Not Allowed                      |
| 500  | Internal Server Error                   |

## Error Response Format

```json
{
  "error": "Error message",
  "details": "Detailed error information"
}
```

## Usage Examples

### Get All Stove IDs (First Page)

```bash
curl 'https://your-project.supabase.co/functions/v1/manage-stove-ids' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Filter by Status

```bash
curl 'https://your-project.supabase.co/functions/v1/manage-stove-ids?status=available&page_size=50' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Search by Stove ID

```bash
curl 'https://your-project.supabase.co/functions/v1/manage-stove-ids?stove_id=STOVE-123' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Filter by Organization (Super Admin Only)

```bash
curl 'https://your-project.supabase.co/functions/v1/manage-stove-ids?organization_name=Acme%20Corp&page=2' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Date Range Filter

```bash
curl 'https://your-project.supabase.co/functions/v1/manage-stove-ids?date_from=2024-01-01&date_to=2024-12-31' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

## Frontend Integration Example

```javascript
const fetchStoveIds = async (filters = {}) => {
  const params = new URLSearchParams({
    page: filters.page || 1,
    page_size: filters.pageSize || 25,
    ...(filters.stoveId && { stove_id: filters.stoveId }),
    ...(filters.status && { status: filters.status }),
    ...(filters.organizationName && {
      organization_name: filters.organizationName,
    }),
    ...(filters.dateFrom && { date_from: filters.dateFrom }),
    ...(filters.dateTo && { date_to: filters.dateTo }),
  });

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/manage-stove-ids?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch stove IDs");
  }

  return await response.json();
};
```

## Notes

- Pagination is handled server-side for optimal performance
- Date filters use ISO 8601 format (YYYY-MM-DD or full timestamp)
- Search filters use case-insensitive partial matching
- Admin users are automatically scoped to their organization
- Super admins have access to all organizations
