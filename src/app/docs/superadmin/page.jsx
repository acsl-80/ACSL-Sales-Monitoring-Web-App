
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Copy,
  ExternalLink,
  Shield,
  Database,
  Users,
  ShoppingCart,
  Building2,
  Activity,
  ChevronDown,
  ChevronRight,
  Code,
  Book,
  AlertCircle,
  Crown,
  FileImage,
  BarChart3,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SUPER_ADMIN_ENDPOINTS,
  AUTH_REQUIREMENTS,
  ERROR_RESPONSES,
} from "../constants/apiEndpoints";
import {
  DOC_METADATA,
  INTRO_CONTENT,
  COMMON_SECTIONS,
  ROLE_DESCRIPTIONS,
  CODE_EXAMPLES,
  BEST_PRACTICES,
  TROUBLESHOOTING,
  FOOTER_CONTENT,
  RESPONSE_FORMATS,
} from "../constants/content";

const SuperAdminDocumentation = () => {
  const [copiedEndpoint, setCopiedEndpoint] = useState(null);
  const [openSections, setOpenSections] = useState({});

  const copyToClipboard = (text, endpointKey) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(endpointKey);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  const toggleSection = (sectionKey) => {
    setOpenSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const EndpointCard = ({ endpoint, endpointKey, category }) => {
    const fullKey = `${category}-${endpointKey}`;

    return (
      <Card className="mb-4 border-l-4 border-l-purple-500">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge
                variant={endpoint.method === "GET" ? "default" : "secondary"}
              >
                {endpoint.method}
              </Badge>
              <CardTitle className="text-lg">{endpoint.endpoint}</CardTitle>
              <Badge
                variant="outline"
                className="bg-purple-50 text-purple-700 border-purple-200"
              >
                Super Admin Only
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(endpoint.url, fullKey)}
              className="flex items-center gap-2"
            >
              <Copy className="h-4 w-4" />
              {copiedEndpoint === fullKey ? "Copied!" : "Copy URL"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {endpoint.description}
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* URL */}
            <div>
              <h4 className="font-semibold mb-2">Endpoint URL</h4>
              <code className="bg-muted p-2 rounded text-sm block break-all">
                {endpoint.url}
              </code>
            </div>

            {/* Authentication */}
            <div className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4" />
              <span>Requires Authentication: </span>
              <Badge
                variant={endpoint.requiredAuth ? "destructive" : "secondary"}
              >
                {endpoint.requiredAuth ? "Yes" : "No"}
              </Badge>
              {endpoint.role && (
                <>
                  <span className="ml-2">Role: </span>
                  <Badge
                    variant="outline"
                    className="bg-purple-50 text-purple-700 border-purple-200"
                  >
                    {endpoint.role}
                  </Badge>
                </>
              )}
            </div>

            {/* Parameters */}
            {Object.keys(endpoint.parameters).length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">Parameters</h4>
                <div className="space-y-2">
                  {Object.entries(endpoint.parameters).map(
                    ([param, description]) => (
                      <div
                        key={param}
                        className="flex items-start gap-2 text-sm"
                      >
                        <code className="bg-muted px-2 py-1 rounded text-xs font-mono">
                          {param}
                        </code>
                        <span className="text-muted-foreground">
                          {description}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Response Structure */}
            <div>
              <h4 className="font-semibold mb-2">Response Structure</h4>
              <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                {JSON.stringify(endpoint.response, null, 2)}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const EndpointSection = ({
    title,
    endpoints,
    category,
    icon: Icon,
    description,
  }) => {
    const sectionKey = `section-${category}`;
    const isOpen = openSections[sectionKey];

    return (
      <div className="mb-6">
        <Collapsible
          open={isOpen}
          onOpenChange={() => toggleSection(sectionKey)}
        >
          <CollapsibleTrigger asChild>
            <Card className="cursor-pointer hover:bg-muted/50 transition-colors border-l-4 border-l-purple-500">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className="h-6 w-6 text-purple-600" />
                    <div>
                      <CardTitle className="text-xl">{title}</CardTitle>
                      {description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {description}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline">
                      {Object.keys(endpoints).length} endpoints
                    </Badge>
                  </div>
                  {isOpen ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                </div>
              </CardHeader>
            </Card>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-4 space-y-4">
              {Object.entries(endpoints).map(([key, endpoint]) => (
                <EndpointCard
                  key={key}
                  endpoint={endpoint}
                  endpointKey={key}
                  category={category}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Crown className="h-8 w-8 text-purple-600" />
            <h1 className="text-4xl font-bold">
              Super Admin API Documentation
            </h1>
          </div>
          <p className="text-xl text-muted-foreground mb-2">
            Comprehensive API documentation for Super Administrators
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Version: {DOC_METADATA.version}</span>
            <span>Last Updated: {DOC_METADATA.lastUpdated}</span>
            <Badge
              variant="outline"
              className="bg-purple-50 text-purple-700 border-purple-200"
            >
              Super Admin Access Required
            </Badge>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
            <TabsTrigger value="formats">Response Formats</TabsTrigger>
            <TabsTrigger value="authentication">Auth</TabsTrigger>
            <TabsTrigger value="examples">Examples</TabsTrigger>
            <TabsTrigger value="best-practices">Best Practices</TabsTrigger>
            <TabsTrigger value="troubleshooting">Troubleshooting</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <Card className="border-l-4 border-l-purple-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-purple-600" />
                  Super Admin System Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">
                    Super Admin API Overview
                  </h3>
                  <p className="text-muted-foreground">
                    {INTRO_CONTENT.overview}
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">
                    Cross-Organization Access
                  </h3>
                  <p className="text-muted-foreground">
                    Super Admin APIs provide system-wide access across all
                    partner organizations, comprehensive reporting capabilities,
                    and advanced filtering options not available to regular
                    admins.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Base URL</h3>
                  <p className="text-muted-foreground">
                    {INTRO_CONTENT.baseUrl}
                  </p>
                  <code className="bg-muted p-2 rounded text-sm block mt-2">
                    {import.meta.env.VITE_SUPABASE_URL}/functions/v1/
                  </code>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-purple-600" />
                  Super Admin Capabilities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <h3 className="font-semibold mb-2">
                    {ROLE_DESCRIPTIONS.superAdmin.title}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {ROLE_DESCRIPTIONS.superAdmin.description}
                  </p>

                  <h4 className="font-semibold mb-2">Key Capabilities:</h4>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    {ROLE_DESCRIPTIONS.superAdmin.capabilities.map(
                      (capability, index) => (
                        <li key={index}>{capability}</li>
                      )
                    )}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                  Important Security Notice
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-amber-50 border border-amber-200 rounded p-4">
                  <p className="text-amber-800">
                    <strong>Super Admin Access:</strong> These endpoints provide
                    system-wide access and should be used with caution. All
                    super admin operations are logged and monitored for security
                    purposes.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Response Formats Tab */}
          <TabsContent value="formats" className="space-y-6">
            <Card className="border-l-4 border-l-purple-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Code className="h-5 w-5" />
                  {RESPONSE_FORMATS.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-6">
                  {RESPONSE_FORMATS.description}
                </p>

                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
                  <h3 className="font-semibold text-purple-800 mb-2">
                    Super Admin Role - Format 1 (Standardized Format)
                  </h3>
                  <p className="text-purple-700 text-sm">
                    As a Super Admin user, your API requests will receive{" "}
                    <strong>Format 1 (Standardized Format)</strong> responses by
                    default. This format is designed for external integrations
                    and provides clean, standardized field names.
                  </p>
                </div>

                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-semibold mb-4">
                      {RESPONSE_FORMATS.formats.format1.title}
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      {RESPONSE_FORMATS.formats.format1.description}
                    </p>
                    <p className="text-sm text-purple-600 mb-4">
                      <strong>Usage:</strong>{" "}
                      {RESPONSE_FORMATS.formats.format1.usage}
                    </p>

                    <h4 className="font-semibold mb-2">Example Response:</h4>
                    <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                      {JSON.stringify(
                        RESPONSE_FORMATS.formats.format1.example,
                        null,
                        2
                      )}
                    </pre>
                  </div>

                  <div className="border-t pt-6">
                    <h3 className="text-xl font-semibold mb-4">
                      Field Reference (Format 1)
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="min-w-full border border-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="border border-gray-200 px-4 py-2 text-left">
                              Field Name
                            </th>
                            <th className="border border-gray-200 px-4 py-2 text-left">
                              Type
                            </th>
                            <th className="border border-gray-200 px-4 py-2 text-left">
                              Description
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              serialNumber
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Stove serial number
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              salesDate
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Date of sale (ISO format)
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              created
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Record creation timestamp
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              state
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              State information
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              district
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Local Government Area
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              address
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Complete address
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              latitude
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              number
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              GPS latitude coordinate
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              longitude
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              number
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              GPS longitude coordinate
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              phone
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Primary phone number
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              contactPerson
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Contact person name
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              otherContactPhone
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Alternative phone number
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              salesPartner
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Partner organization name
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              userName
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              User first name
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              userSurname
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              User surname
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              cpa
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string|null
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              CPA field (to be defined)
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border-t pt-6">
                    <h3 className="text-xl font-semibold mb-4">
                      Format Mapping Reference
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      This table shows how Format 1 fields map to the underlying
                      database structure (Format 2):
                    </p>
                    <div className="overflow-x-auto">
                      <table className="min-w-full border border-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="border border-gray-200 px-4 py-2 text-left">
                              Format 1 (Standardized)
                            </th>
                            <th className="border border-gray-200 px-4 py-2 text-left">
                              Format 2 (Database)
                            </th>
                            <th className="border border-gray-200 px-4 py-2 text-left">
                              Description
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {RESPONSE_FORMATS.mapping.map((mapping, index) => (
                            <tr key={index}>
                              <td className="border border-gray-200 px-4 py-2 font-mono text-sm text-purple-700">
                                {mapping.format1}
                              </td>
                              <td className="border border-gray-200 px-4 py-2 font-mono text-sm text-blue-700">
                                {mapping.format2}
                              </td>
                              <td className="border border-gray-200 px-4 py-2">
                                {mapping.description}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border-t pt-6">
                    <h3 className="text-xl font-semibold mb-4">
                      Requesting Different Formats
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      While Super Admin defaults to Format 1, you can explicitly
                      request Format 2 by including the responseFormat
                      parameter:
                    </p>
                    <pre className="bg-muted p-4 rounded text-sm">
                      {`// Request Format 2 explicitly (database format)
{
  "limit": 100,
  "offset": 0,
  "responseFormat": "format2"  // Optional: forces database format
}`}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Endpoints Tab */}
          <TabsContent value="endpoints" className="space-y-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-4">
                Super Admin API Endpoints
              </h2>
              <p className="text-muted-foreground">
                The following endpoints are available exclusively for super
                admin users. These APIs provide cross-organizational access and
                advanced system management capabilities.
              </p>
            </div>

            <EndpointSection
              title="Advanced Sales Analytics"
              endpoints={SUPER_ADMIN_ENDPOINTS.sales}
              category="sales"
              icon={BarChart3}
              description="Cross-organization sales data with advanced filtering and export capabilities"
            />

            <EndpointSection
              title="Organization Management"
              endpoints={SUPER_ADMIN_ENDPOINTS.organizations}
              category="organizations"
              icon={Building2}
              description="Manage partner organizations, create new organizations, and bulk import via CSV"
            />

            <EndpointSection
              title="Cross-Organization Branches"
              endpoints={SUPER_ADMIN_ENDPOINTS.branches}
              category="branches"
              icon={Database}
              description="Access and manage branches across all partner organizations"
            />

            <EndpointSection
              title="Agreement Images"
              endpoints={SUPER_ADMIN_ENDPOINTS.agreementImages}
              category="agreementImages"
              icon={FileImage}
              description="Access customer agreement images and related sales information"
            />
          </TabsContent>

          {/* Authentication Tab */}
          <TabsContent value="authentication" className="space-y-6">
            <Card className="border-l-4 border-l-purple-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Super Admin Authentication
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="bg-purple-50 border border-purple-200 rounded p-4">
                    <p className="text-purple-800">
                      <strong>Important:</strong> Super Admin endpoints require
                      additional role-based verification. Your JWT token must
                      include the `super_admin` role claim.
                    </p>
                  </div>

                  <div className="prose prose-sm max-w-none">
                    <div
                      dangerouslySetInnerHTML={{
                        __html: COMMON_SECTIONS.authentication.content.replace(
                          /\n/g,
                          "<br/>"
                        ),
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Authentication Headers</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted p-4 rounded text-sm">
                  {JSON.stringify(AUTH_REQUIREMENTS.headers, null, 2)}
                </pre>
                <div className="mt-4 text-sm text-muted-foreground">
                  <p>
                    <strong>Note:</strong> The JWT token must contain the
                    `super_admin` role for these endpoints to work.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Role Verification</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold">
                      Super Admin Role Requirements:
                    </h4>
                    <ul className="list-disc list-inside text-sm text-muted-foreground mt-2 space-y-1">
                      <li>
                        User must have `role: "super_admin"` in their user
                        profile
                      </li>
                      <li>JWT token must include super admin claims</li>
                      <li>All requests are logged for security auditing</li>
                      <li>
                        Rate limiting may be more restrictive for super admin
                        endpoints
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{COMMON_SECTIONS.errorHandling.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none">
                  <div
                    dangerouslySetInnerHTML={{
                      __html: COMMON_SECTIONS.errorHandling.content.replace(
                        /\n/g,
                        "<br/>"
                      ),
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Examples Tab */}
          <TabsContent value="examples" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Code className="h-5 w-5" />
                  Super Admin Code Examples
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-3">Advanced Sales Query</h3>
                  <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
                    {`// Get sales data across all organizations with advanced filtering
const getSalesData = async () => {
  const token = await tokenManager.getValidToken();
  
  const response = await fetch(
    import.meta.env.VITE_SUPABASE_URL + '/functions/v1/get-sales-advance-two',
    {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${token}\`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        page: 1,
        limit: 100,
        date_from: '2024-01-01',
        date_to: '2024-12-31',
        state: ['Lagos', 'Abuja'],
        sort_by: 'created_at',
        sort_order: 'desc'
      })
    }
  );
  
  const result = await response.json();
  return result;
};`}
                  </pre>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">
                    Organization Management
                  </h3>
                  <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
                    {`// Create a new partner organization
const createOrganization = async (orgData) => {
  const token = await tokenManager.getValidToken();
  
  const response = await fetch(
    import.meta.env.VITE_SUPABASE_URL + '/functions/v1/manage-organizations',
    {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${token}\`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: orgData.name,
        partner_email: orgData.email,
        type: orgData.type,
        address: orgData.address,
        contact_info: orgData.contactInfo
      })
    }
  );
  
  return await response.json();
};`}
                  </pre>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">CSV Import Example</h3>
                  <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
                    {`// Import organizations from CSV
const importOrganizationsCSV = async (csvData, mapping) => {
  const token = await tokenManager.getValidToken();
  
  const response = await fetch(
    import.meta.env.VITE_SUPABASE_URL + '/functions/v1/manage-organizations?import_csv=true',
    {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${token}\`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        csv_data: csvData,
        mapping: mapping
      })
    }
  );
  
  const result = await response.json();
  console.log(\`Imported: \${result.data.imported}, Failed: \${result.data.failed}\`);
  return result;
};`}
                  </pre>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">Flutter/Dart Example</h3>
                  <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
                    {CODE_EXAMPLES.flutter}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Best Practices Tab */}
          <TabsContent value="best-practices" className="space-y-6">
            <Card className="border-l-4 border-l-purple-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-purple-600" />
                  Super Admin Best Practices
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="border-l-4 border-l-purple-500 pl-4">
                    <h3 className="font-semibold">Security First</h3>
                    <p className="text-muted-foreground">
                      Always verify user permissions before making super admin
                      API calls. Log all operations for audit purposes.
                    </p>
                  </div>

                  <div className="border-l-4 border-l-purple-500 pl-4">
                    <h3 className="font-semibold">Performance Optimization</h3>
                    <p className="text-muted-foreground">
                      Use pagination and filtering for large datasets. Super
                      admin endpoints can return massive amounts of data.
                    </p>
                  </div>

                  <div className="border-l-4 border-l-purple-500 pl-4">
                    <h3 className="font-semibold">Data Export</h3>
                    <p className="text-muted-foreground">
                      Use the export parameter judiciously. Large exports can
                      impact system performance.
                    </p>
                  </div>

                  {BEST_PRACTICES.content.map((practice, index) => (
                    <div
                      key={index}
                      className="border-l-4 border-l-blue-500 pl-4"
                    >
                      <h3 className="font-semibold">{practice.title}</h3>
                      <p className="text-muted-foreground">
                        {practice.description}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{COMMON_SECTIONS.pagination.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none">
                  <div
                    dangerouslySetInnerHTML={{
                      __html: COMMON_SECTIONS.pagination.content.replace(
                        /\n/g,
                        "<br/>"
                      ),
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Advanced Filtering (Super Admin)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none">
                  <div
                    dangerouslySetInnerHTML={{
                      __html: COMMON_SECTIONS.filtering.content.replace(
                        /\n/g,
                        "<br/>"
                      ),
                    }}
                  />
                </div>
                <div className="mt-4 bg-purple-50 border border-purple-200 rounded p-4">
                  <h4 className="font-semibold text-purple-800 mb-2">
                    Super Admin Additional Filters:
                  </h4>
                  <ul className="list-disc list-inside text-purple-700 space-y-1">
                    <li>
                      <code>organization_id</code>: Filter by specific
                      organization
                    </li>
                    <li>
                      <code>export</code>: Enable CSV export functionality
                    </li>
                    <li>
                      <code>include_deleted</code>: Include soft-deleted records
                    </li>
                    <li>
                      <code>aggregate</code>: Return summary statistics
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Troubleshooting Tab */}
          <TabsContent value="troubleshooting" className="space-y-6">
            <Card className="border-l-4 border-l-red-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  Super Admin Specific Issues
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="border rounded p-4 bg-red-50 border-red-200">
                    <h3 className="font-semibold text-red-600 mb-2">
                      403 Forbidden - Insufficient Permissions
                    </h3>
                    <p className="text-muted-foreground">
                      Even with a valid token, you might get 403 if your account
                      doesn't have super_admin role. Contact your system
                      administrator to verify your account permissions.
                    </p>
                  </div>

                  <div className="border rounded p-4 bg-red-50 border-red-200">
                    <h3 className="font-semibold text-red-600 mb-2">
                      Large Dataset Timeouts
                    </h3>
                    <p className="text-muted-foreground">
                      Super admin queries can return large amounts of data. Use
                      pagination and filters to reduce response size. Consider
                      using the export functionality for large data extractions.
                    </p>
                  </div>

                  <div className="border rounded p-4 bg-red-50 border-red-200">
                    <h3 className="font-semibold text-red-600 mb-2">
                      Rate Limiting
                    </h3>
                    <p className="text-muted-foreground">
                      Super admin endpoints may have stricter rate limiting.
                      Implement proper retry logic with exponential backoff.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>General Troubleshooting</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {TROUBLESHOOTING.issues.map((issue, index) => (
                    <div key={index} className="border rounded p-4">
                      <h3 className="font-semibold text-red-600 mb-2">
                        {issue.problem}
                      </h3>
                      <p className="text-muted-foreground">{issue.solution}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Common Error Responses</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(ERROR_RESPONSES).map(
                    ([errorType, errorData]) => (
                      <div key={errorType}>
                        <h3 className="font-semibold mb-2 capitalize">
                          {errorType.replace(/([A-Z])/g, " $1")}
                        </h3>
                        <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                          {JSON.stringify(errorData, null, 2)}
                        </pre>
                      </div>
                    )
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t">
          <div className="text-center text-muted-foreground text-sm">
            <div
              dangerouslySetInnerHTML={{
                __html: FOOTER_CONTENT.supportInfo.replace(/\n/g, "<br/>"),
              }}
            />
            <div
              className="mt-4"
              dangerouslySetInnerHTML={{
                __html: FOOTER_CONTENT.disclaimer.replace(/\n/g, "<br/>"),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminDocumentation;
