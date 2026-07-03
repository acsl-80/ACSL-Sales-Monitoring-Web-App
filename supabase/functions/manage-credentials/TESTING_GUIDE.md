# Quick Testing Guide - Manage Credentials API

## Prerequisites

Before testing, you need:

1. **Super Admin JWT Token**: Log in as Super Admin and get the auth token
2. **Super Admin Email & Password**: Your actual login credentials
3. **Partner ID**: ID of an organization with credentials (e.g., `598581`)

---

## How to Get Your Super Admin Token

### Method 1: From Browser (Easiest)

1. Log in to your app as Super Admin
2. Open browser DevTools (F12)
3. Go to **Application** tab → **Local Storage**
4. Look for key containing "supabase" and "auth"
5. Copy the JWT token value

### Method 2: From Supabase Dashboard

1. Go to Supabase Dashboard → Authentication → Users
2. Find your Super Admin user
3. Click "Send magic link" or use password reset
4. Get token from login response

---

## Test Endpoint 1: Get All Credentials

### cURL Command

```bash
curl -X GET \
  'https://oeiwnpngbnkhcismhpgs.supabase.co/functions/v1/manage-credentials' \
  -H 'Authorization: Bearer YOUR_TOKEN_HERE' \
  -H 'Content-Type: application/json'
```

### Expected Success Response

```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "id": "uuid",
      "partner_id": "598581",
      "partner_name": "LAPO MFB GBONGAN",
      "email": "lapo_mfb_gbongan_598581@atmosfair.site",
      "password": "aB3d5FgH9!kL",
      "is_dummy_email": true,
      "created_at": "2025-11-06T10:30:00Z",
      "updated_at": "2025-11-06T10:30:00Z"
    }
  ]
}
```

### Expected Error (if not Super Admin)

```json
{
  "success": false,
  "error": "Access denied. Only Super Admin can access this resource."
}
```

---

## Test Endpoint 2: Get Credential by Partner ID

### cURL Command

```bash
curl -X GET \
  'https://oeiwnpngbnkhcismhpgs.supabase.co/functions/v1/manage-credentials?partner_id=598581' \
  -H 'Authorization: Bearer YOUR_TOKEN_HERE' \
  -H 'Content-Type: application/json'
```

### Expected Success Response

```json
{
  "success": true,
  "data": {
    "partner_id": "598581",
    "partner_name": "LAPO MFB GBONGAN",
    "email": "lapo_mfb_gbongan_598581@atmosfair.site",
    "password": "aB3d5FgH9!kL"
  }
}
```

---

## Test Endpoint 3: Reset Password (Critical Test)

### Step 1: Generate a New Password

```bash
curl -X POST \
  'https://oeiwnpngbnkhcismhpgs.supabase.co/functions/v1/manage-credentials/generate-password' \
  -H 'Authorization: Bearer YOUR_TOKEN_HERE' \
  -H 'Content-Type: application/json' \
  -d '{"length": 16}'
```

**Response**:

```json
{
  "success": true,
  "password": "aB3d5FgH9!kL2pQ7"
}
```

Copy this generated password for the next step.

### Step 2: Reset Organization Password

**⚠️ IMPORTANT**: Replace these values:

- `YOUR_TOKEN_HERE` → Your Super Admin JWT token
- `598581` → Partner ID to reset
- `aB3d5FgH9!kL2pQ7` → New password (from Step 1)
- `admin@acsl.com` → Your Super Admin email
- `YourActualPassword` → **Your current Super Admin password**

```bash
curl -X PUT \
  'https://oeiwnpngbnkhcismhpgs.supabase.co/functions/v1/manage-credentials/update-password' \
  -H 'Authorization: Bearer YOUR_TOKEN_HERE' \
  -H 'Content-Type: application/json' \
  -d '{
    "partner_id": "598581",
    "new_password": "aB3d5FgH9!kL2pQ7",
    "super_admin_email": "admin@acsl.com",
    "super_admin_password": "YourActualPassword"
  }'
```

### Expected Success Response

```json
{
  "success": true,
  "message": "Password successfully updated for organization: LAPO MFB GBONGAN"
}
```

### Expected Error (Wrong Super Admin Password)

```json
{
  "success": false,
  "error": "Invalid Super Admin password. Authorization denied."
}
```

### Step 3: Verify Password Was Changed

Try logging in as the organization user with the **new password**:

```bash
curl -X POST \
  'https://oeiwnpngbnkhcismhpgs.supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "lapo_mfb_gbongan_598581@atmosfair.site",
    "password": "aB3d5FgH9!kL2pQ7"
  }'
```

If successful, you'll get an access token back!

---

## Test Scenarios

### Scenario 1: Successful Password Reset Flow

1. ✅ Get all credentials → Find partner_id
2. ✅ Generate new password
3. ✅ Reset password with correct Super Admin password
4. ✅ Verify organization can log in with new password

### Scenario 2: Security Validation

1. ✅ Try to access without token → 401 Unauthorized
2. ✅ Try to access with regular admin token → 401 Access Denied
3. ✅ Try to reset password with wrong Super Admin password → 400 Invalid password
4. ✅ Try to reset non-existent partner → 404 Not Found

### Scenario 3: Edge Cases

1. ✅ Reset password for organization with real email (not dummy)
2. ✅ Generate multiple passwords (should be different each time)
3. ✅ Try to get credential with invalid partner_id → 404

---

## Postman Collection

Import this JSON into Postman:

```json
{
  "info": {
    "name": "Manage Credentials API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "base_url",
      "value": "https://oeiwnpngbnkhcismhpgs.supabase.co/functions/v1"
    },
    {
      "key": "auth_token",
      "value": "YOUR_SUPER_ADMIN_TOKEN"
    },
    {
      "key": "super_admin_email",
      "value": "admin@acsl.com"
    }
  ],
  "item": [
    {
      "name": "Get All Credentials",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{auth_token}}"
          }
        ],
        "url": "{{base_url}}/manage-credentials"
      }
    },
    {
      "name": "Get Credential by Partner ID",
      "request": {
        "method": "GET",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{auth_token}}"
          }
        ],
        "url": {
          "raw": "{{base_url}}/manage-credentials?partner_id=598581",
          "query": [
            {
              "key": "partner_id",
              "value": "598581"
            }
          ]
        }
      }
    },
    {
      "name": "Generate Password",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{auth_token}}"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"length\": 16\n}"
        },
        "url": "{{base_url}}/manage-credentials/generate-password"
      }
    },
    {
      "name": "Reset Password",
      "request": {
        "method": "PUT",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{auth_token}}"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"partner_id\": \"598581\",\n  \"new_password\": \"NewP@ssw0rd123\",\n  \"super_admin_email\": \"{{super_admin_email}}\",\n  \"super_admin_password\": \"YOUR_PASSWORD_HERE\"\n}"
        },
        "url": "{{base_url}}/manage-credentials/update-password"
      }
    }
  ]
}
```

---

## Common Issues & Solutions

### Issue 1: 401 Unauthorized

**Cause**: Invalid or expired token

**Solution**:

- Get a fresh token by logging in again
- Make sure you're logged in as Super Admin
- Check token hasn't expired (tokens expire after 1 hour by default)

### Issue 2: "Access denied. Only Super Admin can access"

**Cause**: User role is not `super_admin`

**Solution**:

- Verify in Supabase Dashboard → Authentication → Users
- Check the `profiles` table for the user's role
- Update role to `super_admin` if needed

### Issue 3: "Invalid Super Admin password"

**Cause**: Wrong password provided in `super_admin_password` field

**Solution**:

- Double-check you're using YOUR current Super Admin password
- Not the organization's password
- Not a new password
- Your actual login password

### Issue 4: "Credential not found for this partner"

**Cause**: Partner ID doesn't exist in credentials table

**Solution**:

- Run GET /manage-credentials to see all available partner IDs
- Use a valid partner_id from the list
- Make sure the organization was synced via external-sync API

---

## Verification Checklist

After testing, verify:

- [ ] Can fetch all credentials as Super Admin
- [ ] Cannot access as regular admin/agent
- [ ] Can generate secure random passwords
- [ ] Can reset password with correct Super Admin password
- [ ] Cannot reset password with wrong Super Admin password
- [ ] Organization can log in with new password after reset
- [ ] Credentials table shows updated password
- [ ] Auth works with new password
- [ ] Error messages are clear and helpful

---

## Supabase Logs

To view logs and debug issues:

1. Go to Supabase Dashboard
2. Click **Edge Functions** in sidebar
3. Click **manage-credentials**
4. Click **Logs** tab
5. Look for:
   - 🔐 Password verification logs
   - ✅ Success messages
   - ❌ Error messages
   - 📋 Operation logs

---

## Next Steps

Once testing is complete:

1. ✅ Confirm all endpoints work
2. ✅ Share `API_DOCUMENTATION.md` with frontend developer
3. ✅ Provide them with Super Admin test credentials
4. ✅ Review security requirements with them
5. ✅ Set up proper error handling in frontend

---

## Support

For issues:

1. Check Supabase logs for detailed error messages
2. Verify authentication token is valid
3. Confirm Super Admin role in profiles table
4. Check partner_id exists in credentials table

**All tests passing? You're ready to send API docs to your frontend developer!** 🎉
