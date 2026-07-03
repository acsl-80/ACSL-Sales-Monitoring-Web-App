
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Copy,
  ExternalLink,
  Search,
  CheckCircle,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const GetSaleDocumentation = () => {
  const [selectedLookupMethod, setSelectedLookupMethod] =
    useState("transaction_id");
  const [inputValue, setInputValue] = useState("");
  const [copiedCode, setCopiedCode] = useState(null);

  const copyToClipboard = (text, codeType) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(codeType);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const lookupMethods = [
    {
      key: "id",
      label: "Sale UUID",
      placeholder: "123e4567-e89b-12d3-a456-426614174000",
      description: "Unique identifier for the sale record",
    },
    {
      key: "transaction_id",
      label: "Transaction ID",
      placeholder: "TXN001",
      description: "Transaction identifier from the sale",
    },
    {
      key: "stove_serial_no",
      label: "Stove Serial Number",
      placeholder: "STV001",
      description: "Serial number of the stove",
    },
  ];

  const generateRequestCode = () => {
    const method = selectedLookupMethod;
    const value =
      inputValue || lookupMethods.find((m) => m.key === method)?.placeholder;

    return `// Method ${
      method === "id" ? "1" : method === "transaction_id" ? "2" : "3"
    }: Get sale by ${lookupMethods.find((m) => m.key === method)?.label}
const response = await fetch(
  \`\${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-sale?${method}=\${encodeURIComponent('${value}')}\`,
  {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${token}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  }
);

const result = await response.json();
if (result.success) {
  console.log('Sale found:', result.data);
} else {
  console.error('Error:', result.message);
}`;
  };

  const generateServiceCode = () => {
    return `// Service class implementation
class SaleService {
  static async getSaleById(saleId: string): Promise<SaleResponse> {
    try {
      const response = await fetch(
        \`\${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-sale?id=\${encodeURIComponent(saleId)}\`,
        {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${token}\`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      return await response.json();
    } catch (error) {
      console.error('Error fetching sale by ID:', error);
      return { success: false, message: 'Failed to fetch sale' };
    }
  }

  static async getSaleByTransactionId(transactionId: string): Promise<SaleResponse> {
    try {
      const response = await fetch(
        \`\${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-sale?transaction_id=\${encodeURIComponent(transactionId)}\`,
        {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${token}\`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      return await response.json();
    } catch (error) {
      console.error('Error fetching sale by transaction ID:', error);
      return { success: false, message: 'Failed to fetch sale' };
    }
  }

  static async getSaleByStoveSerial(stoveSerialNo: string): Promise<SaleResponse> {
    try {
      const response = await fetch(
        \`\${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-sale?stove_serial_no=\${encodeURIComponent(stoveSerialNo)}\`,
        {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${token}\`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      return await response.json();
    } catch (error) {
      console.error('Error fetching sale by stove serial:', error);
      return { success: false, message: 'Failed to fetch sale' };
    }
  }
}`;
  };

  const sampleResponse = {
    success: true,
    data: {
      id: "123e4567-e89b-12d3-a456-426614174000",
      transaction_id: "TXN001",
      stove_serial_no: "STV001",
      customer_name: "John Doe",
      customer_phone: "1234567890",
      total_price: 50000,
      status: "completed",
      created_at: "2024-01-15T10:30:00Z",
      organization_id: "org-123",
      agent_id: "agent-456",
      address: {
        id: "addr-789",
        street: "123 Main St",
        city: "Springfield",
        state: "IL",
        postal_code: "62701",
      },
      stove_image: {
        id: "img-001",
        file_url: "https://storage.supabase.co/bucket/stove_images/example.jpg",
        file_name: "stove_photo.jpg",
      },
      agreement_image: {
        id: "img-002",
        file_url: "https://storage.supabase.co/bucket/agreements/example.pdf",
        file_name: "agreement.pdf",
      },
    },
  };

  const errorExamples = [
    {
      type: "Missing Parameters (400)",
      response: {
        success: false,
        message:
          "Missing required parameter: id, transaction_id, or stove_serial_no",
      },
    },
    {
      type: "Unauthorized (401)",
      response: {
        success: false,
        message: "Unauthorized",
      },
    },
    {
      type: "Sale Not Found (404)",
      response: {
        success: false,
        message: "Sale not found or access denied",
        error: "No sale found with the provided identifier",
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl flex items-center gap-2">
            <Search className="h-6 w-6" />
            Get Sale Endpoint Documentation
          </CardTitle>
          <p className="text-muted-foreground">
            Retrieve detailed sale information using flexible lookup methods.
            This endpoint supports lookup by UUID, transaction ID, or stove
            serial number.
          </p>
        </CardHeader>
      </Card>

      {/* Interactive Example */}
      <Card>
        <CardHeader>
          <CardTitle>Interactive Request Builder</CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure your request parameters and see the generated code
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Lookup Method Selection */}
          <div className="space-y-2">
            <Label>Lookup Method</Label>
            <Tabs
              value={selectedLookupMethod}
              onValueChange={setSelectedLookupMethod}
            >
              <TabsList className="grid grid-cols-3 w-full">
                {lookupMethods.map((method) => (
                  <TabsTrigger key={method.key} value={method.key}>
                    {method.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {/* Input Field */}
          <div className="space-y-2">
            <Label htmlFor="lookup-value">
              {lookupMethods.find((m) => m.key === selectedLookupMethod)?.label}
            </Label>
            <Input
              id="lookup-value"
              placeholder={
                lookupMethods.find((m) => m.key === selectedLookupMethod)
                  ?.placeholder
              }
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {
                lookupMethods.find((m) => m.key === selectedLookupMethod)
                  ?.description
              }
            </p>
          </div>

          {/* Generated Request */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Generated Request Code</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  copyToClipboard(generateRequestCode(), "request")
                }
              >
                <Copy className="h-4 w-4 mr-2" />
                {copiedCode === "request" ? "Copied!" : "Copy"}
              </Button>
            </div>
            <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
              {generateRequestCode()}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Endpoint Details */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="parameters">Parameters</TabsTrigger>
          <TabsTrigger value="responses">Responses</TabsTrigger>
          <TabsTrigger value="examples">Code Examples</TabsTrigger>
          <TabsTrigger value="errors">Error Handling</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Endpoint Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-semibold mb-2">Endpoint Details</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">POST</Badge>
                      <code>/functions/v1/get-sale</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Auth Required</Badge>
                      <span className="text-muted-foreground">
                        Bearer Token
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Key Features</h4>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• Flexible lookup methods</li>
                    <li>• Organization-based access control</li>
                    <li>• Rich data with related objects</li>
                    <li>• Super admin cross-org access</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Important:</strong> You must provide exactly ONE lookup
              parameter. Providing none or multiple parameters will result in a
              400 error.
            </AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent value="parameters" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Request Parameters</CardTitle>
              <p className="text-sm text-muted-foreground">
                Choose exactly one parameter for your lookup
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {lookupMethods.map((method, index) => (
                  <div key={method.key} className="border rounded p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline">Option {index + 1}</Badge>
                      <code className="text-sm">{method.key}</code>
                    </div>
                    <h4 className="font-semibold">{method.label}</h4>
                    <p className="text-sm text-muted-foreground mb-2">
                      {method.description}
                    </p>
                    <div className="bg-muted p-2 rounded text-xs">
                      <strong>Example:</strong> {method.placeholder}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="responses" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                Success Response (200)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Response Structure</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(
                        JSON.stringify(sampleResponse, null, 2),
                        "response"
                      )
                    }
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    {copiedCode === "response" ? "Copied!" : "Copy JSON"}
                  </Button>
                </div>
                <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                  {JSON.stringify(sampleResponse, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="examples" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Service Class Implementation</CardTitle>
              <p className="text-sm text-muted-foreground">
                Complete TypeScript service class for all lookup methods
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>TypeScript Service Class</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(generateServiceCode(), "service")
                    }
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    {copiedCode === "service" ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <pre className="bg-muted p-4 rounded text-xs overflow-x-auto max-h-96">
                  {generateServiceCode()}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors" className="space-y-4">
          {errorExamples.map((error, index) => (
            <Card key={index}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600">
                  <XCircle className="h-5 w-5" />
                  {error.type}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                  {JSON.stringify(error.response, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Use Cases */}
      <Card>
        <CardHeader>
          <CardTitle>Common Use Cases</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="font-semibold">Customer Support</h4>
              <p className="text-sm text-muted-foreground">
                Look up sales by transaction ID when customers call for support
                or inquiries.
              </p>

              <h4 className="font-semibold">Field Service</h4>
              <p className="text-sm text-muted-foreground">
                Find sales by stove serial number for maintenance, repairs, or
                warranty claims.
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold">Admin Dashboard</h4>
              <p className="text-sm text-muted-foreground">
                Get detailed sale information by UUID for administrative tasks
                and reporting.
              </p>

              <h4 className="font-semibold">Mobile Applications</h4>
              <p className="text-sm text-muted-foreground">
                Quick sale lookup using any available identifier for mobile
                field agents.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GetSaleDocumentation;
