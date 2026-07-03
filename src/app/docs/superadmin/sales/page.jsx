
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Crown, Search, BarChart3, Globe, Users, Database } from "lucide-react";
import GetSaleDocumentation from "../../components/GetSaleDocumentation";

const SuperAdminSalesDocumentation = () => {
  const superAdminFeatures = [
    {
      icon: Globe,
      title: "Cross-Organization Access",
      description: "Access sales data from any organization in the system",
    },
    {
      icon: Users,
      title: "Global User Management",
      description: "Manage sales agents and admins across all organizations",
    },
    {
      icon: Database,
      title: "System-wide Analytics",
      description: "Generate reports and analytics across the entire platform",
    },
    {
      icon: Search,
      title: "Advanced Search",
      description: "Search and filter sales across multiple organizations",
    },
  ];

  const formatComparison = [
    {
      feature: "Default Response Format",
      admin: "Format 2 (Database Format)",
      superAdmin: "Format 1 (Standardized Format)",
    },
    {
      feature: "Data Access Scope",
      admin: "Organization-specific",
      superAdmin: "System-wide (all organizations)",
    },
    {
      feature: "Field Names",
      admin: "Database field names (e.g., stove_serial_no)",
      superAdmin: "Standardized names (e.g., serialNumber)",
    },
    {
      feature: "Integration Purpose",
      admin: "Internal applications, mobile apps",
      superAdmin: "External integrations, reporting systems",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Crown className="h-8 w-8 text-purple-600" />
            <h1 className="text-4xl font-bold">Super Admin Sales API</h1>
          </div>
          <p className="text-xl text-muted-foreground mb-2">
            System-wide sales management with cross-organization access
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Badge
              variant="outline"
              className="bg-purple-50 text-purple-700 border-purple-200"
            >
              Super Admin Level
            </Badge>
            <span>System-wide access</span>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="get-sale">
              Get Sale{" "}
              <Badge variant="secondary" className="ml-1 text-xs">
                Enhanced
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="formats">Response Formats</TabsTrigger>
            <TabsTrigger value="integration">Integration</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="h-6 w-6 text-purple-600" />
                  Super Admin Capabilities
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-muted-foreground">
                  As a Super Admin, you have elevated access to sales data
                  across all organizations in the system. This includes enhanced
                  versions of standard endpoints with additional capabilities
                  and system-wide data access.
                </p>

                <div className="grid md:grid-cols-2 gap-6">
                  {superAdminFeatures.map((feature, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <feature.icon className="h-6 w-6 text-purple-600" />
                        <h3 className="font-semibold">{feature.title}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {feature.description}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-purple-500">
              <CardHeader>
                <CardTitle>Key Differences from Admin Access</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="bg-purple-50 border border-purple-200 rounded p-4">
                    <h4 className="font-semibold text-purple-800 mb-2">
                      Enhanced get-sale Endpoint
                    </h4>
                    <p className="text-purple-700 text-sm">
                      The get-sale endpoint provides the same functionality as
                      the admin version, but with system-wide access. Super
                      admins can retrieve sales from any organization, not just
                      their own.
                    </p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <h4 className="font-semibold mb-2 text-green-600">
                        Super Admin Access
                      </h4>
                      <ul className="space-y-1 text-muted-foreground">
                        <li>• Access sales from ANY organization</li>
                        <li>• Cross-organization data analysis</li>
                        <li>• System-wide reporting capabilities</li>
                        <li>• Advanced filtering across orgs</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2 text-blue-600">
                        Standard Admin Access
                      </h4>
                      <ul className="space-y-1 text-muted-foreground">
                        <li>• Organization-scoped data only</li>
                        <li>• Limited to own organization</li>
                        <li>• Organization-level reporting</li>
                        <li>• Internal operations focus</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Get Sale Tab */}
          <TabsContent value="get-sale" className="space-y-6">
            <Card className="border-l-4 border-l-purple-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-purple-600" />
                  Super Admin Enhanced Access
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-purple-50 border border-purple-200 rounded p-4 mb-6">
                  <h3 className="font-semibold text-purple-800 mb-2">
                    Enhanced Capabilities
                  </h3>
                  <ul className="text-purple-700 text-sm space-y-1">
                    <li>
                      • <strong>Cross-Organization Access:</strong> Retrieve
                      sales from any organization
                    </li>
                    <li>
                      • <strong>System-wide Search:</strong> Search across all
                      organizations simultaneously
                    </li>
                    <li>
                      • <strong>Advanced Filtering:</strong> Filter by
                      organization, region, or other system-wide criteria
                    </li>
                    <li>
                      • <strong>Audit Capabilities:</strong> Access complete
                      sale history for compliance and auditing
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            <GetSaleDocumentation />
          </TabsContent>

          {/* Formats Tab */}
          <TabsContent value="formats" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Response Format Comparison</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Understanding the differences between Admin and Super Admin
                  response formats
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="min-w-full border border-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="border border-gray-200 px-4 py-2 text-left font-semibold">
                          Feature
                        </th>
                        <th className="border border-gray-200 px-4 py-2 text-left font-semibold">
                          Admin (Format 2)
                        </th>
                        <th className="border border-gray-200 px-4 py-2 text-left font-semibold">
                          Super Admin (Format 1)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {formatComparison.map((row, index) => (
                        <tr
                          key={index}
                          className={
                            index % 2 === 0 ? "bg-white" : "bg-gray-50"
                          }
                        >
                          <td className="border border-gray-200 px-4 py-2 font-medium">
                            {row.feature}
                          </td>
                          <td className="border border-gray-200 px-4 py-2 text-sm">
                            {row.admin}
                          </td>
                          <td className="border border-gray-200 px-4 py-2 text-sm">
                            {row.superAdmin}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-blue-600">
                    Format 2 Example (Admin)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                    {`{
  "success": true,
  "data": {
    "id": "uuid-here",
    "stove_serial_no": "SN123456",
    "sales_date": "2024-01-15",
    "end_user_name": "John Doe",
    "contact_person": "John Doe",
    "phone": "+2348012345678",
    "addresses": {
      "full_address": "123 Main Street",
      "latitude": 6.5244,
      "longitude": 3.3792
    }
  }
}`}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-purple-600">
                    Format 1 Example (Super Admin)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                    {`{
  "success": true,
  "data": {
    "serialNumber": "SN123456",
    "salesDate": "2024-01-15",
    "contactPerson": "John Doe",
    "phone": "+2348012345678",
    "address": "123 Main Street",
    "latitude": 6.5244,
    "longitude": 3.3792,
    "salesPartner": "Partner Co Ltd"
  }
}`}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Integration Tab */}
          <TabsContent value="integration" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Super Admin Integration Patterns</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-3">
                    Cross-Organization Data Service
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Create a service that can handle cross-organization data
                    requests.
                  </p>
                  <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                    {`// SuperAdminSalesService.js
class SuperAdminSalesService extends SalesService {
  // Get sale from any organization
  async getSaleGlobal(identifier, type = 'transaction_id') {
    const response = await fetch(
      \`\${this.functionsUrl}/get-sale?\${type}=\${encodeURIComponent(identifier)}\`,
      {
        method: 'POST',
        headers: await this.getHeaders(),
        body: JSON.stringify({})
      }
    );
    
    const result = await response.json();
    
    // Super admin gets access to all organizations
    if (result.success) {
      console.log('Sale found in organization:', result.data.organization_id);
    }
    
    return result;
  }

  // Search across organizations
  async searchSalesAcrossOrgs(searchTerm) {
    // Implementation for cross-org search
    const response = await this.getSalesAdvanced({
      search: searchTerm,
      // Super admin can search across all orgs
    });
    
    return response;
  }
}`}
                  </pre>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">Audit and Compliance</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Use super admin access for audit trails and compliance
                    reporting.
                  </p>
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
                    <h4 className="font-semibold text-yellow-800 mb-2">
                      Audit Use Cases
                    </h4>
                    <ul className="text-yellow-700 text-sm space-y-1">
                      <li>• Track sales across all partner organizations</li>
                      <li>
                        • Generate compliance reports for regulatory
                        requirements
                      </li>
                      <li>
                        • Monitor system-wide sales patterns and anomalies
                      </li>
                      <li>
                        • Investigate customer complaints across organizations
                      </li>
                    </ul>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">
                    Data Export and Reporting
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Leverage super admin access for comprehensive data exports.
                  </p>
                  <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                    {`// Example: Generate system-wide sales report
async generateSystemReport(startDate, endDate) {
  try {
    const allSales = await this.getSalesAdvanced({
      startDate,
      endDate,
      responseFormat: 'format1', // Standardized format for exports
      limit: 1000 // Large batch for reporting
    });

    if (allSales.success) {
      // Process data for export
      const reportData = allSales.data.map(sale => ({
        serialNumber: sale.serialNumber,
        salesDate: sale.salesDate,
        organization: sale.salesPartner,
        state: sale.state,
        district: sale.district,
        customerName: sale.contactPerson
      }));

      return this.exportToCSV(reportData);
    }
  } catch (error) {
    console.error('Report generation failed:', error);
  }
}`}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t text-center text-muted-foreground text-sm">
          <p>
            This documentation covers super admin enhanced access to sales
            management endpoints. Use these capabilities responsibly and in
            accordance with data privacy regulations.
          </p>
          <p className="mt-2">
            For technical support: <strong>dev@atmosfair.com</strong>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminSalesDocumentation;
