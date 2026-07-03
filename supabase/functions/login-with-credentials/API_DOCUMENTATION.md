# Login with Credentials API

## Overview

Flexible authentication endpoint that supports login with **EITHER username OR email** + password. The function automatically detects the identifier type and handles authentication appropriately.

## Endpoint

```
POST https://YOUR_PROJECT.supabase.co/functions/v1/login-with-credentials
```

## Authentication

- **No authorization header required** (public endpoint)
- This IS the authentication endpoint

## Request Body

```json
{
  "identifier": "string", // Username OR Email
  "password": "string" // Password
}
```

### Identifier Detection

- **Email**: If identifier contains `@` character, treated as email
- **Username**: If no `@` present, treated as username

### Examples

```json
// Login with username
{
  "identifier": "lapo_mfb_gbongan_598581",
  "password": "SecurePassword123!"
}

// Login with email
{
  "identifier": "admin@acsl.com",
  "password": "AdminPassword123!"
}
```

## Success Response (200 OK)

```json
{
  "success": true,
  "session": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "v1.MRjVCra...",
    "expires_in": 3600,
    "token_type": "bearer",
    "user": {
      "id": "uuid",
      "email": "user@domain.com",
      "role": "authenticated"
    }
  },
  "user": {
    "id": "uuid",
    "username": "lapo_mfb_gbongan_598581", // Present for username users
    "email": "admin@acsl.com", // Present for email users (undefined for username users)
    "full_name": "Lapo MFB Gbongan",
    "role": "Agent",
    "organization_id": "org-uuid",
    "has_changed_password": false,
    "display_name": "lapo_mfb_gbongan_598581" // For UI display
  }
}
```

### Response Fields

- **session**: Supabase Auth session with tokens
  - `access_token`: JWT for authenticated requests
  - `refresh_token`: Token to refresh session
  - `expires_in`: Token expiry in seconds
- **user**: User profile data
  - `username`: Only present if user logged in with username
  - `email`: Only present if user logged in with email (hidden for username users)
  - `display_name`: Username or email prefix for UI display
  - Other profile fields

## Error Responses

### 400 Bad Request - Missing Credentials

```json
{
  "success": false,
  "error": "Both identifier (username or email) and password are required"
}
```

### 401 Unauthorized - Invalid Credentials

```json
{
  "success": false,
  "error": "Invalid username or password"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "error": "An unexpected error occurred"
}
```

## Usage Flow

### 1. Username Login

```
User enters: "lapo_mfb_gbongan_598581" + password
↓
Function detects no '@' → treats as username
↓
Looks up email from profiles.username
↓
Authenticates with Supabase Auth using found email
↓
Returns session + user data (email hidden, username shown)
```

### 2. Email Login

```
User enters: "admin@acsl.com" + password
↓
Function detects '@' → treats as email
↓
Authenticates directly with Supabase Auth
↓
Returns session + user data (email shown, username if available)
```

## Internal Email Format

For username-based users, an internal email is stored as:

```
username@internal.acsl.local
```

This email is **NEVER exposed** in API responses. Users only see their username.

## Security Notes

1. Passwords are **never** returned in responses
2. Failed login attempts return generic error message (no hint if username/email exists)
3. Internal emails are hidden from username-based users
4. Session tokens should be stored securely on client
5. Use refresh token to renew sessions before expiry

## Frontend Integration Example (React)

### Login Component

```typescript
import { useState } from "react";

interface LoginResponse {
  success: boolean;
  session?: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  user?: {
    id: string;
    username?: string;
    email?: string;
    full_name: string;
    role: string;
    display_name: string;
  };
  error?: string;
}

const Login = () => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        "https://YOUR_PROJECT.supabase.co/functions/v1/login-with-credentials",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            identifier: identifier.trim(),
            password,
          }),
        }
      );

      const data: LoginResponse = await response.json();

      if (data.success && data.session && data.user) {
        // Store session tokens
        localStorage.setItem("access_token", data.session.access_token);
        localStorage.setItem("refresh_token", data.session.refresh_token);
        localStorage.setItem("user", JSON.stringify(data.user));

        // Redirect or update app state
        console.log("Login successful:", data.user.display_name);
        // window.location.href = '/dashboard';
      } else {
        setError(data.error || "Login failed");
      }
    } catch (err) {
      setError("Network error. Please try again.");
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleLogin}>
      <input
        type="text"
        placeholder="Username or Email"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <div className="error">{error}</div>}
      <button type="submit" disabled={loading}>
        {loading ? "Logging in..." : "Login"}
      </button>
    </form>
  );
};

export default Login;
```

## Testing

### Test with Username

```bash
curl -X POST \
  https://YOUR_PROJECT.supabase.co/functions/v1/login-with-credentials \
  -H 'Content-Type: application/json' \
  -d '{
    "identifier": "lapo_mfb_gbongan_598581",
    "password": "YourPassword123!"
  }'
```

### Test with Email

```bash
curl -X POST \
  https://YOUR_PROJECT.supabase.co/functions/v1/login-with-credentials \
  -H 'Content-Type: application/json' \
  -d '{
    "identifier": "admin@acsl.com",
    "password": "AdminPassword123!"
  }'
```

## Migration Notes

- **Existing Users**: Users with real emails continue using email login
- **New Synced Users**: Users without valid emails get usernames
- **Backward Compatible**: Both login methods work simultaneously
- **UI Update**: Change "Email" label to "Username or Email"

## Related Documentation

- `manage-credentials/API_DOCUMENTATION.md` - Credential management endpoints
- `external-sync/` - Organization sync endpoint
- `add-username-support.sql` - Database migration script
