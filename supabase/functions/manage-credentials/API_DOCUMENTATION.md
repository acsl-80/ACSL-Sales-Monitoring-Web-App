# Manage Credentials API Documentation

## Overview

The **Manage Credentials** Edge Function provides Super Admin functionality for managing organization credentials. This API allows Super Admins to view all credentials and reset passwords for organizations.

**Base URL**: `https://[your-project-ref].supabase.co/functions/v1/manage-credentials`

---

## Authentication

All endpoints require **Super Admin** authentication. Include the Super Admin's authentication token in the request headers:

```http
Authorization: Bearer [super_admin_jwt_token]
```

**Role Requirement**: Only users with `role = 'super_admin'` can access these endpoints.

---

## Endpoints

### 1. Get All Credentials

Retrieve a list of all organization credentials.

**Endpoint**: `GET /manage-credentials`

**Headers**:

```http
Authorization: Bearer [super_admin_jwt_token]
Content-Type: application/json
```

**Response** (200 OK):

```json
{
  "success": true,
  "count": 25,
  "data": [
    {
      "id": "uuid",
      "partner_id": "598581",
      "partner_name": "LAPO MFB GBONGAN",
      "email": "lapo_mfb_gbongan_598581@atmosfair.site",
      "password": "aB3d5FgH9!kL",
      "organization_id": "org-uuid",
      "user_id": "user-uuid",
      "is_dummy_email": true,
      "created_at": "2025-11-06T10:30:00Z",
      "updated_at": "2025-11-06T10:30:00Z",
      "organizations": {
        "partner_name": "LAPO MFB GBONGAN",
        "email": "contact@example.com",
        "contact_person": "John Doe",
        "contact_phone": "08012345678",
        "state": "Osun",
        "branch": "Gbongan"
      }
    }
  ]
}
```

**Error Response** (401 Unauthorized):

```json
{
  "success": false,
  "error": "Access denied. Only Super Admin can access this resource."
}
```

---

### 2. Get Credential by Partner ID

Retrieve credentials for a specific organization by partner ID.

**Endpoint**: `GET /manage-credentials?partner_id={partner_id}`

**Headers**:

```http
Authorization: Bearer [super_admin_jwt_token]
Content-Type: application/json
```

**Query Parameters**:

- `partner_id` (required): The partner ID of the organization

**Example Request**:

```http
GET /manage-credentials?partner_id=598581
```

**Response** (200 OK):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "partner_id": "598581",
    "partner_name": "LAPO MFB GBONGAN",
    "email": "lapo_mfb_gbongan_598581@atmosfair.site",
    "password": "aB3d5FgH9!kL",
    "organization_id": "org-uuid",
    "user_id": "user-uuid",
    "is_dummy_email": true,
    "created_at": "2025-11-06T10:30:00Z",
    "updated_at": "2025-11-06T10:30:00Z",
    "organizations": {
      "partner_name": "LAPO MFB GBONGAN",
      "email": "contact@example.com",
      "contact_person": "John Doe",
      "contact_phone": "08012345678",
      "state": "Osun",
      "branch": "Gbongan"
    }
  }
}
```

**Error Response** (404 Not Found):

```json
{
  "success": false,
  "error": "Credential not found for this partner"
}
```

---

### 3. Get Credential by Organization ID

Retrieve credentials for a specific organization by organization ID.

**Endpoint**: `GET /manage-credentials?organization_id={organization_id}`

**Headers**:

```http
Authorization: Bearer [super_admin_jwt_token]
Content-Type: application/json
```

**Query Parameters**:

- `organization_id` (required): The UUID of the organization

**Example Request**:

```http
GET /manage-credentials?organization_id=550e8400-e29b-41d4-a716-446655440000
```

**Response**: Same as "Get Credential by Partner ID"

---

### 4. Update Organization Password (Reset Password)

**⚠️ CRITICAL SECURITY FEATURE**: Reset/change password for any organization. Requires Super Admin password verification.

**Endpoint**: `PUT /manage-credentials/update-password`

**Headers**:

```http
Authorization: Bearer [super_admin_jwt_token]
Content-Type: application/json
```

**Request Body**:

```json
{
  "partner_id": "598581",
  "new_password": "NewSecureP@ssw0rd123",
  "super_admin_email": "admin@acsl.com",
  "super_admin_password": "SuperAdminPassword123"
}
```

**Request Fields**:

- `partner_id` (required): Partner ID of the organization whose password will be reset
- `new_password` (required): The new password for the organization
- `super_admin_email` (required): The email of the Super Admin performing this action
- `super_admin_password` (required): **The Super Admin's current password** (for verification)

**⚠️ Important Notes**:

1. **Super Admin Password Verification**: The Super Admin must provide their own password to authorize this action
2. **Security**: This prevents unauthorized password changes even if someone gains access to the Super Admin account
3. **Dual Update**: This endpoint updates BOTH:
   - `credentials` table (plaintext password for reference)
   - `auth.users` table (hashed password via Supabase Auth)

**Response** (200 OK):

```json
{
  "success": true,
  "message": "Password successfully updated for organization: LAPO MFB GBONGAN"
}
```

**Error Response - Invalid Super Admin Password** (400 Bad Request):

```json
{
  "success": false,
  "error": "Invalid Super Admin password. Authorization denied."
}
```

**Error Response - Organization Not Found** (400 Bad Request):

```json
{
  "success": false,
  "error": "Credential not found for this partner"
}
```

---

### 5. Generate Secure Password (Helper Endpoint)

Generate a secure random password. This is a helper endpoint for the frontend to generate strong passwords.

**Endpoint**: `POST /manage-credentials/generate-password`

**Headers**:

```http
Authorization: Bearer [super_admin_jwt_token]
Content-Type: application/json
```

**Request Body** (Optional):

```json
{
  "length": 16
}
```

**Request Fields**:

- `length` (optional): Length of the password (default: 16, recommended: 12-20)

**Response** (200 OK):

```json
{
  "success": true,
  "password": "aB3d5FgH9!kL2pQ7"
}
```

---

## React Implementation Examples

### Example 1: Fetch All Credentials

```typescript
import { useState, useEffect } from "react";

interface Credential {
  id: string;
  partner_id: string;
  partner_name: string;
  email: string;
  password: string;
  organization_id: string;
  user_id: string;
  is_dummy_email: boolean;
  created_at: string;
  updated_at: string;
  organizations: {
    partner_name: string;
    email: string;
    contact_person: string;
    contact_phone: string;
    state: string;
    branch: string;
  };
}

function CredentialsList() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCredentials();
  }, []);

  const fetchCredentials = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("supabase_auth_token"); // Get from your auth state

      const response = await fetch(
        "https://[your-project-ref].supabase.co/functions/v1/manage-credentials",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error);
      }

      setCredentials(data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h2>All Organization Credentials ({credentials.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Partner ID</th>
            <th>Organization</th>
            <th>Email</th>
            <th>Password</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {credentials.map((cred) => (
            <tr key={cred.id}>
              <td>{cred.partner_id}</td>
              <td>{cred.partner_name}</td>
              <td>{cred.email}</td>
              <td>
                <code>{cred.password}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(cred.password)}
                >
                  Copy
                </button>
              </td>
              <td>
                <button onClick={() => handleResetPassword(cred.partner_id)}>
                  Reset Password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

### Example 2: Reset Organization Password with Super Admin Verification

```typescript
import { useState } from "react";

interface ResetPasswordFormProps {
  partnerId: string;
  partnerName: string;
  onSuccess: () => void;
}

function ResetPasswordForm({
  partnerId,
  partnerName,
  onSuccess,
}: ResetPasswordFormProps) {
  const [newPassword, setNewPassword] = useState("");
  const [superAdminPassword, setSuperAdminPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("supabase_auth_token");
      const superAdminEmail = localStorage.getItem("user_email"); // Get from your auth state

      const response = await fetch(
        "https://[your-project-ref].supabase.co/functions/v1/manage-credentials/update-password",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            partner_id: partnerId,
            new_password: newPassword,
            super_admin_email: superAdminEmail,
            super_admin_password: superAdminPassword, // Super Admin must enter their password
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error);
      }

      alert(data.message);
      setSuperAdminPassword(""); // Clear sensitive data
      setNewPassword("");
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const generatePassword = async () => {
    try {
      const token = localStorage.getItem("supabase_auth_token");

      const response = await fetch(
        "https://[your-project-ref].supabase.co/functions/v1/manage-credentials/generate-password",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ length: 16 }),
        }
      );

      const data = await response.json();
      if (data.success) {
        setNewPassword(data.password);
      }
    } catch (err) {
      console.error("Failed to generate password:", err);
    }
  };

  return (
    <form onSubmit={handleResetPassword}>
      <h3>Reset Password for {partnerName}</h3>

      {error && <div className="error">{error}</div>}

      <div>
        <label>New Password for Organization:</label>
        <input
          type="text"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          placeholder="Enter new password"
        />
        <button type="button" onClick={generatePassword}>
          Generate Secure Password
        </button>
      </div>

      <div>
        <label>Your Password (Super Admin Verification):</label>
        <input
          type="password"
          value={superAdminPassword}
          onChange={(e) => setSuperAdminPassword(e.target.value)}
          required
          placeholder="Enter your password to authorize"
        />
        <small>
          ⚠️ You must enter your own password to reset another user's password
        </small>
      </div>

      <button type="submit" disabled={loading}>
        {loading ? "Resetting..." : "Reset Password"}
      </button>
    </form>
  );
}
```

---

### Example 3: Complete Modal Component

```typescript
import { useState } from "react";
import Modal from "./Modal"; // Your modal component

function CredentialsManagement() {
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<{
    partnerId: string;
    name: string;
  } | null>(null);

  const openResetModal = (partnerId: string, name: string) => {
    setSelectedOrg({ partnerId, name });
    setShowResetModal(true);
  };

  return (
    <div>
      {/* Your credentials table */}
      <button onClick={() => openResetModal("598581", "LAPO MFB GBONGAN")}>
        Reset Password
      </button>

      {showResetModal && selectedOrg && (
        <Modal onClose={() => setShowResetModal(false)}>
          <ResetPasswordForm
            partnerId={selectedOrg.partnerId}
            partnerName={selectedOrg.name}
            onSuccess={() => {
              setShowResetModal(false);
              // Refresh credentials list
            }}
          />
        </Modal>
      )}
    </div>
  );
}
```

---

## Security Notes for Frontend Developers

### 1. Super Admin Password Verification

The password reset endpoint requires the Super Admin to enter their own password. This is a security feature that:

- **Prevents unauthorized changes**: Even if someone gains access to a Super Admin's session, they cannot reset passwords without knowing the actual password
- **Provides audit trail**: The system verifies the Super Admin's identity before making critical changes
- **Best practice**: Always prompt the user to enter their password for sensitive operations

### 2. Handle Passwords Securely

```typescript
// ✅ DO: Clear password fields after use
setSuperAdminPassword("");

// ✅ DO: Use password input type
<input type="password" />;

// ✅ DO: Show password requirements
const isValidPassword = (pwd: string) => pwd.length >= 12;

// ❌ DON'T: Log passwords
console.log(password); // Never do this!

// ❌ DON'T: Store passwords in state longer than needed
```

### 3. Error Handling

Always handle these specific errors:

```typescript
if (data.error === "Invalid Super Admin password. Authorization denied.") {
  // Show error: "Incorrect password. Please try again."
}

if (data.error === "Credential not found for this partner") {
  // Show error: "Organization not found."
}

if (
  data.error === "Access denied. Only Super Admin can access this resource."
) {
  // Redirect to unauthorized page or show error
}
```

---

## Testing

### Using cURL

**Get all credentials**:

```bash
curl -X GET \
  'https://[your-project-ref].supabase.co/functions/v1/manage-credentials' \
  -H 'Authorization: Bearer [super_admin_token]' \
  -H 'Content-Type: application/json'
```

**Reset password**:

```bash
curl -X PUT \
  'https://[your-project-ref].supabase.co/functions/v1/manage-credentials/update-password' \
  -H 'Authorization: Bearer [super_admin_token]' \
  -H 'Content-Type: application/json' \
  -d '{
    "partner_id": "598581",
    "new_password": "NewP@ssw0rd123",
    "super_admin_email": "admin@acsl.com",
    "super_admin_password": "YourCurrentPassword"
  }'
```

---

## Rate Limiting & Best Practices

1. **Cache credentials list**: Don't fetch on every render
2. **Debounce search**: If implementing search functionality
3. **Confirm before reset**: Always show confirmation dialog
4. **Show loading states**: Password reset can take 2-3 seconds
5. **Handle network errors**: Implement retry logic

---

## Support

For issues or questions, contact the backend team or refer to the Supabase Edge Functions documentation.
