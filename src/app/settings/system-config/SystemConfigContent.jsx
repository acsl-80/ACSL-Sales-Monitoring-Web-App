
import { useState, useEffect } from "react";
import DashboardLayout from "../../components/DashboardLayout";
import ProtectedRoute from "../../components/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SlidersHorizontal, Shield, Save, CheckCircle2, Eye, EyeOff, Loader2, CheckCheck, Plus, Trash2, Pencil, Link, X, Copy, ToggleLeft, ToggleRight, AlertCircle, Mail, ChevronRight, ArrowLeft } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import { useAuth } from "../../contexts/useAuth";
import EmailNotificationSettings from "./EmailNotificationSettings";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1";

const SystemConfigPage = () => {
  const { supabase } = useAuth();
  const [activeSubPanel, setActiveSubPanel] = useState(null);

  // ── API Keys state ──────────────────────────────────────────────
  const [sysConfig, setSysConfig] = useState({
    google_places_api_key: "",
    google_maps_api_key: "",
    brevo_api_key: "",
    google_places_api_key_set: false,
    google_maps_api_key_set: false,
    brevo_api_key_set: false,
  });
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [configSuccess, setConfigSuccess] = useState(null);

  // ── External App Tokens state ───────────────────────────────────
  const [tokens, setTokens] = useState([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [showCreateTokenModal, setShowCreateTokenModal] = useState(false);
  const [showEditTokenModal, setShowEditTokenModal] = useState(false);
  const [showDeleteTokenModal, setShowDeleteTokenModal] = useState(false);
  const [selectedToken, setSelectedToken] = useState(null);
  const [newTokenData, setNewTokenData] = useState({
    application_name: "",
    application_description: "",
    allowed_urls: "",
  });
  const [tokenSaving, setTokenSaving] = useState(false);
  const [createdSecret, setCreatedSecret] = useState(null);
  const [tokenError, setTokenError] = useState(null);
  const [tokenSuccess, setTokenSuccess] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // ── General ─────────────────────────────────────────────────────
  const [pageError, setPageError] = useState(null);

  useEffect(() => {
    fetchConfig();
    fetchTokens();
  }, []);

  const getSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  };

  // ── API Keys ────────────────────────────────────────────────────
  const fetchConfig = async () => {
    try {
      setConfigLoading(true);
      const session = await getSession();
      const res = await fetch(`${FUNCTIONS_URL}/manage-app-settings`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const result = await res.json();
      if (result.success) {
        setSysConfig((prev) => ({
          ...prev,
          google_places_api_key_set: result.data.google_places_api_key_set,
          google_maps_api_key_set: result.data.google_maps_api_key_set,
          brevo_api_key_set: result.data.brevo_api_key_set,
        }));
      }
    } catch (err) {
      console.error("Failed to fetch config:", err);
    } finally {
      setConfigLoading(false);
    }
  };

  const hasConfigChanges =
    sysConfig.google_places_api_key !== "" ||
    sysConfig.google_maps_api_key !== "" ||
    sysConfig.brevo_api_key !== "";

  const handleConfigSave = async () => {
    if (!confirmPassword) {
      setConfirmPasswordError("Password is required to save changes");
      return;
    }
    try {
      setConfigSaving(true);
      setConfirmPasswordError("");
      const session = await getSession();

      const payload = { password: confirmPassword };
      if (sysConfig.google_places_api_key !== "")
        payload.google_places_api_key = sysConfig.google_places_api_key;
      if (sysConfig.google_maps_api_key !== "")
        payload.google_maps_api_key = sysConfig.google_maps_api_key;
      if (sysConfig.brevo_api_key !== "")
        payload.brevo_api_key = sysConfig.brevo_api_key;

      const res = await fetch(`${FUNCTIONS_URL}/manage-app-settings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await res.json();

      if (!result.success) {
        setConfirmPasswordError(
          result.error === "Incorrect password"
            ? "Incorrect password. Please try again."
            : result.error || "Failed to save settings"
        );
        return;
      }

      setShowConfirmModal(false);
      setConfirmPassword("");
      setSysConfig((prev) => ({
        google_places_api_key: "",
        google_maps_api_key: "",
        brevo_api_key: "",
        google_places_api_key_set:
          payload.google_places_api_key ? true : prev.google_places_api_key_set,
        google_maps_api_key_set:
          payload.google_maps_api_key ? true : prev.google_maps_api_key_set,
        brevo_api_key_set:
          payload.brevo_api_key ? true : prev.brevo_api_key_set,
      }));
      setConfigSuccess("Configuration saved successfully!");
      setTimeout(() => setConfigSuccess(null), 3000);
    } catch (err) {
      setConfirmPasswordError("An unexpected error occurred");
    } finally {
      setConfigSaving(false);
    }
  };

  // ── External App Tokens ─────────────────────────────────────────
  const fetchTokens = async () => {
    try {
      setTokensLoading(true);
      const session = await getSession();
      const res = await fetch(`${FUNCTIONS_URL}/manage-app-tokens`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const result = await res.json();
      if (result.success) setTokens(result.data);
      else setTokenError(result.error);
    } catch (err) {
      console.error("Failed to fetch tokens:", err);
    } finally {
      setTokensLoading(false);
    }
  };

  const handleCreateToken = async () => {
    if (!newTokenData.application_name.trim()) {
      setTokenError("Application name is required");
      return;
    }
    try {
      setTokenSaving(true);
      setTokenError(null);
      const session = await getSession();

      const allowedUrls = newTokenData.allowed_urls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean);

      const res = await fetch(`${FUNCTIONS_URL}/manage-app-tokens`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          application_name: newTokenData.application_name.trim(),
          application_description: newTokenData.application_description.trim() || null,
          allowed_urls: allowedUrls,
        }),
      });
      const result = await res.json();

      if (!result.success) {
        setTokenError(result.error || "Failed to create token");
        return;
      }

      setCreatedSecret(result.data);
      setNewTokenData({ application_name: "", application_description: "", allowed_urls: "" });
      fetchTokens();
    } catch (err) {
      setTokenError("An unexpected error occurred");
    } finally {
      setTokenSaving(false);
    }
  };

  const handleUpdateToken = async () => {
    if (!selectedToken) return;
    try {
      setTokenSaving(true);
      setTokenError(null);
      const session = await getSession();

      const allowedUrls = (selectedToken.allowed_urls_text || "")
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean);

      const res = await fetch(
        `${FUNCTIONS_URL}/manage-app-tokens?id=${selectedToken.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            application_name: selectedToken.application_name,
            application_description: selectedToken.application_description,
            allowed_urls: allowedUrls,
          }),
        }
      );
      const result = await res.json();

      if (!result.success) {
        setTokenError(result.error || "Failed to update token");
        return;
      }

      setShowEditTokenModal(false);
      setSelectedToken(null);
      setTokenSuccess("Token updated successfully!");
      setTimeout(() => setTokenSuccess(null), 3000);
      fetchTokens();
    } catch (err) {
      setTokenError("An unexpected error occurred");
    } finally {
      setTokenSaving(false);
    }
  };

  const handleToggleActive = async (token) => {
    try {
      const session = await getSession();
      await fetch(`${FUNCTIONS_URL}/manage-app-tokens?id=${token.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_active: !token.is_active }),
      });
      fetchTokens();
    } catch (err) {
      console.error("Failed to toggle token:", err);
    }
  };

  const handleDeleteToken = async () => {
    if (!selectedToken) return;
    try {
      setTokenSaving(true);
      const session = await getSession();
      const res = await fetch(
        `${FUNCTIONS_URL}/manage-app-tokens?id=${selectedToken.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session?.access_token}` },
        }
      );
      const result = await res.json();
      if (!result.success) {
        setTokenError(result.error);
        return;
      }
      setShowDeleteTokenModal(false);
      setSelectedToken(null);
      setTokenSuccess("Token deleted successfully!");
      setTimeout(() => setTokenSuccess(null), 3000);
      fetchTokens();
    } catch (err) {
      setTokenError("An unexpected error occurred");
    } finally {
      setTokenSaving(false);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "Never";

  // ── Landing: two-card nav (no sub-panel selected) ─────────────────
  if (!activeSubPanel) {
    return (
      <ProtectedRoute requireSuperAdmin={true}>
        <DashboardLayout currentRoute="settings" title="Settings">
          <div className="max-w-4xl mx-auto p-6 space-y-6">
            <PageHeader icon={SlidersHorizontal} title="Settings" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* System Config card */}
              <Card
                className="cursor-pointer transition-colors hover:bg-accent/50"
                onClick={() => setActiveSubPanel("system-config")}
              >
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <SlidersHorizontal className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">System Configuration</p>
                    <p className="text-sm text-muted-foreground">API keys, app tokens & credentials</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>

              {/* Email Settings card */}
              <Card
                className="cursor-pointer transition-colors hover:bg-accent/50"
                onClick={() => setActiveSubPanel("email-settings")}
              >
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">Email Notification Settings</p>
                    <p className="text-sm text-muted-foreground">Configure Resend, view email logs</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </div>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  // ── Email sub-panel ─────────────────────────────────────────────
  if (activeSubPanel === "email-settings") {
    return (
      <ProtectedRoute requireSuperAdmin={true}>
        <DashboardLayout currentRoute="settings" title="Email Settings">
          <div className="max-w-4xl mx-auto p-6">
            <EmailNotificationSettings onBack={() => setActiveSubPanel(null)} />
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  // ── System Config sub-panel ─────────────────────────────────────
  return (
    <ProtectedRoute requireSuperAdmin={true}>
      <DashboardLayout currentRoute="settings" title="System Configuration">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setActiveSubPanel(null)} className="shrink-0">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <PageHeader
              icon={SlidersHorizontal}
              title="System Configuration"
            />
          </div>

          {/* ── API Keys Card ─────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="h-5 w-5" />
                API Keys & Credentials
              </CardTitle>
            </CardHeader>
            <CardContent>
              {configSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 mb-4">
                  <CheckCheck className="h-4 w-4 text-green-600" />
                  <span className="text-green-700 text-sm">{configSuccess}</span>
                </div>
              )}

              {configLoading ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading configuration...
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="googlePlacesKey">Google Places API Key</Label>
                      {sysConfig.google_places_api_key_set && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Configured
                        </span>
                      )}
                    </div>
                    <Input
                      id="googlePlacesKey"
                      type="password"
                      placeholder={
                        sysConfig.google_places_api_key_set
                          ? "•••••••••••• (leave blank to keep current)"
                          : "Enter Google Places API key"
                      }
                      value={sysConfig.google_places_api_key}
                      onChange={(e) =>
                        setSysConfig((prev) => ({ ...prev, google_places_api_key: e.target.value }))
                      }
                    />
                    <p className="text-xs text-gray-500">
                      Used for address autocomplete when creating sales.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="googleMapsKey">Google Maps API Key</Label>
                      {sysConfig.google_maps_api_key_set && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Configured
                        </span>
                      )}
                    </div>
                    <Input
                      id="googleMapsKey"
                      type="password"
                      placeholder={
                        sysConfig.google_maps_api_key_set
                          ? "•••••••••••• (leave blank to keep current)"
                          : "Enter Google Maps API key"
                      }
                      value={sysConfig.google_maps_api_key}
                      onChange={(e) =>
                        setSysConfig((prev) => ({ ...prev, google_maps_api_key: e.target.value }))
                      }
                    />
                    <p className="text-xs text-gray-500">
                      Used to load the Google Maps SDK for location features. Set HTTP referrer restrictions on this key in Google Cloud Console.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="brevoKey">Brevo API Key</Label>
                      {sysConfig.brevo_api_key_set && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Configured
                        </span>
                      )}
                    </div>
                    <Input
                      id="brevoKey"
                      type="password"
                      placeholder={
                        sysConfig.brevo_api_key_set
                          ? "•••••••••••• (leave blank to keep current)"
                          : "Enter Brevo API key"
                      }
                      value={sysConfig.brevo_api_key}
                      onChange={(e) =>
                        setSysConfig((prev) => ({ ...prev, brevo_api_key: e.target.value }))
                      }
                    />
                    <p className="text-xs text-gray-500">
                      Used to send login credentials to newly created agents via email.
                    </p>
                  </div>

                  <div className="pt-4 border-t border-gray-200 flex justify-end">
                    <Dialog
                      open={showConfirmModal}
                      onOpenChange={(open) => {
                        setShowConfirmModal(open);
                        if (!open) { setConfirmPassword(""); setConfirmPasswordError(""); }
                      }}
                    >
                      <DialogTrigger asChild>
                        <Button
                          className="bg-brand hover:bg-brand-700 text-white"
                          disabled={!hasConfigChanges}
                        >
                          <Save className="h-4 w-4 mr-2" />
                          Save Configuration
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-amber-500" />
                            Confirm Identity
                          </DialogTitle>
                          <DialogDescription>
                            Enter your password to confirm and save these sensitive credentials.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 pt-2">
                          <div className="space-y-2">
                            <Label htmlFor="confirmPassword">Your Password</Label>
                            <div className="relative">
                              <Input
                                id="confirmPassword"
                                type={showConfirmPassword ? "text" : "password"}
                                placeholder="Enter your password"
                                value={confirmPassword}
                                onChange={(e) => {
                                  setConfirmPassword(e.target.value);
                                  setConfirmPasswordError("");
                                }}
                                className={confirmPasswordError ? "border-red-500" : ""}
                                onKeyDown={(e) => e.key === "Enter" && handleConfigSave()}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-1 top-1/2 -translate-y-1/2"
                                onClick={() => setShowConfirmPassword((p) => !p)}
                              >
                                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                            </div>
                            {confirmPasswordError && (
                              <p className="text-sm text-red-600">{confirmPasswordError}</p>
                            )}
                          </div>
                          <div className="flex justify-end gap-3 pt-2">
                            <Button variant="outline" onClick={() => setShowConfirmModal(false)} disabled={configSaving}>
                              Cancel
                            </Button>
                            <Button onClick={handleConfigSave} disabled={configSaving} className="bg-brand hover:bg-brand-700 text-white">
                              {configSaving ? (
                                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
                              ) : (
                                <><Save className="h-4 w-4 mr-2" />Confirm & Save</>
                              )}
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── External App Tokens Card ──────────────────────── */}
          {/* <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Link className="h-5 w-5" />
                  External App Tokens
                </CardTitle>
                <Button
                  className="bg-brand hover:bg-brand-700 text-white"
                  size="sm"
                  onClick={() => {
                    setCreatedSecret(null);
                    setTokenError(null);
                    setNewTokenData({ application_name: "", application_description: "", allowed_urls: "" });
                    setShowCreateTokenModal(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  New Token
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {tokenSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 mb-4">
                  <CheckCheck className="h-4 w-4 text-green-600" />
                  <span className="text-green-700 text-sm">{tokenSuccess}</span>
                </div>
              )}

              {tokensLoading ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading tokens...
                </div>
              ) : tokens.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No external app tokens yet. Create one to allow external applications to sync data.
                </div>
              ) : (
                <div className="space-y-3">
                  {tokens.map((token) => (
                    <div
                      key={token.id}
                      className="border border-gray-200 rounded-lg p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 text-sm">
                              {token.application_name}
                            </span>
                            <Badge
                              className={
                                token.is_active
                                  ? "bg-green-100 text-green-700"
                                  : "bg-gray-100 text-gray-500"
                              }
                            >
                              {token.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          {token.application_description && (
                            <p className="text-xs text-gray-500">{token.application_description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleActive(token)}
                            title={token.is_active ? "Deactivate" : "Activate"}
                          >
                            {token.is_active
                              ? <ToggleRight className="h-4 w-4 text-green-600" />
                              : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedToken({
                                ...token,
                                allowed_urls_text: (token.allowed_urls || []).join("\n"),
                              });
                              setTokenError(null);
                              setShowEditTokenModal(true);
                            }}
                          >
                            <Pencil className="h-4 w-4 text-gray-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedToken(token);
                              setShowDeleteTokenModal(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="space-y-1">
                          <span className="text-gray-500 font-medium uppercase tracking-wide">Token</span>
                          <div className="flex items-center gap-1 bg-gray-50 rounded p-2 font-mono text-gray-700">
                            <span className="truncate flex-1">{token.token}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0"
                              onClick={() => copyToClipboard(token.token, `token-${token.id}`)}
                            >
                              {copiedId === `token-${token.id}`
                                ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                                : <Copy className="h-3 w-3 text-gray-400" />}
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <span className="text-gray-500 font-medium uppercase tracking-wide">Allowed URLs</span>
                          {token.allowed_urls?.length > 0 ? (
                            <div className="space-y-1">
                              {token.allowed_urls.map((url, i) => (
                                <div key={i} className="bg-blue-50 text-blue-700 rounded px-2 py-1 truncate">
                                  {url}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 italic">All URLs allowed (*)</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-gray-400 pt-1 border-t border-gray-100">
                        <span>Uses: {token.usage_count ?? 0}</span>
                        <span>Last used: {formatDate(token.last_used_at)}</span>
                        <span>Created: {formatDate(token.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card> */}
        </div>

        {/* ── Create Token Modal ──────────────────────────────── */}
        <Dialog open={showCreateTokenModal} onOpenChange={(open) => {
          setShowCreateTokenModal(open);
          if (!open) { setCreatedSecret(null); setTokenError(null); }
        }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                {createdSecret ? "Token Created" : "Create External App Token"}
              </DialogTitle>
              <DialogDescription>
                {createdSecret
                  ? "Save the secret key now — it will not be shown again."
                  : "Generate a token for an external application to sync data with this platform."}
              </DialogDescription>
            </DialogHeader>

            {createdSecret ? (
              <div className="space-y-4">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  ⚠️ Copy and store the secret key securely. It cannot be retrieved after closing this dialog.
                </div>
                <div className="space-y-3">
                  {[
                    { label: "Token", value: createdSecret.token, id: "new-token" },
                    { label: "Secret Key", value: createdSecret.secret_key, id: "new-secret" },
                  ].map(({ label, value, id }) => (
                    <div key={id} className="space-y-1">
                      <Label className="text-xs text-gray-500 uppercase tracking-wide">{label}</Label>
                      <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded p-2 font-mono text-xs text-gray-800">
                        <span className="break-all flex-1">{value}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 shrink-0"
                          onClick={() => copyToClipboard(value, id)}
                        >
                          {copiedId === id
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            : <Copy className="h-3.5 w-3.5 text-gray-400" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end pt-2">
                  <Button onClick={() => setShowCreateTokenModal(false)} className="bg-brand hover:bg-brand-700 text-white">
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {tokenError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                    <span className="text-red-700 text-sm">{tokenError}</span>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="appName">Application Name *</Label>
                  <Input
                    id="appName"
                    placeholder="e.g. Field Sync App"
                    value={newTokenData.application_name}
                    onChange={(e) => setNewTokenData((p) => ({ ...p, application_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="appDesc">Description</Label>
                  <Input
                    id="appDesc"
                    placeholder="Optional description"
                    value={newTokenData.application_description}
                    onChange={(e) => setNewTokenData((p) => ({ ...p, application_description: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="allowedUrls">Allowed URLs</Label>
                  <textarea
                    id="allowedUrls"
                    className="w-full min-h-[80px] text-sm border border-gray-200 rounded-md px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder={"One URL per line, e.g.:\nhttps://app.example.com\nhttps://partner.org\nLeave empty to allow all (*)"}
                    value={newTokenData.allowed_urls}
                    onChange={(e) => setNewTokenData((p) => ({ ...p, allowed_urls: e.target.value }))}
                  />
                  <p className="text-xs text-gray-500">Leave blank to allow requests from any URL.</p>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => setShowCreateTokenModal(false)} disabled={tokenSaving}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateToken} disabled={tokenSaving} className="bg-brand hover:bg-brand-700 text-white">
                    {tokenSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : <><Plus className="h-4 w-4 mr-2" />Create Token</>}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* ── Edit Token Modal ────────────────────────────────── */}
        <Dialog open={showEditTokenModal} onOpenChange={(open) => {
          setShowEditTokenModal(open);
          if (!open) { setSelectedToken(null); setTokenError(null); }
        }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5" />
                Edit Token
              </DialogTitle>
              <DialogDescription>Update the token&apos;s details and allowed URLs.</DialogDescription>
            </DialogHeader>
            {selectedToken && (
              <div className="space-y-4">
                {tokenError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                    <span className="text-red-700 text-sm">{tokenError}</span>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Application Name</Label>
                  <Input
                    value={selectedToken.application_name}
                    onChange={(e) => setSelectedToken((p) => ({ ...p, application_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    value={selectedToken.application_description || ""}
                    onChange={(e) => setSelectedToken((p) => ({ ...p, application_description: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Allowed URLs</Label>
                  <textarea
                    className="w-full min-h-[80px] text-sm border border-gray-200 rounded-md px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder={"One URL per line\nLeave empty to allow all (*)"}
                    value={selectedToken.allowed_urls_text || ""}
                    onChange={(e) => setSelectedToken((p) => ({ ...p, allowed_urls_text: e.target.value }))}
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => setShowEditTokenModal(false)} disabled={tokenSaving}>
                    Cancel
                  </Button>
                  <Button onClick={handleUpdateToken} disabled={tokenSaving} className="bg-brand hover:bg-brand-700 text-white">
                    {tokenSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-2" />Save Changes</>}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* ── Delete Token Modal ──────────────────────────────── */}
        <Dialog open={showDeleteTokenModal} onOpenChange={(open) => {
          setShowDeleteTokenModal(open);
          if (!open) setSelectedToken(null);
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <Trash2 className="h-5 w-5" />
                Delete Token
              </DialogTitle>
              <DialogDescription>
                This will permanently revoke access for <strong>{selectedToken?.application_name}</strong>. Any external application using this token will stop working immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowDeleteTokenModal(false)} disabled={tokenSaving}>
                Cancel
              </Button>
              <Button
                onClick={handleDeleteToken}
                disabled={tokenSaving}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {tokenSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</> : <><Trash2 className="h-4 w-4 mr-2" />Delete Token</>}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DashboardLayout>
    </ProtectedRoute>
  );
};

export default SystemConfigPage;
