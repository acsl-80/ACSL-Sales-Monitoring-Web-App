
import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, Mail, Eye, EyeOff, Send, Loader2, AlertTriangle,
  Shield, Search, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight,
  ChevronLeft, FileText, CheckCircle2, XCircle, Clock, Zap, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmailConfig } from "../../hooks/useEmailConfig";
import { useAuth } from "../../contexts/useAuth";
import { useToast } from "@/components/ui/toast";

const IS_DEV = process.env.NODE_ENV === "development";

export default function EmailNotificationSettings({ onBack }) {
  const { config, loading, saving, testing, saveConfig, testConnection } = useEmailConfig();
  const { supabase } = useAuth();
  const { toast } = useToast();

  // Config form state
  const [apiKey, setApiKey] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [showTestField, setShowTestField] = useState(false);

  // Email Logs state
  const [emailLogs, setEmailLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsSearch, setLogsSearch] = useState("");
  const [logsStatusFilter, setLogsStatusFilter] = useState("all");
  const [logsTypeFilter, setLogsTypeFilter] = useState("all");
  const [logsPage, setLogsPage] = useState(1);
  const [logsPageSize, setLogsPageSize] = useState(25);
  const [logsTotalCount, setLogsTotalCount] = useState(0);

  useEffect(() => {
    if (config) {
      setApiKey(config.resend_api_key ?? "");
      setSenderName(config.sender_name ?? "");
      setSenderEmail(config.sender_email ?? "");
    }
  }, [config]);

  const fetchEmailLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      let query = supabase
        .from("email_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      if (logsSearch) {
        query = query.or(
          `recipient_email.ilike.%${logsSearch}%,subject.ilike.%${logsSearch}%,recipient_name.ilike.%${logsSearch}%`
        );
      }
      if (logsStatusFilter !== "all") query = query.eq("status", logsStatusFilter);
      if (logsTypeFilter === "automatic") query = query.eq("is_automatic", true);
      else if (logsTypeFilter === "manual") query = query.eq("is_automatic", false);

      query = query.range((logsPage - 1) * logsPageSize, logsPage * logsPageSize - 1);

      const { data, error, count } = await query;
      if (error) throw error;
      setEmailLogs(data ?? []);
      setLogsTotalCount(count ?? 0);
    } catch (err) {
      console.error("Error fetching email logs:", err);
    } finally {
      setLogsLoading(false);
    }
  }, [logsSearch, logsStatusFilter, logsTypeFilter, logsPage, logsPageSize]);

  useEffect(() => { fetchEmailLogs(); }, [fetchEmailLogs]);

  const handleSave = async () => {
    const result = await saveConfig({ resend_api_key: apiKey, sender_name: senderName, sender_email: senderEmail });
    if (result.success) {
      toast({ variant: "success", title: "Email settings saved" });
    } else {
      toast({ variant: "error", title: "Failed to save", description: result.error });
    }
  };

  const handleTest = async () => {
    if (!testEmail) return;
    const result = await testConnection(testEmail);
    if (result.success) {
      toast({ variant: "success", title: "Test email sent", description: `Sent to ${testEmail}` });
    } else {
      toast({ variant: "error", title: "Test failed", description: result.error });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const logsTotalPages = Math.max(1, Math.ceil(logsTotalCount / logsPageSize));
  const logsStart = (logsPage - 1) * logsPageSize + 1;
  const logsEnd = Math.min(logsPage * logsPageSize, logsTotalCount);


  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Mail className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Email Notification Settings</h2>
          <p className="text-sm text-muted-foreground">Configure email delivery via Resend and view logs</p>
        </div>
      </div>

      <Tabs defaultValue="configuration" className="w-full">
        <TabsList className={IS_DEV ? "w-full grid grid-cols-3" : "w-full grid grid-cols-2"}>
          <TabsTrigger value="configuration" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />Configuration
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />Email Logs
          </TabsTrigger>
          {IS_DEV && (
            <TabsTrigger value="recipients" className="flex items-center gap-2">
              <Users className="h-4 w-4" />Recipients
              <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">DEV</Badge>
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Tab 1: Configuration ── */}
        <TabsContent value="configuration" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resend Configuration</CardTitle>
              <CardDescription>
                Enter your Resend API key and sender details. All credential and notification emails will be sent from here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiKey">Resend API Key</Label>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-10 w-10"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Get your API key from{" "}
                  <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    resend.com/api-keys
                  </a>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="senderName">Sender Name</Label>
                <Input
                  id="senderName"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="e.g. Atmosfair Sales"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="senderEmail">Sender Email</Label>
                <Input
                  id="senderEmail"
                  type="email"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="e.g. no-reply@atmosfair.com"
                />
                <p className="text-xs text-muted-foreground">
                  Must be a verified domain in your Resend account.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button onClick={handleSave} disabled={saving || !apiKey || !senderEmail}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Settings
                </Button>
                <Button variant="outline" onClick={() => setShowTestField(!showTestField)}>
                  <Send className="mr-2 h-4 w-4" />Send Test Email
                </Button>
              </div>

              {showTestField && (
                <div className="flex items-end gap-3 border-t border-border mt-4 pt-4">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="testEmail">Recipient Email</Label>
                    <Input
                      id="testEmail"
                      type="email"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      placeholder="Enter email address to send test to"
                      onKeyDown={(e) => e.key === "Enter" && handleTest()}
                    />
                  </div>
                  <Button onClick={handleTest} disabled={testing || !testEmail}>
                    {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    {testing ? "Sending..." : "Send"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {config?.is_configured && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-green-600 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />Email Configured
                </CardTitle>
                <CardDescription>
                  Emails will be sent from{" "}
                  <strong>
                    {config.sender_name ? `${config.sender_name} <${config.sender_email}>` : config.sender_email}
                  </strong>.
                  Agent credentials and password reset emails will use Resend.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {!config?.is_configured && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 pt-4">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">Email not configured</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Agent welcome emails and password reset emails won't be sent until you configure Resend above.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Tab 2: Email Logs ── */}
        <TabsContent value="logs" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">Email Logs</CardTitle>
                  <CardDescription>History of all emails sent by the system (agent creation, password resets, tests).</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={fetchEmailLogs} disabled={logsLoading}>
                  {logsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock className="mr-2 h-4 w-4" />}
                  Refresh
                </Button>
              </div>

              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-3 mt-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by recipient or subject..."
                    value={logsSearch}
                    onChange={(e) => { setLogsSearch(e.target.value); setLogsPage(1); }}
                    className="pl-9"
                  />
                </div>
                <Select value={logsStatusFilter} onValueChange={(v) => { setLogsStatusFilter(v); setLogsPage(1); }}>
                  <SelectTrigger className="w-full sm:w-[140px]">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={logsTypeFilter} onValueChange={(v) => { setLogsTypeFilter(v); setLogsPage(1); }}>
                  <SelectTrigger className="w-full sm:w-[140px]">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="automatic">Automatic</SelectItem>
                    <SelectItem value="manual">Manual / Test</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent>
              {logsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : emailLogs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No email logs found.
                </div>
              ) : (
                <TooltipProvider>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Date & Time</th>
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs">Recipient</th>
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Subject</th>
                          <th className="text-center py-2 px-3 font-medium text-muted-foreground text-xs">Type</th>
                          <th className="text-center py-2 px-3 font-medium text-muted-foreground text-xs">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emailLogs.map((log) => {
                          const date = new Date(log.created_at);
                          return (
                            <tr key={log.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                              <td className="py-2 px-3">
                                <div className="text-xs text-foreground">{date.toLocaleDateString()}</div>
                                <div className="text-[11px] text-muted-foreground">{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                              </td>
                              <td className="py-2 px-3">
                                <div className="text-xs text-foreground truncate max-w-[180px]">
                                  {log.recipient_name || log.recipient_email}
                                </div>
                                {log.recipient_name && (
                                  <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">{log.recipient_email}</div>
                                )}
                              </td>
                              <td className="py-2 px-3 hidden md:table-cell">
                                <span className="text-xs text-foreground truncate block max-w-[240px]">{log.subject}</span>
                                {log.notification_key && (
                                  <span className="text-[10px] text-muted-foreground">{log.notification_key}</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center">
                                {log.is_automatic ? (
                                  <Badge variant="secondary" className="text-[10px] px-2 py-0">
                                    <Zap className="h-3 w-3 mr-1" />Auto
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] px-2 py-0">Manual</Badge>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center">
                                {log.status === "sent" ? (
                                  <Badge className="text-[10px] px-2 py-0 bg-emerald-500/15 text-emerald-700 border-emerald-500/20 hover:bg-emerald-500/20">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />Sent
                                  </Badge>
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="destructive" className="text-[10px] px-2 py-0 cursor-help">
                                        <XCircle className="h-3 w-3 mr-1" />Failed
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-[300px]">
                                      <p className="text-xs">{log.error_message || "Unknown error"}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </TooltipProvider>
              )}

              {/* Pagination */}
              {logsTotalCount > 0 && (
                <div className="flex items-center justify-between px-2 py-4 border-t border-border mt-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-muted-foreground">{logsStart}–{logsEnd} of {logsTotalCount}</p>
                    <Select value={logsPageSize.toString()} onValueChange={(v) => { setLogsPageSize(parseInt(v)); setLogsPage(1); }}>
                      <SelectTrigger className="w-20 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">per page</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setLogsPage(1)} disabled={logsPage === 1}><ChevronsLeft className="h-4 w-4" /></Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setLogsPage(logsPage - 1)} disabled={logsPage === 1}><ChevronLeft className="h-4 w-4" /></Button>
                    <span className="text-sm text-muted-foreground px-2">
                      Page <span className="font-medium text-foreground">{logsPage}</span> of {logsTotalPages}
                    </span>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setLogsPage(logsPage + 1)} disabled={logsPage === logsTotalPages}><ChevronRight className="h-4 w-4" /></Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setLogsPage(logsTotalPages)} disabled={logsPage === logsTotalPages}><ChevronsRight className="h-4 w-4" /></Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Recipients (DEV only) ── */}
        {IS_DEV && (
          <TabsContent value="recipients" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Email Recipients
                  <Badge variant="outline" className="text-[10px]">Dev Only</Badge>
                </CardTitle>
                <CardDescription>
                  Per-user email notification preferences. This tab is only visible in development mode.
                  Full recipient management coming soon.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Recipient management is not yet implemented for this project.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
