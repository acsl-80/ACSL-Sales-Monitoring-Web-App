
import React from "react";
import Link from "@/compat/Link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Shield, 
  Crown, 
  Book, 
  ArrowRight, 
  Users, 
  Building2,
  Database,
  ShoppingCart,
  Activity,
  FileImage,
  BarChart3,
  ExternalLink
} from "lucide-react";
import { DOC_METADATA } from "./constants/content";

const DocumentationIndex = () => {
  const adminFeatures = [
    { icon: Database, name: "Dashboard Analytics", description: "Organization-specific metrics and KPIs" },
    { icon: ShoppingCart, name: "Sales Management", description: "Create, update, and track sales within your organization" },
    { icon: Users, name: "Agent Management", description: "Manage sales agents and their permissions" },
    { icon: Building2, name: "Branch Management", description: "Oversee branch operations and locations" },
    { icon: Activity, name: "Activity Logging", description: "Track and audit sales activities" }
  ];

  const superAdminFeatures = [
    { icon: BarChart3, name: "Advanced Analytics", description: "Cross-organization reporting and insights" },
    { icon: Building2, name: "Organization Management", description: "Create and manage partner organizations" },
    { icon: Database, name: "System-wide Access", description: "Access data across all organizations" },
    { icon: FileImage, name: "Agreement Images", description: "Access customer agreement documents" },
    { icon: Users, name: "Global User Management", description: "Manage users across the entire system" }
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-6">
            <Book className="h-12 w-12 text-blue-600" />
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              API Documentation
            </h1>
          </div>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            {DOC_METADATA.description}
          </p>
          <div className="flex items-center justify-center gap-6 mt-6 text-sm text-muted-foreground">
            <span>Version: {DOC_METADATA.version}</span>
            <span>Last Updated: {DOC_METADATA.lastUpdated}</span>
            <Badge variant="outline">REST API</Badge>
          </div>
        </div>

        {/* Quick Navigation Cards */}
        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {/* Admin Documentation */}
          <Card className="border-l-4 border-l-blue-500 hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3 mb-4">
                <Shield className="h-8 w-8 text-blue-600" />
                <div>
                  <CardTitle className="text-2xl">Admin Documentation</CardTitle>
                  <p className="text-muted-foreground">Organization-level API access</p>
                </div>
              </div>
              <Badge variant="outline" className="w-fit">
                Organization Scoped
              </Badge>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-muted-foreground">
                Access comprehensive documentation for admin-level API endpoints. Manage your organization's 
                sales, agents, branches, and view analytics within your organizational scope.
              </p>

              <div className="space-y-3">
                <h4 className="font-semibold">Key Features:</h4>
                <div className="grid gap-2">
                  {adminFeatures.map((feature, index) => (
                    <div key={index} className="flex items-center gap-3 text-sm">
                      <feature.icon className="h-4 w-4 text-blue-600 flex-shrink-0" />
                      <div>
                        <span className="font-medium">{feature.name}</span>
                        <span className="text-muted-foreground ml-2">- {feature.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t">
                <Link href="/docs/admin">
                  <Button className="w-full bg-blue-600 hover:bg-blue-700">
                    View Admin Documentation
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Super Admin Documentation */}
          <Card className="border-l-4 border-l-purple-500 hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3 mb-4">
                <Crown className="h-8 w-8 text-purple-600" />
                <div>
                  <CardTitle className="text-2xl">Super Admin Documentation</CardTitle>
                  <p className="text-muted-foreground">System-wide API access</p>
                </div>
              </div>
              <Badge variant="outline" className="w-fit bg-purple-50 text-purple-700 border-purple-200">
                System-wide Access
              </Badge>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-muted-foreground">
                Comprehensive documentation for super admin endpoints with cross-organizational access. 
                Manage the entire system, view global analytics, and perform advanced administrative tasks.
              </p>

              <div className="space-y-3">
                <h4 className="font-semibold">Key Features:</h4>
                <div className="grid gap-2">
                  {superAdminFeatures.map((feature, index) => (
                    <div key={index} className="flex items-center gap-3 text-sm">
                      <feature.icon className="h-4 w-4 text-purple-600 flex-shrink-0" />
                      <div>
                        <span className="font-medium">{feature.name}</span>
                        <span className="text-muted-foreground ml-2">- {feature.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t">
                <Link href="/docs/superadmin">
                  <Button className="w-full bg-purple-600 hover:bg-purple-700">
                    View Super Admin Documentation
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* System Overview */}
        <Card className="mb-12">
          <CardHeader>
            <CardTitle className="text-2xl">System Architecture Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="bg-blue-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <Shield className="h-8 w-8 text-blue-600" />
                </div>
                <h3 className="font-semibold mb-2">Admin Level</h3>
                <p className="text-sm text-muted-foreground">
                  Organization-scoped access for managing sales, agents, and branches within a specific organization.
                </p>
              </div>
              
              <div className="text-center">
                <div className="bg-purple-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <Crown className="h-8 w-8 text-purple-600" />
                </div>
                <h3 className="font-semibold mb-2">Super Admin Level</h3>
                <p className="text-sm text-muted-foreground">
                  System-wide access for managing all organizations, global analytics, and system configuration.
                </p>
              </div>
              
              <div className="text-center">
                <div className="bg-green-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <Database className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="font-semibold mb-2">Secure API</h3>
                <p className="text-sm text-muted-foreground">
                  All endpoints are secured with JWT authentication and role-based access control.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card className="mb-12">
          <CardHeader>
            <CardTitle>Quick Links & Resources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Link href="/docs/admin" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <Shield className="mr-2 h-4 w-4" />
                  Admin API
                </Button>
              </Link>
              
              <Link href="/docs/superadmin" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <Crown className="mr-2 h-4 w-4" />
                  Super Admin API
                </Button>
              </Link>
              
              <Link href="/login" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <Users className="mr-2 h-4 w-4" />
                  Login to System
                </Button>
              </Link>
              
              <a 
                href={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="block"
              >
                <Button variant="outline" className="w-full justify-start">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  API Base URL
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>

        {/* Getting Started */}
        <Card>
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-3">For Developers</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>Obtain your API credentials and ensure proper role assignment</li>
                  <li>Review the authentication requirements for your role level</li>
                  <li>Explore the relevant documentation (Admin or Super Admin)</li>
                  <li>Test endpoints using the provided code examples</li>
                  <li>Implement proper error handling and rate limiting</li>
                </ol>
              </div>
              
              <div>
                <h3 className="font-semibold mb-3">Important Notes</h3>
                <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                  <li>All API requests require valid JWT authentication</li>
                  <li>Role-based access control is strictly enforced</li>
                  <li>Rate limiting is in place to ensure system stability</li>
                  <li>Use HTTPS for all API communications</li>
                  <li>Implement proper error handling in your applications</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t text-center text-muted-foreground text-sm">
          <p>
            This documentation is automatically generated and kept in sync with the codebase. 
            If you notice any discrepancies, please report them to the development team.
          </p>
          <p className="mt-2">
            For technical support, contact: <strong>dev@atmosfair.com</strong>
          </p>
        </div>
      </div>
    </div>
  );
};

export default DocumentationIndex;
