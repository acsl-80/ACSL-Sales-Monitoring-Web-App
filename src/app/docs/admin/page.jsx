
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
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ADMIN_ENDPOINTS,
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

const AdminDocumentation = () => {
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
      <Card className="mb-4 border-l-4 border-l-blue-500">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge
                variant={endpoint.method === "GET" ? "default" : "secondary"}
              >
                {endpoint.method}
              </Badge>
              <CardTitle className="text-lg">{endpoint.endpoint}</CardTitle>
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
                  <Badge variant="outline">{endpoint.role}</Badge>
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

  const EndpointSection = ({ title, endpoints, category, icon: Icon }) => {
    const sectionKey = `section-${category}`;
    const isOpen = openSections[sectionKey];

    return (
      <div className="mb-6">
        <Collapsible
          open={isOpen}
          onOpenChange={() => toggleSection(sectionKey)}
        >
          <CollapsibleTrigger asChild>
            <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className="h-6 w-6 text-blue-600" />
                    <CardTitle className="text-xl">{title}</CardTitle>
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
            <Shield className="h-8 w-8 text-blue-600" />
            <h1 className="text-4xl font-bold">Admin API Documentation</h1>
          </div>
          <p className="text-xl text-muted-foreground mb-2">
            {DOC_METADATA.description}
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Version: {DOC_METADATA.version}</span>
            <span>Last Updated: {DOC_METADATA.lastUpdated}</span>
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Book className="h-5 w-5" />
                  System Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">API Overview</h3>
                  <p className="text-muted-foreground">
                    {INTRO_CONTENT.overview}
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Architecture</h3>
                  <p className="text-muted-foreground">
                    {INTRO_CONTENT.architecture}
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
                  <Users className="h-5 w-5" />
                  Admin Role Capabilities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <h3 className="font-semibold mb-2">
                    {ROLE_DESCRIPTIONS.admin.title}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {ROLE_DESCRIPTIONS.admin.description}
                  </p>

                  <h4 className="font-semibold mb-2">Limitations:</h4>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    {ROLE_DESCRIPTIONS.admin.limitations.map(
                      (limitation, index) => (
                        <li key={index}>{limitation}</li>
                      )
                    )}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Response Formats Tab */}
          <TabsContent value="formats" className="space-y-6">
            <Card>
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

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                  <h3 className="font-semibold text-blue-800 mb-2">
                    Admin Role - Format 2 (Database Format)
                  </h3>
                  <p className="text-blue-700 text-sm">
                    As an Admin user, all your API requests will receive{" "}
                    <strong>Format 2 (Database Format)</strong> responses by
                    default. This maintains compatibility with existing internal
                    applications and mobile apps.
                  </p>
                </div>

                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-semibold mb-4">
                      {RESPONSE_FORMATS.formats.format2.title}
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      {RESPONSE_FORMATS.formats.format2.description}
                    </p>
                    <p className="text-sm text-blue-600 mb-4">
                      <strong>Usage:</strong>{" "}
                      {RESPONSE_FORMATS.formats.format2.usage}
                    </p>

                    <h4 className="font-semibold mb-2">Example Response:</h4>
                    <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
                      {JSON.stringify(
                        RESPONSE_FORMATS.formats.format2.example,
                        null,
                        2
                      )}
                    </pre>
                  </div>

                  <div className="border-t pt-6">
                    <h3 className="text-xl font-semibold mb-4">
                      Field Reference (Format 2)
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
                              id
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Unique record identifier (UUID)
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              stove_serial_no
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
                              sales_date
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
                              created_at
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
                              end_user_name
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Full name of the end user
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              contact_person
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              string
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Primary contact person
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
                              other_phone
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
                              partner_name
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
                              state_backup
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
                              lga_backup
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
                              addresses
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              object
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Address information with coordinates
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-gray-200 px-4 py-2 font-mono text-sm">
                              organizations
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              object
                            </td>
                            <td className="border border-gray-200 px-4 py-2">
                              Organization details
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Endpoints Tab */}
          <TabsContent value="endpoints" className="space-y-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-4">API Endpoints</h2>
              <p className="text-muted-foreground">
                The following endpoints are available for admin users. Click on
                each section to expand and view detailed endpoint information.
              </p>
            </div>

            <EndpointSection
              title="Dashboard Endpoints"
              endpoints={ADMIN_ENDPOINTS.dashboard}
              category="dashboard"
              icon={Database}
            />

            <EndpointSection
              title="Sales Management"
              endpoints={ADMIN_ENDPOINTS.sales}
              category="sales"
              icon={ShoppingCart}
            />

            <EndpointSection
              title="Agent Management"
              endpoints={ADMIN_ENDPOINTS.agents}
              category="agents"
              icon={Users}
            />

            <EndpointSection
              title="Branch Management"
              endpoints={ADMIN_ENDPOINTS.branches}
              category="branches"
              icon={Building2}
            />

            <EndpointSection
              title="Activity Logging"
              endpoints={ADMIN_ENDPOINTS.activities}
              category="activities"
              icon={Activity}
            />
          </TabsContent>

          {/* Authentication Tab */}
          <TabsContent value="authentication" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{COMMON_SECTIONS.authentication.title}</CardTitle>
              </CardHeader>
              <CardContent>
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
                  Code Examples
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-3">Basic Request</h3>
                  <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
                    {CODE_EXAMPLES.javascript.basicRequest}
                  </pre>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">
                    Using Token Manager (Recommended)
                  </h3>
                  <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
                    {CODE_EXAMPLES.javascript.withTokenManager}
                  </pre>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">Service Class Pattern</h3>
                  <pre className="bg-muted p-4 rounded text-sm overflow-x-auto">
                    {CODE_EXAMPLES.javascript.serviceClass}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Best Practices Tab */}
          <TabsContent value="best-practices" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{BEST_PRACTICES.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
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
                <CardTitle>{COMMON_SECTIONS.filtering.title}</CardTitle>
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
              </CardContent>
            </Card>
          </TabsContent>

          {/* Troubleshooting Tab */}
          <TabsContent value="troubleshooting" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  {TROUBLESHOOTING.title}
                </CardTitle>
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

export default AdminDocumentation;
