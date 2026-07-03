# CSV Import Feature - Frontend Developer Guide

## Overview

We've added a new **CSV Import** feature that allows super admins to bulk import/update organizations from external system CSV files. This feature uses a Partner ID synchronization system to prevent duplicates and maintain data consistency.

## Key Changes for Frontend

### 1. New API Endpoint

**Endpoint:** `POST /functions/v1/manage-organizations?import_csv=true`

**Purpose:** Import organizations from CSV data with automatic create/update logic

**Authentication:** Super admin JWT token required

### 2. How It Works

- **Partner ID Sync**: Uses external Partner ID to identify organizations
- **Upsert Logic**:
  - If Partner ID exists → UPDATE existing organization
  - If Partner ID doesn't exist → CREATE new organization + admin user
- **Bulk Processing**: Handles multiple organizations in one request
- **Error Isolation**: Failed rows don't stop successful imports

## Frontend Implementation Requirements

### 1. CSV Upload Interface

Create a CSV upload interface that:

- Accepts CSV files (`.csv` format)
- Converts CSV data to JSON array format
- Validates basic structure before sending to API
- Shows progress/loading states during import
- Displays import results after completion

### 2. CSV File Processing

The frontend needs to:

- Read CSV file content as text
- Parse CSV text into JSON array format
- Handle CSV headers as object keys
- Clean up empty rows and whitespace
- Convert to the expected JSON structure for the API

### 3. Client-side Validation

Before sending to the API, validate that:

- File is not empty
- Required columns are present
- All rows have Partner ID values
- Data structure is correct

### 4. API Integration

Make HTTP POST request to the import endpoint with:

- Authorization header with super admin JWT token
- Content-Type: application/json
- Body: JSON array of CSV row objects

## Expected CSV Format

The CSV must have these exact column headers:

```csv
Sales Reference,Sales Date,Customer,State,Branch,Quantity,Downloaded by,Stove IDs,Sales Factory,Sales Rep,Partner ID,Partner Address,Partner Contact Person,Partner Contact Phone,Partner Alternative Phone,Partner Email
TR-4591A1,9/18/2025,LAPO MFB,Cross River,OBUBRA,40,ACSL Admin,"101034734, 101034900",Asaba,Ejiro Emeotu,9CF111,Mile 1 park by former first bank obubra,ANIEFIOK UDO,7046023589,N/A,N/A
```

### Column Mapping for Organizations

| CSV Column                | Purpose              | Required    |
| ------------------------- | -------------------- | ----------- |
| Customer                  | Organization name    | ✅ Yes      |
| State                     | Organization state   | ✅ Yes      |
| Branch                    | Organization branch  | ✅ Yes      |
| Partner ID                | Unique sync ID       | ✅ Yes      |
| Partner Address           | Organization address | ❌ Optional |
| Partner Contact Person    | Contact person name  | ❌ Optional |
| Partner Contact Phone     | Primary phone        | ❌ Optional |
| Partner Alternative Phone | Alternative phone    | ❌ Optional |
| Partner Email             | Organization email   | ❌ Optional |

_Note: Other columns (Sales Reference, Stove IDs, etc.) are included in CSV but not used for organization creation_

## API Response Format

### Success Response Structure

The API returns a JSON object with the following structure:

- `success`: Boolean indicating if the import completed
- `message`: Human-readable status message
- `data`: Object containing import results
  - `created`: Array of newly created organizations
  - `updated`: Array of updated existing organizations
  - `errors`: Array of rows that failed to process
  - `summary`: Object with count statistics
- `timestamp`: ISO timestamp of when import completed
- `performance`: Object with response time metrics

### Response Data Fields

**Created/Updated Organizations:**

- `action`: Either "created" or "updated"
- `organization`: Complete organization object with all fields
- `admin_user`: Admin user details (for created organizations only)
- `partner_id`: The Partner ID from CSV

**Error Objects:**

- `partner_id`: Partner ID that failed (if available)
- `error`: Human-readable error message
- `type`: Error category (validation_error, processing_error, etc.)

**Summary Statistics:**

- `total_rows`: Total CSV rows processed
- `organizations_created`: Count of new organizations
- `organizations_updated`: Count of updated organizations
- `errors_count`: Count of failed rows

## UI Components Requirements

### 1. CSV Upload Interface

The upload interface should include:

- File input that accepts `.csv` files only
- File validation before processing
- Upload progress indicator
- Clear error messaging
- File information display (name, size)
- Import confirmation button
- Cancel/close functionality

### 2. Import Results Display

Results display should show:

- Summary statistics prominently
- List of successfully created organizations
- List of updated organizations
- Detailed error list with explanations
- Success/warning/error visual indicators
- Option to download detailed results

### 3. Integration with Organizations Page

Add to existing organizations management:

- "Import CSV" button in page header
- Modal or page overlay for import flow
- Refresh organizations list after import
- Toast notifications for quick feedback

## Error Handling

### Common Error Types

1. **Validation Errors**

   - Missing required columns in CSV
   - Empty Partner IDs
   - Invalid data formats
   - File structure issues

2. **Processing Errors**

   - Duplicate Partner IDs
   - Database constraint violations
   - Admin user creation failures
   - Data type mismatches

3. **Network Errors**
   - Request timeout (for large files)
   - Authentication failures
   - Server connection issues
   - API rate limits

### Error Display Requirements

The frontend should handle errors by:

- Displaying user-friendly error messages
- Categorizing errors by type (validation, processing, network)
- Showing specific details for each failed row
- Providing actionable guidance to fix issues
- Maintaining error context for troubleshooting

## Performance Considerations

### 1. File Size Limits

- **Recommended maximum**: 1000 rows per import
- **File size limit**: Approximately 5MB CSV files
- **Processing timeout**: 30 seconds maximum
- **Memory usage**: Consider large file impact on browser

### 2. Progress Indication Requirements

- Show loading states during file processing
- Display progress for API request
- Provide status updates during import
- Allow user to cancel long-running operations

### 3. Large File Handling Strategy

- Warn users about large file sizes
- Suggest splitting large imports into smaller batches
- Provide progress feedback during processing
- Handle timeout scenarios gracefully

## Security Requirements

1. **Access Control**: Only users with super admin role can access this feature
2. **File Validation**: Validate file type and structure before processing
3. **Data Privacy**: All CSV data is validated and sanitized by the backend
4. **Error Handling**: Don't expose sensitive system information in error messages
5. **Authentication**: Ensure valid JWT token is included in all requests

## Testing Requirements

Frontend implementation should be tested for:

- [ ] CSV file upload functionality works correctly
- [ ] File validation catches invalid formats and structures
- [ ] Import progress is clearly shown to users
- [ ] Success results are displayed in an organized manner
- [ ] Errors are shown with helpful, actionable messages
- [ ] Large files are handled gracefully with appropriate warnings
- [ ] Network errors are caught and displayed properly
- [ ] Only super admin users can access the feature
- [ ] Organizations list refreshes after successful import
- [ ] Modal or overlay can be closed/cancelled at any time
- [ ] File size limits are enforced
- [ ] Loading states prevent multiple simultaneous imports

## Sample Test Data

For testing purposes, create a CSV file with this structure:

**CSV Headers Required:**

```
Sales Reference,Sales Date,Customer,State,Branch,Quantity,Downloaded by,Stove IDs,Sales Factory,Sales Rep,Partner ID,Partner Address,Partner Contact Person,Partner Contact Phone,Partner Alternative Phone,Partner Email
```

**Sample Test Rows:**

- Test Organization 1: Lagos, Lagos Main, Partner ID: TEST001
- Test Organization 2: Abuja, Abuja Branch, Partner ID: TEST002
- Organization with missing data: Some fields empty or "N/A"
- Organization with update: Same Partner ID as previous test to test update functionality

## Implementation Notes

### Key Points for Developers

1. **File Processing**: Convert CSV text to JSON array format matching expected structure
2. **Validation**: Perform client-side validation before sending to API
3. **User Experience**: Provide clear feedback throughout the import process
4. **Error Recovery**: Allow users to fix issues and retry imports
5. **Data Display**: Present results in a clear, scannable format

### API Integration

- **Endpoint**: POST request to `/functions/v1/manage-organizations?import_csv=true`
- **Headers**: Include Authorization bearer token and Content-Type application/json
- **Body**: JSON array of CSV row objects
- **Response**: Handle both success and error scenarios appropriately

### Best Practices

- Validate files before API calls to reduce server load
- Provide progress feedback for better user experience
- Handle edge cases like empty files, network timeouts, and large datasets
- Use appropriate loading states and disable controls during processing
- Refresh relevant data after successful imports

The backend handles all complex processing, validation, and database operations. The frontend should focus on providing an intuitive user interface for file upload, progress tracking, and results display.
