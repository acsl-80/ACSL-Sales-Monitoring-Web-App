# Response Format Documentation for get-sales-advanced

## Overview
The `get-sales-advanced` endpoint now supports two different response formats to accommodate different client requirements:

- **Format 1 (Default)**: Clara Di Gregorio's requested format - standardized field names and structure
- **Format 2**: Original database format - maintains current structure for existing integrations

## Usage

### Parameter
Add the `responseFormat` parameter to your request:

```javascript
// POST request body
{
  "responseFormat": "format1", // or "format2"
  "limit": 100,
  // ... other filters
}

// GET request query parameter
?responseFormat=format1&limit=100
```

### Default Behavior
- If `responseFormat` is not specified, **format1** is used by default
- This ensures compatibility with Clara's requirements while maintaining backward compatibility

## Format 1 (Clara's Format)
This format follows Clara Di Gregorio's specifications with the following fields:

```typescript
interface ClaraFormat {
  serialNumber: string;        // Stove serial number (required)
  salesDate: string;          // Sales date (required)
  created: string;            // Created date in ISO format (required)
  state: string;              // State/region (required)
  district: string;           // District/LGA (required)  
  address: string;            // Full address (required)
  latitude: number | null;    // GPS latitude (required)
  longitude: number | null;   // GPS longitude (required)
  phone: string;              // Primary phone (required)
  contactPerson: string;      // Contact person name (required)
  otherContactPhone: string | null; // Secondary phone
  salesPartner: string;       // Sales partner/field assistant (required)
  userName: string;           // End user first name (required)
  userSurname: string;        // End user last name (required)
  cpa: string | null;         // CPA value (to be defined)
}
```

### Example Format 1 Response:
```json
{
  "success": true,
  "data": [
    {
      "serialNumber": "SV123456",
      "salesDate": "2024-10-15",
      "created": "2024-10-15T10:30:00.000Z",
      "state": "Lagos",
      "district": "Ikeja",
      "address": "123 Main Street, Victoria Island",
      "latitude": 6.4541,
      "longitude": 3.3947,
      "phone": "+234123456789",
      "contactPerson": "John Doe",
      "otherContactPhone": "+234987654321",
      "salesPartner": "ABC Partners",
      "userName": "Jane",
      "userSurname": "Smith",
      "cpa": null
    }
  ],
  "responseFormat": "format1",
  "pagination": { ... },
  // ... other metadata
}
```

## Format 2 (Database Format)
This maintains the existing structure for backward compatibility:

### Example Format 2 Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "transaction_id": "TXN123",
      "stove_serial_no": "SV123456",
      "sales_date": "2024-10-15",
      "contact_person": "John Doe",
      "contact_phone": "+234123456789",
      "end_user_name": "Jane Smith",
      "aka": "Jane",
      "state_backup": "Lagos",
      "lga_backup": "Ikeja",
      "phone": "+234123456789",
      "other_phone": "+234987654321",
      "partner_name": "ABC Partners",
      "amount": 50000,
      "signature": "signature_data",
      "created_by": "user_uuid",
      "organization_id": "org_uuid",
      "address_id": "addr_uuid",
      "stove_image_id": "img_uuid",
      "agreement_image_id": "img_uuid",
      "created_at": "2024-10-15T10:30:00.000Z",
      "status": "completed",
      "organizations": { ... },
      "addresses": { ... },
      // ... other joined data
    }
  ],
  "responseFormat": "format2",
  "pagination": { ... },
  // ... other metadata
}
```

## Implementation Details

### Field Mapping (Format 1)
| Clara Field | Source Field(s) |
|-------------|----------------|
| serialNumber | stove_serial_no |
| salesDate | sales_date |
| created | created_at (ISO format) |
| state | state_backup OR addresses.state OR organizations.state |
| district | lga_backup |
| address | addresses.full_address OR addresses.street + addresses.city |
| latitude | addresses.latitude |
| longitude | addresses.longitude |
| phone | phone OR contact_phone |
| contactPerson | contact_person |
| otherContactPhone | other_phone |
| salesPartner | partner_name OR organizations.partner_name |
| userName | First part of end_user_name |
| userSurname | Remaining parts of end_user_name |
| cpa | null (to be defined) |

### Migration Strategy
1. **Default to Format 1**: New integrations automatically get Clara's format
2. **Explicit Format 2**: Existing Flutter app and other clients can specify `responseFormat: "format2"`
3. **Gradual Migration**: Clients can migrate to Format 1 at their own pace

## Testing

### Test Format 1 (Default):
```bash
curl -X POST "your-endpoint/get-sales-advanced" \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5}'
```

### Test Format 2 (Database):
```bash
curl -X POST "your-endpoint/get-sales-advanced" \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5, "responseFormat": "format2"}'
```

### Test Format 1 (Explicit):
```bash
curl -X POST "your-endpoint/get-sales-advanced" \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5, "responseFormat": "format1"}'
```

## Notes
1. The `cpa` field in Format 1 is currently null - business logic needs to be defined
2. Name splitting for `userName`/`userSurname` handles various name formats
3. Address fallback logic ensures best available address information
4. All filtering, pagination, and other features work with both formats
5. Export functionality maintains compatibility with both formats
