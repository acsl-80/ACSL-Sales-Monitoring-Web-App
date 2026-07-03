# CSV Import API Documentation for Organizations

## Overview

The CSV Import functionality allows super admins to bulk import/update organizations from external system CSV files. This enables synchronization between the external system and the Supabase database using a global `Partner ID`.

## Key Concepts

### Partner ID Synchronization

- **Partner ID**: A unique identifier from the external system that appears in CSV files
- **Dual ID System**: Each organization has both a Supabase UUID (`id`) and an external `partner_id`
- **Upsert Logic**:
  - If `partner_id` exists in database → UPDATE organization
  - If `partner_id` doesn't exist → CREATE new organization with admin user

### Stove IDs Integration

- **Dual Processing**: Creates both organizations AND their associated stove IDs in one operation
- **Stove ID Parsing**: Extracts comma-separated stove IDs from "Stove IDs" column
- **Organization Linkage**: Each stove ID is automatically linked to its organization
- **Duplicate Handling**: Skips existing stove IDs to prevent conflicts

### CSV Structure

The CSV must contain these columns (based on your sample):

```csv
Sales Reference,Sales Date,Customer,State,Branch,Quantity,Downloaded by,Stove IDs,Sales Factory,Sales Rep,Partner ID,Partner Address,Partner Contact Person,Partner Contact Phone,Partner Alternative Phone,Partner Email
```

## API Endpoint

### CSV Import

**POST** `/manage-organizations?import_csv=true`

Import organizations from CSV data with automatic create/update logic. Also processes stove IDs from the CSV to create associated stove records for each organization.

#### Authentication

- Requires super admin authentication
- Uses JWT token in Authorization header

#### Request Format

```http
POST /manage-organizations?import_csv=true
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

[
  {
    "Sales Reference": "TR-4591A1",
    "Sales Date": "9/18/2025",
    "Customer": "LAPO MFB",
    "State": "Cross River",
    "Branch": "OBUBRA",
    "Quantity": "40",
    "Downloaded by": "ACSL Admin",
    "Stove IDs": "101034734, 101034900, ...",
    "Sales Factory": "Asaba",
    "Sales Rep": "Ejiro Emeotu",
    "Partner ID": "9CF111",
    "Partner Address": "Mile 1 park by former first bank obubra",
    "Partner Contact Person": "ANIEFIOK UDO",
    "Partner Contact Phone": "7046023589",
    "Partner Alternative Phone": "N/A",
    "Partner Email": "N/A"
  }
]
```

#### CSV Field Mapping

| CSV Column                | Database Field    | Required | Notes                                      |
| ------------------------- | ----------------- | -------- | ------------------------------------------ |
| Customer                  | partner_name      | Yes      | Organization name                          |
| State                     | state             | Yes      | State location                             |
| Branch                    | branch            | Yes      | Branch name                                |
| Partner ID                | partner_id        | Yes      | Global sync ID                             |
| Partner Address           | address           | No       | Physical address                           |
| Partner Contact Person    | contact_person    | No       | Contact person name                        |
| Partner Contact Phone     | contact_phone     | No       | Primary phone                              |
| Partner Alternative Phone | alternative_phone | No       | Alt phone                                  |
| Partner Email             | email             | No       | Email address                              |
| Stove IDs                 | stove_ids table   | Yes      | Comma-separated stove IDs for organization |

#### Data Processing Rules

1. **Empty/N/A Values**: Converted to `null`
2. **Duplicate Partner IDs**: Only one organization per Partner ID (last one wins in CSV)
3. **Missing Partner ID**: Row is skipped with error logged
4. **Auto-generated Admin Users**: Created for new organizations
5. **Email Generation**: If no email provided, generates from partner name
6. **Stove ID Processing**: Comma-separated stove IDs are parsed and linked to organization
7. **Duplicate Stove IDs**: Existing stove IDs are skipped to prevent conflicts

#### Response Format

```json
{
  "success": true,
  "message": "CSV import completed",
  "data": {
    "created": [
      {
        "action": "created",
        "organization": {
          "id": "uuid-here",
          "partner_id": "9CF111",
          "partner_name": "LAPO MFB",
          "branch": "OBUBRA",
          "state": "Cross River",
          "contact_person": "ANIEFIOK UDO",
          "contact_phone": "7046023589",
          "alternative_phone": null,
          "email": null,
          "address": "Mile 1 park by former first bank obubra",
          "created_at": "2025-10-02T...",
          "updated_at": "2025-10-02T..."
        },
        "admin_user": {
          "id": "auth-user-id",
          "email": "lapomfb@admin.com",
          "full_name": "LAPO MFB Admin",
          "role": "admin",
          "password_sent": true
        },
        "stove_ids": {
          "imported": 15,
          "skipped": 2,
          "errors": 0
        },
        "partner_id": "9CF111"
      }
    ],
    "updated": [
      {
        "action": "updated",
        "organization": {
          "id": "existing-uuid",
          "partner_id": "EXISTING123",
          "partner_name": "Updated Name"
          // ... other fields
        },
        "partner_id": "EXISTING123"
      }
    ],
    "errors": [
      {
        "partner_id": "INVALID456",
        "error": "Validation failed: Partner name is required",
        "type": "validation_error"
      }
    ],
    "summary": {
      "total_rows": 100,
      "organizations_created": 85,
      "organizations_updated": 10,
      "errors_count": 5,
      "stove_ids_imported": 850,
      "stove_ids_skipped": 42,
      "stove_ids_errors": 3
    }
  },
  "timestamp": "2025-10-02T10:30:00.000Z",
  "performance": {
    "responseTime": "2500ms",
    "operation": "POST"
  }
}
```

## Error Handling

### Validation Errors

- **Missing Partner ID**: Row skipped
- **Invalid CSV structure**: Entire request rejected
- **Data validation failures**: Individual rows skipped

### Common Error Types

```json
{
  "type": "validation_error",
  "error": "Partner name is required"
}
```

```json
{
  "type": "database_error",
  "error": "Unique constraint violation"
}
```

```json
{
  "type": "processing_error",
  "error": "Failed to create admin user"
}
```

## Admin User Creation

For new organizations, the system automatically:

1. **Generates Admin Email**:

   - Uses Partner Email from CSV if provided
   - Otherwise generates: `{cleanpartnername}@admin.com`

2. **Creates Auth User**:

   - Auto-generates secure password
   - Assigns admin role
   - Links to organization

3. **Sends Welcome Email**:
   - Contains login credentials
   - Organization details
   - If email fails, user is still created

## Database Schema Updates

### Required Table Changes

Run this SQL to prepare your database:

```sql
-- Add partner_id column
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS partner_id text;

-- Create unique index for partner_id
CREATE UNIQUE INDEX IF NOT EXISTS organizations_partner_id_key
ON public.organizations(partner_id)
WHERE partner_id IS NOT NULL;

-- Ensure all required columns exist
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS partner_name text NOT NULL DEFAULT 'Unknown Partner',
ADD COLUMN IF NOT EXISTS branch text NOT NULL DEFAULT 'Main Branch',
ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'Unknown State',
ADD COLUMN IF NOT EXISTS contact_person text,
ADD COLUMN IF NOT EXISTS contact_phone text,
ADD COLUMN IF NOT EXISTS alternative_phone text,
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS address text,
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now(),
ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);
```

## Integration Examples

### JavaScript/TypeScript

```typescript
async function importCSV(csvData: any[], authToken: string) {
  const response = await fetch(
    "/functions/v1/manage-organizations?import_csv=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(csvData),
    }
  );

  return await response.json();
}
```

### Flutter/Dart

```dart
Future<Map<String, dynamic>> importCSV(List<Map<String, dynamic>> csvData) async {
  final response = await supabaseService.callEdgeFunction(
    'manage-organizations?import_csv=true',
    body: csvData,
    requireAuth: true,
  );

  return response.data;
}
```

## Best Practices

### CSV Preparation

1. **Clean Data**: Remove empty rows, standardize formats
2. **Partner ID Validation**: Ensure all Partner IDs are unique and present
3. **Phone Numbers**: Format consistently (include country codes if needed)
4. **Email Validation**: Verify email formats before import

### Performance Considerations

1. **Batch Size**: Recommend max 1000 rows per import
2. **Timeout**: Large imports may take several minutes
3. **Error Handling**: Always check the errors array in response

### Security Notes

1. **Super Admin Only**: Only super admins can perform CSV imports
2. **Data Validation**: All data is validated before database operations
3. **Audit Trail**: created_by/updated_by fields track who made changes
4. **RLS Policies**: Ensure proper Row Level Security policies are in place

## Troubleshooting

### Common Issues

1. **"CSV Validation failed: Missing required columns"**

   - Ensure CSV headers match exactly (case-sensitive)
   - Check for typos in column names

2. **"Partner ID already exists"**

   - Partner IDs must be unique across the system
   - Check for duplicates in your CSV

3. **"Failed to send welcome email"**

   - User is still created, email sending is separate process
   - Check email service configuration

4. **"Request timeout"**
   - Reduce batch size
   - Split large imports into smaller chunks

### Monitoring

- Check response `summary` for import statistics
- Monitor `errors` array for failed rows
- Use `performance.responseTime` to track import speed
