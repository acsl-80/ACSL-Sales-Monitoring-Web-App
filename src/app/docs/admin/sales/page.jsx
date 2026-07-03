
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ShoppingCart,
  Search,
  Plus,
  Edit,
  Upload,
  BarChart3,
} from "lucide-react";
import GetSaleDocumentation from "../../components/GetSaleDocumentation";

const AdminSalesDocumentation = () => {
  const salesEndpoints = [
    {
      name: "Get Sale",
      icon: Search,
      endpoint: "/functions/v1/get-sale",
      method: "POST",
      description:
        "Retrieve detailed information about a specific sale using flexible lookup methods",
      isNew: true,
      features: [
        "Lookup by UUID, transaction ID, or stove serial number",
        "Organization-based access control",
        "Rich data with address and image information",
        "Super admin cross-organization access",
      ],
    },
    {
      name: "Get Sales Advanced",
      icon: BarChart3,
      endpoint: "/functions/v1/get-sales-advanced",
      method: "POST",
      description:
        "Advanced sales data retrieval with filtering and pagination",
      features: [
        "Organization-scoped data access",
        "Comprehensive filtering options",
        "Pagination support",
        "Format 2 (Database Format) response",
      ],
    },
    {
      name: "Create Sale",
      icon: Plus,
      endpoint: "/functions/v1/create-sale",
      method: "POST",
      description:
        "Create new sale records with customer and stove information",
      features: [
        "Customer information capture",
        "Stove assignment",
        "Payment method tracking",
        "Agent assignment",
      ],
    },
    {
      name: "Update Sale",
      icon: Edit,
      endpoint: "/functions/v1/update-sale",
      method: "POST",
      description: "Update existing sale records",
      features: [
        "Modify customer details",
        "Update sale status",
        "Price adjustments",
        "Notes management",
      ],
    },
    {
      name: "Upload Image",
      icon: Upload,
      endpoint: "/functions/v1/upload-image",
      method: "POST",
      description: "Upload stove and agreement images",
      features: [
        "Base64 image upload",
        "Automatic file organization",
        "Secure cloud storage",
        "URL generation",
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <ShoppingCart className="h-8 w-8 text-blue-600" />
            <h1 className="text-4xl font-bold">Sales Management API</h1>
          </div>
          <p className="text-xl text-muted-foreground mb-2">
            Comprehensive documentation for sales management endpoints
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Badge variant="outline">Admin Level</Badge>
            <span>Organization-scoped access</span>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="get-sale">
              Get Sale{" "}
              <Badge variant="secondary" className="ml-1 text-xs">
                New
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="endpoints">All Endpoints</TabsTrigger>
            <TabsTrigger value="integration">Integration Guide</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Sales Management Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  The Sales Management API provides comprehensive functionality
                  for managing sales operations within your organization. All
                  endpoints are scoped to your organization, ensuring data
                  privacy and security.
                </p>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold mb-3">Key Capabilities</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li>• Create and manage sales records</li>
                      <li>• Flexible sale lookup methods</li>
                      <li>• Advanced filtering and search</li>
                      <li>• Image upload and management</li>
                      <li>• Customer information tracking</li>
                      <li>• Agent assignment and tracking</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3">Access Control</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li>• Organization-scoped data access</li>
                      <li>• Role-based permissions</li>
                      <li>• Secure authentication required</li>
                      <li>• Automatic data isolation</li>
                      <li>• Audit trail capabilities</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Endpoints Grid */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {salesEndpoints.map((endpoint, index) => (
                <Card
                  key={index}
                  className="relative hover:shadow-lg transition-shadow"
                >
                  {endpoint.isNew && (
                    <Badge
                      variant="secondary"
                      className="absolute top-2 right-2 text-xs"
                    >
                      New
                    </Badge>
                  )}
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <endpoint.icon className="h-5 w-5 text-blue-600" />
                      <CardTitle className="text-lg">{endpoint.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          endpoint.method === "GET" ? "default" : "secondary"
                        }
                      >
                        {endpoint.method}
                      </Badge>
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {endpoint.endpoint}
                      </code>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">
                      {endpoint.description}
                    </p>
                    <div className="space-y-1">
                      {endpoint.features.map((feature, idx) => (
                        <div
                          key={idx}
                          className="text-xs text-muted-foreground flex items-center gap-1"
                        >
                          <span className="w-1 h-1 bg-blue-500 rounded-full"></span>
                          {feature}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Get Sale Tab */}
          <TabsContent value="get-sale">
            <GetSaleDocumentation />
          </TabsContent>

          {/* All Endpoints Tab */}
          <TabsContent value="endpoints" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Complete Sales API Reference</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Detailed documentation for all sales management endpoints
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {salesEndpoints.map((endpoint, index) => (
                    <div key={index} className="border rounded-lg p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <endpoint.icon className="h-6 w-6 text-blue-600" />
                          <h3 className="text-xl font-semibold">
                            {endpoint.name}
                          </h3>
                          {endpoint.isNew && (
                            <Badge variant="secondary">New</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              endpoint.method === "GET"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {endpoint.method}
                          </Badge>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <p className="text-muted-foreground">
                          {endpoint.description}
                        </p>

                        <div className="bg-muted p-3 rounded">
                          <code className="text-sm">{endpoint.endpoint}</code>
                        </div>

                        <div>
                          <h4 className="font-semibold mb-2">Features:</h4>
                          <ul className="grid md:grid-cols-2 gap-1">
                            {endpoint.features.map((feature, idx) => (
                              <li
                                key={idx}
                                className="text-sm text-muted-foreground flex items-center gap-2"
                              >
                                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                                {feature}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Integration Guide Tab */}
          <TabsContent value="integration" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Integration Best Practices</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-3">Service Layer Pattern</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Create a dedicated service class for sales operations to
                    centralize API calls and error handling.
                  </p>
                  <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                    {`// SalesService.js
class SalesService {
  constructor() {
    this.baseUrl = import.meta.env.VITE_SUPABASE_URL;
    this.functionsUrl = \`\${this.baseUrl}/functions/v1\`;
  }

  async getHeaders() {
    const token = await tokenManager.getValidToken();
    return {
      'Authorization': \`Bearer \${token}\`,
      'Content-Type': 'application/json'
    };
  }

  // Get sale by any identifier
  async getSale(identifier, type = 'transaction_id') {
    const response = await fetch(
      \`\${this.functionsUrl}/get-sale?\${type}=\${encodeURIComponent(identifier)}\`,
      {
        method: 'POST',
        headers: await this.getHeaders(),
        body: JSON.stringify({})
      }
    );
    return await response.json();
  }
}`}
                  </pre>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">
                    Error Handling Strategy
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Implement comprehensive error handling for different
                    scenarios.
                  </p>
                  <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                    {`// Error handling example
try {
  const result = await SalesService.getSale('TXN001', 'transaction_id');
  
  if (!result.success) {
    switch (result.message) {
      case 'Unauthorized':
        // Handle authentication issues
        await refreshToken();
        break;
      case 'Sale not found or access denied':
        // Handle not found cases
        showNotFoundMessage();
        break;
      default:
        // Handle other errors
        showErrorMessage(result.message);
    }
    return;
  }
  
  // Handle successful response
  displaySaleDetails(result.data);
} catch (error) {
  // Handle network or unexpected errors
  console.error('Network error:', error);
  showNetworkErrorMessage();
}`}
                  </pre>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">Caching Strategy</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Implement client-side caching for frequently accessed sales
                    data.
                  </p>
                  <div className="bg-blue-50 border border-blue-200 rounded p-4">
                    <h4 className="font-semibold text-blue-800 mb-2">
                      Recommended Caching
                    </h4>
                    <ul className="text-sm text-blue-700 space-y-1">
                      <li>• Cache sale details for 5-10 minutes</li>
                      <li>• Use sale ID as cache key</li>
                      <li>• Invalidate cache on updates</li>
                      <li>• Consider using React Query or SWR</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t text-center text-muted-foreground text-sm">
          <p>
            This documentation covers all sales management endpoints available
            to admin users. For system-wide access, refer to the Super Admin
            documentation.
          </p>
          <p className="mt-2">
            Need help? Contact: <strong>dev@atmosfair.com</strong>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminSalesDocumentation;
