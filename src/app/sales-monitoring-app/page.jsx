
import React, { useState, useEffect } from "react";
import Link from "@/compat/Link";
import { useAuth } from "../contexts/useAuth";
import {
  Download,
  Share2,
  Star,
  ChevronRight,
  Shield,
  Trash2,
  Lock,
  Upload,
  AlertCircle,
  Smartphone,
  Monitor,
  ArrowLeft,
  CheckCircle,
  Loader2,
} from "lucide-react";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1";

const FALLBACK = {
  version: "1.0.0",
  release_notes: "Initial release of the Atmosfair Sales Monitoring App.",
  base_url: "",
  apk_path: "/downloads/sales-monitoring-app.apk",
  is_force_update: false,
  size: "~45 MB",
  requires: "Android 8.0+",
  features: [
    { title: "Real-time Sales Tracking", description: "Record and monitor sales transactions instantly with live sync to the central dashboard." },
    { title: "Performance Analytics", description: "View your sales performance metrics, targets, and achievements at a glance." },
    { title: "Offline-first Architecture", description: "Continue recording sales without an internet connection. Data syncs automatically when back online." },
    { title: "Secure Role-based Access", description: "Enterprise-grade security with permissions scoped to each user role." },
  ],
  requirements: [
    "Android 8.0 (Oreo) or higher",
    "At least 150 MB free storage space",
    "Active Atmosfair account credentials",
    "Internet connection for initial setup and sync",
  ],
  updated_at: null,
};

const TAGS = ["Sales Management", "Field Operations", "Offline-first", "Agent Tracking", "Stove Manager", "Enterprise"];

const DATA_SAFETY = [
  { icon: Share2, title: "This app may share these data types with third parties", sub: "Sales records, Location data" },
  { icon: Upload, title: "This app may collect these data types", sub: "Sales data, Location, Device info" },
  { icon: Lock, title: "Data is encrypted in transit", sub: null },
  { icon: Trash2, title: "You can request that data be deleted", sub: null },
];

const REVIEWS = [
  { initials: "OA", bg: "bg-blue-600", name: "Organisation Admin", stars: 5, date: "Jun 1, 2026", body: "Very smooth experience for managing sales in the field. The offline mode is a lifesaver in areas with poor connectivity." },
  { initials: "SA", bg: "bg-purple-600", name: "Sales Agent", stars: 5, date: "May 28, 2026", body: "Simple and intuitive. Recording a new sale takes less than a minute. Sync works perfectly when I get back to a good network." },
  { initials: "PA", bg: "bg-teal-600", name: "Partner Agent", stars: 4, date: "May 20, 2026", body: "Great app overall. Would love to see stove transfer history visible in-app. Otherwise very solid." },
];

function StarRow({ count }) {
  return (
    <div className="flex gap-0.5">
      {[...Array(5)].map((_, i) => (
        <Star key={i} className={`h-4 w-4 ${i < count ? "fill-green-600 text-green-600" : "fill-gray-300 text-gray-300"}`} />
      ))}
    </div>
  );
}

function RatingBar({ label, pct }) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span className="w-2">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
        <div className="h-full rounded-full bg-green-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return null;
  }
}

export default function SalesMonitoringAppPage() {
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [release, setRelease] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    fetch(`${FUNCTIONS_URL}/manage-app-release`)
      .then((r) => r.json())
      .then((data) => setRelease(data))
      .catch(() => setRelease(null))
      .finally(() => setLoading(false));
  }, []);

  const data = release ?? FALLBACK;
  const downloadUrl = data.apk_path.startsWith("http")
    ? data.apk_path
    : `${data.base_url || (typeof window !== "undefined" ? window.location.origin : "")}${data.apk_path}`;

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "Atmosfair-Sales-Monitoring-App.apk";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const features = Array.isArray(data.features) ? data.features : FALLBACK.features;
  const requirements = Array.isArray(data.requirements) ? data.requirements : FALLBACK.requirements;
  const updatedLabel = formatDate(data.updated_at);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* ── Hero ── */}
      <div className="bg-[#1f1f1f] text-white">
        <div className="max-w-6xl mx-auto px-6 py-6">
          {user && (
            <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white mb-6 transition-colors">
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Link>
          )}

          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="flex-shrink-0 w-28 h-28 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-xl">
              <Smartphone className="h-14 w-14 text-white" />
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-medium mb-1">Sales Monitoring App</h1>
              <p className="text-green-400 text-sm font-medium mb-1">Atmosfair</p>
              <p className="text-white/50 text-sm mb-4">Free · Android only</p>

              <div className="flex items-center gap-6 mb-6 text-sm">
                <div className="flex items-center gap-1.5 border-r border-white/20 pr-6">
                  <span className="font-medium">4.8</span>
                  <Star className="h-3.5 w-3.5 fill-white text-white" />
                  <span className="text-white/50 text-xs">3 reviews</span>
                </div>
                <div className="border-r border-white/20 pr-6">
                  <p className="font-medium">v{data.version}</p>
                  <p className="text-white/50 text-xs">Latest version</p>
                </div>
                <div>
                  <p className="font-medium">{data.size}</p>
                  <p className="text-white/50 text-xs">Download size</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleDownload}
                  className="bg-[#01875f] hover:bg-[#017352] text-white font-medium px-10 py-3 rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download APK
                </button>
                <button
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({ title: "Sales Monitoring App", url: window.location.href });
                    } else {
                      navigator.clipboard.writeText(window.location.href);
                    }
                  }}
                  className="border border-white/30 hover:bg-white/10 text-white font-medium px-6 py-3 rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                  <Share2 className="h-4 w-4" />
                  Share
                </button>
              </div>

              <p className="text-white/40 text-xs mt-4 flex items-center gap-1.5">
                <Monitor className="h-3.5 w-3.5" />
                This app is available for Android devices only
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-10">

          {/* ── LEFT ── */}
          <div className="flex-1 min-w-0">

            {/* Screenshots placeholder */}
            <div className="flex gap-3 overflow-x-auto pb-3 mb-10">
              {["Dashboard", "Sales Record", "Agent View", "Stove Manager", "Offline Sync"].map((label, i) => {
                const bgs = ["from-blue-900 to-blue-700", "from-indigo-900 to-indigo-700", "from-cyan-900 to-cyan-700", "from-teal-900 to-teal-700", "from-slate-800 to-slate-600"];
                return (
                  <div key={i} className={`flex-shrink-0 w-40 h-72 rounded-2xl bg-gradient-to-b ${bgs[i]} flex flex-col items-center justify-end p-4 border border-gray-200`}>
                    <span className="text-white/70 text-xs font-medium">{label}</span>
                  </div>
                );
              })}
            </div>

            {/* About */}
            <section className="mb-10">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-medium">About this app</h2>
                <ChevronRight className="h-5 w-5 text-gray-400" />
              </div>
              <div className={`text-sm text-gray-700 leading-relaxed whitespace-pre-line ${!aboutExpanded ? "line-clamp-4" : ""}`}>
                {data.release_notes || FALLBACK.release_notes}
              </div>
              <button onClick={() => setAboutExpanded((p) => !p)} className="text-green-700 text-sm font-medium mt-2 hover:underline">
                {aboutExpanded ? "Show less" : "more"}
              </button>
              {updatedLabel && (
                <p className="text-sm text-gray-500 mt-5">
                  <span className="font-medium text-gray-800">Updated on</span> {updatedLabel}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                {TAGS.map((t) => (
                  <span key={t} className="border border-gray-300 rounded-full px-4 py-1 text-xs text-gray-600">{t}</span>
                ))}
              </div>
            </section>

            {/* Features */}
            {features.length > 0 && (
              <section className="mb-10">
                <h2 className="text-xl font-medium mb-5">Key features</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {features.map((f, i) => (
                    <div key={i} className="border border-gray-100 rounded-xl p-4 bg-gray-50">
                      <p className="font-medium text-sm mb-1">{f.title}</p>
                      <p className="text-xs text-gray-500 leading-relaxed">{f.description}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Data safety */}
            <section className="mb-10">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-medium">Data safety</h2>
                <ChevronRight className="h-5 w-5 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Safety starts with understanding how developers collect and share your data.
              </p>
              <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
                {DATA_SAFETY.map((item, i) => (
                  <div key={i} className="flex items-start gap-4 px-5 py-4">
                    <item.icon className="h-5 w-5 text-gray-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-800">{item.title}</p>
                      {item.sub && <p className="text-xs text-gray-500 mt-0.5">{item.sub}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Ratings */}
            <section className="mb-10">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-medium">Ratings and reviews</h2>
                <ChevronRight className="h-5 w-5 text-gray-400" />
              </div>
              <div className="flex gap-10 mb-8 items-center">
                <div className="text-center">
                  <p className="text-6xl font-light">4.8</p>
                  <div className="flex justify-center mt-1">
                    {[...Array(5)].map((_, i) => <Star key={i} className="h-4 w-4 fill-green-600 text-green-600" />)}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">3 reviews</p>
                </div>
                <div className="flex-1 space-y-1.5">
                  <RatingBar label="5" pct={80} />
                  <RatingBar label="4" pct={15} />
                  <RatingBar label="3" pct={5} />
                  <RatingBar label="2" pct={0} />
                  <RatingBar label="1" pct={0} />
                </div>
              </div>
              <div className="space-y-8">
                {REVIEWS.map((r, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-8 h-8 rounded-full ${r.bg} flex items-center justify-center text-white text-xs font-semibold`}>{r.initials}</div>
                      <span className="text-sm font-medium">{r.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <StarRow count={r.stars} />
                      <span className="text-xs text-gray-500">{r.date}</span>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed">{r.body}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          <div className="lg:w-72 flex-shrink-0 space-y-6">

            <div className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-start gap-3 mb-4">
                <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">Android Only</p>
                  <p className="text-xs text-gray-500">iOS is not supported due to platform restrictions for enterprise apps.</p>
                </div>
              </div>
              <button
                onClick={handleDownload}
                className="w-full bg-[#01875f] hover:bg-[#017352] text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Download className="h-4 w-4" />
                Download APK
              </button>
            </div>

            <div className="border border-gray-200 rounded-xl p-5">
              <h3 className="font-medium text-sm mb-4">App info</h3>
              <div className="space-y-3 text-sm">
                {[
                  ["Version", `v${data.version}`],
                  ["Updated", updatedLabel ?? "—"],
                  ["Size", data.size],
                  ["Requires", data.requires],
                  ["Developer", "Atmosfair"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-500">{k}</span>
                    <span className="text-gray-800 font-medium text-right">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">App support</h3>
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Contact <span className="text-green-700 font-medium">support@atmosfair.com</span>
              </p>
            </div>

            <div className="border border-gray-200 rounded-xl p-5">
              <h3 className="font-medium text-sm mb-4">Who can use this app</h3>
              <div className="space-y-3 text-xs text-gray-600">
                {[
                  { icon: Shield, color: "text-blue-500", role: "Organisation Admins", desc: "Full access to org data and reporting" },
                  { icon: CheckCircle, color: "text-green-500", role: "Sales Agents (ACSL)", desc: "Create and manage field sales" },
                  { icon: CheckCircle, color: "text-purple-500", role: "Partner Agents", desc: "Manage partner stoves and customers" },
                ].map((item) => (
                  <div key={item.role} className="flex items-start gap-2">
                    <item.icon className={`h-4 w-4 ${item.color} flex-shrink-0 mt-0.5`} />
                    <div>
                      <p className="font-medium text-gray-800">{item.role}</p>
                      <p className="text-gray-500">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* System requirements */}
            {requirements.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-5">
                <h3 className="font-medium text-sm mb-4">Requirements</h3>
                <ul className="space-y-2">
                  {requirements.map((req, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                      <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 py-6 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} Atmosfair · All rights reserved
      </div>
    </div>
  );
}
