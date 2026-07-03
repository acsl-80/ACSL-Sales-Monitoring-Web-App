# Get Sale Edge Function Documentation

## Overview

The `get-sale` edge function retrieves a single sale record from the database. It supports three different lookup methods and includes proper authentication and authorization.

## Endpoint

```
POST /functions/v1/get-sale
```

## Authentication

- **Required**: Yes
- **Method**: Bearer token in Authorization header
- **Permissions**: Users can only access sales from their organization (unless they're super admin)

## Query Parameters (Choose ONE)

| Parameter         | Type   | Description                | Example                                    |
| ----------------- | ------ | -------------------------- | ------------------------------------------ |
| `id`              | UUID   | Sale's unique identifier   | `?id=123e4567-e89b-12d3-a456-426614174000` |
| `transaction_id`  | String | Transaction ID of the sale | `?transaction_id=TXN001`                   |
| `stove_serial_no` | String | Stove serial number        | `?stove_serial_no=STV001`                  |

**Note**: You must provide exactly ONE of these parameters. If none or multiple are provided, you'll get a 400 error.

## Response Format

### Success Response (200)

```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "transaction_id": "TXN001",
    "stove_serial_no": "STV001",
    "customer_name": "John Doe",
    "customer_phone": "1234567890",
    "total_price": 50000,
    "status": "completed",
    "created_at": "2024-01-15T10:30:00Z",
    "organization_id": "org-123",
    "agent_id": "agent-456",
    "address": {
      "id": "addr-789",
      "street": "123 Main St",
      "city": "Springfield",
      "state": "IL",
      "postal_code": "62701"
    },
    "stove_image": {
      "id": "img-001",
      "file_url": "https://storage.supabase.co/...",
      "file_name": "stove_photo.jpg"
    },
    "agreement_image": {
      "id": "img-002",
      "file_url": "https://storage.supabase.co/...",
      "file_name": "agreement.pdf"
    }
  }
}
```

### Error Responses

**Missing Parameters (400)**

```json
{
  "success": false,
  "message": "Missing required parameter: id, transaction_id, or stove_serial_no"
}
```

**Unauthorized (401)**

```json
{
  "success": false,
  "message": "Unauthorized"
}
```

**Sale Not Found (404)**

```json
{
  "success": false,
  "message": "Sale not found or access denied",
  "error": "..."
}
```

**Server Error (500)**

```json
{
  "success": false,
  "message": "Unexpected error",
  "error": "Error details..."
}
```

## React/TypeScript Example

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL!,
  process.env.REACT_APP_SUPABASE_ANON_KEY!
);

// Interface for the response
interface SaleResponse {
  success: boolean;
  data?: {
    id: string;
    transaction_id: string;
    stove_serial_no: string;
    customer_name: string;
    customer_phone: string;
    total_price: number;
    status: string;
    created_at: string;
    organization_id: string;
    agent_id: string;
    address?: {
      id: string;
      street: string;
      city: string;
      state: string;
      postal_code: string;
    };
    stove_image?: {
      id: string;
      file_url: string;
      file_name: string;
    };
    agreement_image?: {
      id: string;
      file_url: string;
      file_name: string;
    };
  };
  message?: string;
  error?: any;
}

// Service class for API calls
class SaleService {
  // Get sale by UUID
  static async getSaleById(saleId: string): Promise<SaleResponse> {
    try {
      const { data, error } = await supabase.functions.invoke("get-sale", {
        body: {},
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error fetching sale by ID:", error);
      return { success: false, message: "Failed to fetch sale" };
    }
  }

  // Get sale by transaction ID
  static async getSaleByTransactionId(
    transactionId: string
  ): Promise<SaleResponse> {
    try {
      const response = await fetch(
        `${
          process.env.REACT_APP_SUPABASE_URL
        }/functions/v1/get-sale?transaction_id=${encodeURIComponent(
          transactionId
        )}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${
              (
                await supabase.auth.getSession()
              ).data.session?.access_token
            }`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      return await response.json();
    } catch (error) {
      console.error("Error fetching sale by transaction ID:", error);
      return { success: false, message: "Failed to fetch sale" };
    }
  }

  // Get sale by stove serial number
  static async getSaleByStoveSerial(
    stoveSerialNo: string
  ): Promise<SaleResponse> {
    try {
      const response = await fetch(
        `${
          process.env.REACT_APP_SUPABASE_URL
        }/functions/v1/get-sale?stove_serial_no=${encodeURIComponent(
          stoveSerialNo
        )}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${
              (
                await supabase.auth.getSession()
              ).data.session?.access_token
            }`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      return await response.json();
    } catch (error) {
      console.error("Error fetching sale by stove serial:", error);
      return { success: false, message: "Failed to fetch sale" };
    }
  }
}

// React component example
const SaleDetailsComponent: React.FC = () => {
  const [sale, setSale] = useState<SaleResponse["data"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSale = async (transactionId: string) => {
    setLoading(true);
    setError(null);

    const response = await SaleService.getSaleByTransactionId(transactionId);

    if (response.success && response.data) {
      setSale(response.data);
    } else {
      setError(response.message || "Failed to fetch sale");
    }

    setLoading(false);
  };

  useEffect(() => {
    // Example: fetch sale with transaction ID "TXN001"
    fetchSale("TXN001");
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!sale) return <div>No sale found</div>;

  return (
    <div>
      <h2>Sale Details</h2>
      <p>
        <strong>Transaction ID:</strong> {sale.transaction_id}
      </p>
      <p>
        <strong>Customer:</strong> {sale.customer_name}
      </p>
      <p>
        <strong>Phone:</strong> {sale.customer_phone}
      </p>
      <p>
        <strong>Total Price:</strong> ${sale.total_price}
      </p>
      <p>
        <strong>Status:</strong> {sale.status}
      </p>

      {sale.address && (
        <div>
          <h3>Address</h3>
          <p>
            {sale.address.street}, {sale.address.city}, {sale.address.state}{" "}
            {sale.address.postal_code}
          </p>
        </div>
      )}

      {sale.stove_image && (
        <div>
          <h3>Stove Image</h3>
          <img
            src={sale.stove_image.file_url}
            alt="Stove"
            style={{ maxWidth: "300px" }}
          />
        </div>
      )}
    </div>
  );
};

export default SaleDetailsComponent;
```

## Key Features

1. **Flexible Lookup**: Find sales by UUID, transaction ID, or stove serial number
2. **Security**: Organization-based access control (users only see their org's sales)
3. **Rich Data**: Returns sale with related address and image data
4. **Super Admin**: Super admins can access all sales across organizations
5. **Error Handling**: Comprehensive error responses for different scenarios

## Use Cases

- **Customer Support**: Look up sales by transaction ID when customers call
- **Field Service**: Find sales by stove serial number for maintenance
- **Admin Dashboard**: Get detailed sale information by UUID
- **Mobile App**: Quick sale lookup using any available identifier
