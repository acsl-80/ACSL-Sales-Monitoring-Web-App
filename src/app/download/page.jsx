
import React from "react";
import Image from "@/compat/Image";
import Link from "@/compat/Link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Smartphone,
  CheckCircle,
  Shield,
  Zap,
  Users,
  Activity,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";

const DownloadPage = () => {
  const handleDownload = () => {
    // Replace this with your actual APK download URL
    const apkUrl = "/downloads/atmosfair-admin.apk";
    window.location.href = apkUrl;
  };

  const features = [
    {
      icon: Activity,
      title: "Real-time Sales Management",
      description:
        "Create and manage sales on the go with instant synchronization",
    },
    {
      icon: Users,
      title: "Agent Management",
      description: "Manage your sales agents and track their performance",
    },
    {
      icon: Shield,
      title: "Secure Access",
      description: "Enterprise-grade security with role-based access control",
    },
    {
      icon: Zap,
      title: "Offline Capability",
      description: "Continue working even without internet connection",
    },
  ];

  const requirements = [
    "Android 8.0 (Oreo) or higher",
    "Minimum 100MB free storage space",
    "Active admin account credentials",
    "Internet connection for initial setup",
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Link href="/login">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Login
            </Button>
          </Link>
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200"
          >
            Latest Version
          </Badge>
        </div>

        {/* Main Content */}
        <div className="text-center mb-12">
          <div className="mb-6">
            <Image
              src="/logo.png"
              alt="Atmosfair Logo"
              width={120}
              height={60}
              className="mx-auto h-16 w-auto"
            />
          </div>
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
            Download Mobile App
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Take your sales management anywhere with our powerful Android
            application designed specifically for administrators.
          </p>
        </div>

        {/* Download Card */}
        <Card className="mb-12 border-2 border-blue-200 shadow-xl">
          <CardHeader className="text-center bg-gradient-to-r from-blue-50 to-purple-50">
            <div className="flex justify-center mb-4">
              <div className="bg-blue-600 rounded-full p-4">
                <Smartphone className="h-12 w-12 text-white" />
              </div>
            </div>
            <CardTitle className="text-3xl mb-2">Atmosfair Admin App</CardTitle>
            <p className="text-muted-foreground">For Android Devices Only</p>
          </CardHeader>
          <CardContent className="pt-8">
            <div className="text-center mb-8">
              <Button
                onClick={handleDownload}
                size="lg"
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-6 text-lg"
              >
                <Download className="mr-3 h-6 w-6" />
                Download APK File
              </Button>
              <p className="text-sm text-muted-foreground mt-4">
                Version 1.0.0 • Last updated: November 2025
              </p>
            </div>

            {/* Important Notice */}
            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-8">
              <div className="flex gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-amber-900 mb-1">
                    iOS Not Available
                  </h4>
                  <p className="text-sm text-amber-800">
                    Due to iOS platform restrictions for enterprise
                    applications, we currently only support Android devices.
                    This app is designed for specific organizational use.
                  </p>
                </div>
              </div>
            </div>

            {/* Installation Steps */}
            <div className="bg-gray-50 rounded-lg p-6 mb-8">
              <h3 className="font-semibold text-lg mb-4">
                Installation Instructions
              </h3>
              <ol className="space-y-3">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
                    1
                  </span>
                  <span>
                    Download the APK file by clicking the button above
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
                    2
                  </span>
                  <span>
                    Go to Settings → Security → Enable "Install from Unknown
                    Sources"
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
                    3
                  </span>
                  <span>
                    Open the downloaded APK file and follow the installation
                    prompts
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">
                    4
                  </span>
                  <span>
                    Launch the app and log in with your admin credentials
                  </span>
                </li>
              </ol>
            </div>
          </CardContent>
        </Card>

        {/* Features Grid */}
        <div className="mb-12">
          <h2 className="text-3xl font-bold text-center mb-8">Key Features</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="hover:shadow-lg transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex gap-4">
                    <div className="bg-blue-50 rounded-lg p-3 h-fit">
                      <feature.icon className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-2">{feature.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* System Requirements */}
        <Card className="mb-12">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              System Requirements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-3">Minimum Requirements</h4>
                <ul className="space-y-2">
                  {requirements.map((req, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-3">Who Can Use This App?</h4>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <Shield className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <span>
                      <strong>Admin Users:</strong> Organization administrators
                      with full access to their organization's data
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Users className="h-4 w-4 text-purple-600 flex-shrink-0 mt-0.5" />
                    <span>
                      <strong>Sales Agents:</strong> Field agents who can create
                      and manage sales (coming soon)
                    </span>
                  </div>
                  <p className="text-xs text-amber-600 mt-4">
                    Note: Super admin features are only available on the web
                    platform
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Support Section */}
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <h3 className="font-semibold text-lg mb-2">Need Help?</h3>
              <p className="text-muted-foreground mb-4">
                If you encounter any issues during installation or usage, please
                contact our support team.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button variant="outline" asChild>
                  <Link href="/docs">View Documentation</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/login">Web Login</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t text-center text-muted-foreground text-sm">
          <p>© 2025 Atmosfair Sales Management. All rights reserved.</p>
          <p className="mt-2">
            For technical support: <strong>support@atmosfair.com</strong>
          </p>
        </div>
      </div>
    </div>
  );
};

export default DownloadPage;
