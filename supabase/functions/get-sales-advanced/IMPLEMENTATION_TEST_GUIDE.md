# Test Examples for Dual Response Format System

## Backend Implementation Complete ✅

The `get-sales-advanced` endpoint now supports two response formats:

### Format 1 (Clara's Format - Default)
**Usage**: External API consumers, Clara's team
**Fields**: Standardized field names matching Clara's requirements

### Format 2 (Database Format)
**Usage**: Flutter app and internal systems
**Fields**: Current database field structure

## Testing the Implementation

### 1. Test Format 1 (Default - Clara's Format)

```bash
# POST request without specifying format (defaults to format1)
curl -X POST "YOUR_SUPABASE_URL/functions/v1/get-sales-advanced" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 5,
    "includeAddress": true,
    "includeOrganization": true
  }'
```

**Expected Response Structure:**
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
      "address": "123 Main Street",
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
  "pagination": { ... }
}
```

### 2. Test Format 2 (Database Format - Flutter)

```bash
# POST request explicitly requesting format2
curl -X POST "YOUR_SUPABASE_URL/functions/v1/get-sales-advanced" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 5,
    "responseFormat": "format2",
    "includeAddress": true,
    "includeOrganization": true
  }'
```

**Expected Response Structure:**
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
      "created_at": "2024-10-15T10:30:00.000Z",
      "status": "completed",
      "organizations": { ... },
      "addresses": { ... }
    }
  ],
  "responseFormat": "format2",
  "pagination": { ... }
}
```

### 3. Test Format 1 Explicitly

```bash
# POST request explicitly requesting format1
curl -X POST "YOUR_SUPABASE_URL/functions/v1/get-sales-advanced" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 5,
    "responseFormat": "format1"
  }'
```

## Flutter App Integration ✅

The Flutter app now has a new method `fetchSalesAdvanced()` that:
- Automatically uses `responseFormat: "format2"`
- Provides more filtering options than the basic `fetchSales()`
- Returns the familiar database format structure

### Flutter Usage Example:

```dart
// In your controller
final result = await _apiService.fetchSalesAdvanced(
  page: 1,
  limit: 20,
  search: "John",
  states: ["Lagos", "Abuja"],
  dateFrom: "2024-01-01",
  dateTo: "2024-12-31",
  includeOrganization: true,
  includeAddress: true,
);

if (result.success) {
  final paginatedSales = result.data!;
  print("Response format: ${paginatedSales.responseFormat}"); // Should print "format2"
  print("Sales count: ${paginatedSales.sales.length}");
  
  // Use the sales data as normal
  for (final sale in paginatedSales.sales) {
    print("Stove Serial: ${sale.stoveSerialNo}");
    print("End User: ${sale.endUserName}");
    // All existing SaleModel properties work as before
  }
}
```

## Migration Strategy

### Phase 1: ✅ Complete
- [x] Dual format support implemented in backend
- [x] Format 1 set as default for new consumers
- [x] Format 2 available for existing systems
- [x] Flutter method added with format2 support

### Phase 2: Gradual Migration
- [ ] Test Clara's integration with format1 (default)
- [ ] Optionally migrate Flutter app to use `fetchSalesAdvanced()` for better filtering
- [ ] Monitor both formats for any issues
- [ ] Update other client applications as needed

### Phase 3: Long-term
- [ ] Eventually standardize on single format when all clients migrated
- [ ] Deprecate older endpoints if no longer needed

## Field Mapping Reference

| Clara Field (Format 1) | Database Field (Format 2) | Source Logic |
|-------------------------|----------------------------|--------------|
| serialNumber | stove_serial_no | Direct mapping |
| salesDate | sales_date | Direct mapping |
| created | created_at | ISO format conversion |
| state | state_backup / addresses.state | Fallback logic |
| district | lga_backup | Direct mapping |
| address | addresses.full_address | Fallback to concatenated |
| latitude | addresses.latitude | Direct mapping |
| longitude | addresses.longitude | Direct mapping |
| phone | phone / contact_phone | Fallback logic |
| contactPerson | contact_person | Direct mapping |
| otherContactPhone | other_phone | Direct mapping |
| salesPartner | partner_name / organizations.partner_name | Fallback logic |
| userName | end_user_name (first part) | Name splitting |
| userSurname | end_user_name (remaining) | Name splitting |
| cpa | null | To be defined |

## Benefits Achieved

1. **Clara's Requirements Met**: Format 1 provides exactly what she requested
2. **Backward Compatibility**: Format 2 keeps existing Flutter app working
3. **Default Behavior**: New integrations automatically get the standardized format
4. **Flexibility**: Easy to add more formats in the future if needed
5. **Clean Migration Path**: Existing systems can migrate at their own pace
