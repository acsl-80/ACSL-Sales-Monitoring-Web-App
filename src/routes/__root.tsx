import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/app/contexts/AuthContext";
import { ToastProvider } from "@/app/contexts/ToastContext";
import { SidebarProvider } from "@/app/contexts/SidebarContext";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import DashboardLayout from "@/app/components/DashboardLayout";

// Routes whose top URL segment renders WITHOUT the authenticated shell.
const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/unauthorized",
  "/download",
  "/sales-monitoring-app",
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (isPublicPath(pathname)) {
    return <Outlet />;
  }
  return (
    <ProtectedRoute>
      <DashboardLayout>
        <Outlet />
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

// Public origin used to build absolute URLs for canonical + social share tags.
// Set VITE_SITE_URL in your deploy env; falls back to the placeholder below.
const SITE_URL = (
  import.meta.env.VITE_SITE_URL || "https://sales.atmosfair.com.ng"
).replace(/\/$/, "");

const SITE_NAME = "Atmosfair Sales Monitoring";
const SITE_TITLE = "Atmosfair Sales Monitoring — Field Sales & Agent Tracking";
const SITE_DESCRIPTION =
  "Real-time field sales monitoring, agent tracking, and performance analytics for the Save80 / Atmosfair programme. Record sales offline, sync automatically, and manage teams from a central dashboard.";
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "author", content: "Atmosfair" },
      { name: "application-name", content: SITE_NAME },
      { name: "apple-mobile-web-app-title", content: "Sales Monitor" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "default",
      },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "theme-color", content: "#1d4ed8" },
      {
        name: "keywords",
        content:
          "sales monitoring, field sales, agent tracking, sales analytics, stove management, Save80, Atmosfair, offline sales app",
      },
      // Open Graph
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: SITE_NAME },
      // Twitter
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: SITE_URL },
      // Favicons & app icons
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "48x48",
        href: "/favicon-48x48.png",
      },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      // Performance hints
      { rel: "preconnect", href: "https://oeiwnpngbnkhcismhpgs.supabase.co" },
      { rel: "preconnect", href: "https://maps.googleapis.com" },
      { rel: "preconnect", href: "https://maps.gstatic.com", crossOrigin: "" },
      { rel: "dns-prefetch", href: "https://places.googleapis.com" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <SidebarProvider>
            <AppShell />
          </SidebarProvider>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
