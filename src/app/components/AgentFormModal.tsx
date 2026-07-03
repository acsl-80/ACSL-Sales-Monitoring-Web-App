
import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  UserPlus,
  Save,
  Loader2,
  Eye,
  EyeOff,
  Copy,
  RefreshCw,
  Search,
  Building2,
  ChevronDown,
  ChevronUp,
  MapPin,
  Check,
  X,
} from "lucide-react";
import superAdminAgentService from "../services/superAdminAgentService";
import organizationsService from "../services/organizationsService";
import { lgaAndStates } from "../constants";
import { useAuth } from "../contexts/useAuth";

const ALL_STATES = Object.keys(lgaAndStates).sort();

const STATE_COLORS = [
  { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  { bg: "#e0e7ff", text: "#3730a3", border: "#a5b4fc" },
  { bg: "#d1fae5", text: "#065f46", border: "#6ee7b7" },
  { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" },
  { bg: "#ede9fe", text: "#5b21b6", border: "#c4b5fd" },
  { bg: "#cffafe", text: "#164e63", border: "#67e8f9" },
  { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" },
  { bg: "#f3e8ff", text: "#6b21a8", border: "#d8b4fe" },
  { bg: "#dcfce7", text: "#14532d", border: "#86efac" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AcslAgent {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  created_at: string;
  assigned_organizations_count: number;
  assigned_states_count: number;
}

interface Org {
  id: string;
  partner_name: string;
  branch?: string | null;
  state?: string | null;
}

interface AgentFormModalProps {
  mode: "create" | "edit";
  agent?: AcslAgent;
  onClose: () => void;
  onSuccess: (agent: AcslAgent) => void;
}

// ── Shared compact field ───────────────────────────────────────────────────────

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-0.5">
    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
      {label}
    </p>
    {children}
  </div>
);

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentFormModal({
  mode,
  agent,
  onClose,
  onSuccess,
}: AgentFormModalProps) {
  const { userRole, user } = useAuth();
  const isCallerManager = userRole === "acsl_agent_manager";

  const [role, setRole] = useState(
    mode === "edit" ? (agent?.role ?? "acsl_agent") : "acsl_agent"
  );
  const [fullName, setFullName] = useState(
    mode === "edit" ? (agent?.full_name ?? "") : ""
  );
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(
    mode === "edit" ? (agent?.phone ?? "") : ""
  );
  const [status, setStatus] = useState<"active" | "disabled">(
    mode === "edit"
      ? ((agent?.status as "active" | "disabled") ?? "active")
      : "active"
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Partner assignment
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [partnersOpen, setPartnersOpen] = useState(mode === "create");

  // Assignment state — direct orgs + state-level
  const [selectedDirectOrgIds, setSelectedDirectOrgIds] = useState<Set<string>>(new Set());
  const [originalOrgIds, setOriginalOrgIds] = useState<Set<string>>(new Set());
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [originalStates, setOriginalStates] = useState<Set<string>>(new Set());

  // UI for assignment section
  const [assignMode, setAssignMode] = useState<"state" | "partner">("state");
  const [orgSearch, setOrgSearch] = useState("");
  const [stateSearch, setStateSearch] = useState("");
  const [stateColorMap, setStateColorMap] = useState<Record<string, number>>({});

  const isAcslRole = role === "acsl_agent" || role === "acsl_agent_manager";

  // Scoped states for manager — only states assigned to them
  const [managerAssignedStates, setManagerAssignedStates] = useState<string[]>([]);

  // Load orgs — managers only see their assigned orgs, super admin sees all
  useEffect(() => {
    if (!isAcslRole) return;
    setOrgsLoading(true);
    if (isCallerManager && user?.id) {
      // Load only orgs assigned to this manager (direct + state-resolved)
      superAdminAgentService.getAgentOrganizations(user.id)
        .then((r: any) => setOrgs(r.data || []))
        .finally(() => setOrgsLoading(false));
      // Also load manager's assigned states to restrict the state picker
      superAdminAgentService.getAgentStates(user.id)
        .then((r: any) => setManagerAssignedStates((r.data || []).map((s: any) => s.state)));
    } else {
      organizationsService
        .getAllOrganizations()
        .then((r: any) => setOrgs(r.data || []))
        .finally(() => setOrgsLoading(false));
    }
  }, [isAcslRole, isCallerManager, user?.id]);

  // Load existing assignments for edit
  useEffect(() => {
    if (mode !== "edit" || !agent?.id || !isAcslRole) return;
    setAssignmentLoading(true);
    Promise.all([
      superAdminAgentService.getAgentOrganizations(agent.id),
      superAdminAgentService.getAgentStates(agent.id),
    ])
      .then(([orgsRes, statesRes]: any[]) => {
        const directIds = new Set<string>(
          (orgsRes.data || [])
            .filter((o: any) => !o.source || o.source === "direct")
            .map((o: any) => o.id as string)
        );
        const states = new Set<string>(
          (statesRes.data || []).map((s: any) => s.state as string)
        );
        setSelectedDirectOrgIds(new Set(directIds));
        setOriginalOrgIds(new Set(directIds));
        setSelectedStates(new Set(states));
        setOriginalStates(new Set(states));
        // Assign colors to pre-loaded states
        const colorMap: Record<string, number> = {};
        Array.from(states).forEach((s, i) => { colorMap[s] = i; });
        setStateColorMap(colorMap);
      })
      .catch(() => {})
      .finally(() => setAssignmentLoading(false));
  }, [mode, agent?.id, isAcslRole]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const orgCountByState = useMemo(() => {
    const counts: Record<string, number> = {};
    orgs.forEach((o) => {
      if (o.state) counts[o.state] = (counts[o.state] || 0) + 1;
    });
    return counts;
  }, [orgs]);

  // Managers can only assign agents to their own states; super admin sees all states
  const availableStates = isCallerManager ? managerAssignedStates : ALL_STATES;
  const visibleStates = availableStates.filter(
    (s) => !selectedStates.has(s) && s.toLowerCase().includes(stateSearch.toLowerCase())
  );

  const filteredOrgsForPartnerMode = orgs.filter((o) => {
    const q = orgSearch.toLowerCase();
    return (
      o.partner_name.toLowerCase().includes(q) ||
      (o.branch || "").toLowerCase().includes(q) ||
      (o.state || "").toLowerCase().includes(q)
    );
  });

  const selectedStatesWithPartners = Array.from(selectedStates).filter(
    (s) => orgs.some((o) => o.state === s)
  );

  const totalSelected = useMemo(() => {
    const stateCovered = new Set<string>();
    orgs.forEach((o) => { if (o.state && selectedStates.has(o.state)) stateCovered.add(o.id); });
    return new Set([...selectedDirectOrgIds, ...stateCovered]).size;
  }, [orgs, selectedStates, selectedDirectOrgIds]);

  const hasBottomContent = selectedStatesWithPartners.length > 0;

  // ── Color helpers ─────────────────────────────────────────────────────────────

  const getStateColor = (s: string) =>
    STATE_COLORS[(stateColorMap[s] ?? 0) % STATE_COLORS.length];

  // ── Toggle helpers ────────────────────────────────────────────────────────────

  const toggleState = (s: string) => {
    const isSelected = selectedStates.has(s);
    if (isSelected) {
      const otherStates = new Set(Array.from(selectedStates).filter((st) => st !== s));
      setSelectedStates(otherStates);
      setSelectedDirectOrgIds((prev) => {
        const next = new Set(prev);
        orgs.forEach((o) => {
          if (o.state === s && !otherStates.has(o.state ?? "")) next.delete(o.id);
        });
        return next;
      });
    } else {
      const usedIndices = new Set(Object.values(stateColorMap));
      let nextIdx = 0;
      while (usedIndices.has(nextIdx)) nextIdx++;
      setStateColorMap((prev) => ({ ...prev, [s]: nextIdx }));
      setSelectedStates((prev) => new Set([...prev, s]));
      const ids = orgs.filter((o) => o.state === s).map((o) => o.id);
      setSelectedDirectOrgIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const toggleOrg = (id: string) =>
    setSelectedDirectOrgIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Utilities ─────────────────────────────────────────────────────────────────

  const generatePassword = () => {
    const charset =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let pwd = "";
    pwd += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)];
    pwd += "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
    pwd += "0123456789"[Math.floor(Math.random() * 10)];
    pwd += "!@#$%^&*"[Math.floor(Math.random() * 8)];
    for (let i = 4; i < 12; i++)
      pwd += charset[Math.floor(Math.random() * charset.length)];
    pwd = pwd.split("").sort(() => Math.random() - 0.5).join("");
    setPassword(pwd);
    setConfirmPassword(pwd);
    copyToClipboard(pwd);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage("Copied!");
    } catch {
      setCopyMessage("Failed to copy");
    }
    setTimeout(() => setCopyMessage(""), 2500);
  };

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!fullName.trim()) errs.push("Full name is required");
    if (mode === "create") {
      if (!email.trim()) errs.push("Email is required");
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errs.push("Invalid email address");
      if (!password) errs.push("Password is required");
      else if (password.length < 8)
        errs.push("Password must be at least 8 characters");
      if (!confirmPassword) errs.push("Please confirm the password");
      else if (password !== confirmPassword) errs.push("Passwords do not match");
    }
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (errs.length > 0) { setErrors(errs); return; }

    setSubmitting(true);
    setErrors([]);
    try {
      if (mode === "create") {
        const result = await superAdminAgentService.createSuperAdminAgent({
          full_name: fullName.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || undefined,
          role,
        });
        const newAgent: AcslAgent = result.data;
        if (isAcslRole) {
          await Promise.all([
            selectedDirectOrgIds.size > 0
              ? superAdminAgentService.setAgentOrganizations(newAgent.id, [...selectedDirectOrgIds])
              : Promise.resolve(),
            selectedStates.size > 0
              ? superAdminAgentService.setAgentStates(newAgent.id, [...selectedStates])
              : Promise.resolve(),
          ]);
        }
        onSuccess({
          ...newAgent,
          assigned_organizations_count: selectedDirectOrgIds.size,
          assigned_states_count: selectedStates.size,
        });
      } else {
        const updates: Record<string, string> = {};
        if (fullName.trim() !== agent!.full_name) updates.full_name = fullName.trim();
        if ((phone.trim() || null) !== agent!.phone) updates.phone = phone.trim();
        if (status !== agent!.status) updates.status = status;

        let updatedAgent = { ...agent! };
        if (Object.keys(updates).length > 0) {
          const result = await superAdminAgentService.updateSuperAdminAgent(agent!.id, updates);
          updatedAgent = { ...updatedAgent, ...result.data };
        }

        if (isAcslRole) {
          const orgsChanged =
            [...selectedDirectOrgIds].some((id) => !originalOrgIds.has(id)) ||
            [...originalOrgIds].some((id) => !selectedDirectOrgIds.has(id));
          const statesChanged =
            [...selectedStates].some((s) => !originalStates.has(s)) ||
            [...originalStates].some((s) => !selectedStates.has(s));
          await Promise.all([
            orgsChanged
              ? superAdminAgentService.setAgentOrganizations(agent!.id, [...selectedDirectOrgIds])
              : Promise.resolve(),
            statesChanged
              ? superAdminAgentService.setAgentStates(agent!.id, [...selectedStates])
              : Promise.resolve(),
          ]);
        }

        onSuccess({
          ...updatedAgent,
          assigned_organizations_count: isAcslRole
            ? selectedDirectOrgIds.size
            : agent!.assigned_organizations_count,
          assigned_states_count: isAcslRole
            ? selectedStates.size
            : agent!.assigned_states_count,
        });
      }
    } catch (err: any) {
      setErrors([err.message || `Failed to ${mode === "create" ? "create" : "update"} agent`]);
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === "create"
    ? role === "super_admin"
      ? "Add Super Admin"
      : role === "acsl_agent_manager"
      ? "Add ACSL Agent Manager"
      : "Create Agent"
    : "Edit Agent";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="px-4 py-2.5 bg-gradient-to-r from-primary/5 to-primary/10 border-b shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-bold text-foreground">
              {title}
            </DialogTitle>
            {mode === "edit" && agent && (
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                agent.status === "active"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-600 border-red-200"
              }`}>
                {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
              </span>
            )}
          </div>
          {mode === "edit" && agent && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{agent.email}</p>
          )}
        </DialogHeader>

        {/* Body */}
        <form
          id="agent-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto space-y-2.5"
        >
          {/* Errors */}
          {errors.length > 0 && (
            <div className="space-y-1 px-4 pt-2">
              {errors.map((err, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded text-[11px] text-red-700"
                >
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {err}
                </div>
              ))}
            </div>
          )}

          {copyMessage && (
            <div className="px-4 pt-1">
              <div className="px-2.5 py-1.5 bg-green-50 border border-green-200 rounded text-[11px] text-green-700">
                {copyMessage}
              </div>
            </div>
          )}

          {/* ── Create fields ── */}
          {mode === "create" && (
            <div className="border border-border/60 rounded-md overflow-hidden">
              <div className="px-3 py-1.5 bg-muted/40 border-b border-border/60">
                <p className="text-[11px] font-semibold text-foreground">Agent Details</p>
              </div>
              <div className="px-3 py-2.5 grid grid-cols-2 gap-2.5">
                <div className="col-span-2">
                  <Field label="Role *">
                    <Select value={role} onValueChange={setRole}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="acsl_agent">ACSL Agent</SelectItem>
                        {!isCallerManager && (
                          <SelectItem value="acsl_agent_manager">ACSL Agent Manager</SelectItem>
                        )}
                        {!isCallerManager && (
                          <SelectItem value="super_admin">Super Admin</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {role === "super_admin" && (
                      <p className="text-[10px] text-orange-600 mt-0.5">
                        Super Admin has full system access. Use with caution.
                      </p>
                    )}
                    {role === "acsl_agent_manager" && (
                      <p className="text-[10px] text-blue-600 mt-0.5">
                        ACSL Agent Manager will be assigned to states and partners, and can create ACSL agents under them.
                      </p>
                    )}
                  </Field>
                </div>

                <div className="col-span-2">
                  <Field label="Full Name *">
                    <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Enter full name" className="h-7 text-xs" />
                  </Field>
                </div>

                <Field label="Email Address *">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter email" className="h-7 text-xs" />
                </Field>

                <Field label="Phone Number">
                  <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" className="h-7 text-xs" />
                </Field>

                <Field label="Password *">
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      className="h-7 text-xs pr-16"
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-0.5">
                      {password && (
                        <button type="button" onClick={() => copyToClipboard(password)} className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground">
                          <Copy className="h-3 w-3" />
                        </button>
                      )}
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground">
                        {showPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                  <button type="button" onClick={generatePassword} className="mt-0.5 text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5">
                    <RefreshCw className="h-2.5 w-2.5" />Auto-generate &amp; copy
                  </button>
                </Field>

                <Field label="Confirm Password *">
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      className="h-7 text-xs pr-8"
                    />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute inset-y-0 right-0 h-full w-7 flex items-center justify-center text-muted-foreground hover:text-foreground">
                      {showConfirmPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                  </div>
                </Field>
              </div>
            </div>
          )}

          {/* ── Edit fields ── */}
          {mode === "edit" && (
            <div className=" border border-border/60 rounded-md overflow-hidden">
              <div className="px-3 py-1.5 bg-muted/40 border-b border-border/60">
                <p className="text-[11px] font-semibold text-foreground">Agent Details</p>
              </div>
              <div className="px-3 py-2.5 grid grid-cols-2 gap-2.5">
                <Field label="Full Name *">
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Enter full name" className="h-7 text-xs" />
                </Field>
                <Field label="Phone Number">
                  <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" className="h-7 text-xs" />
                </Field>
                <div className="col-span-2">
                  <Field label="Status">
                    <Select value={status} onValueChange={(v) => setStatus(v as "active" | "disabled")}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>
            </div>
          )}

          {/* ── Partner Assignment ── */}
          {isAcslRole && (
            <div className=" border border-border/60 rounded-md overflow-hidden">
              {/* Section toggle header */}
              <button
                type="button"
                onClick={() => setPartnersOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-1.5 bg-muted/40 hover:bg-muted/60 transition-colors"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                  <Building2 className="h-3 w-3 text-primary" />
                  Partner Assignment
                  {totalSelected > 0 && (
                    <span className="bg-[#07376a] text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                      {totalSelected} selected
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">
                    {mode === "create" ? "Optional" : "Manage"}
                  </span>
                  {partnersOpen
                    ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
                    : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                </span>
              </button>

              {partnersOpen && (
                <>
                  {/* Mode toggle */}
                  <div className="px-3 pt-2 pb-0">
                    <div className="flex gap-1 p-0.5 bg-muted/40 rounded-lg border border-border/50 w-fit">
                      {(["state", "partner"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => { setAssignMode(m); setOrgSearch(""); setStateSearch(""); }}
                          className={[
                            "flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold transition-all",
                            assignMode === m
                              ? "bg-[#07376a] text-white shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          ].join(" ")}
                        >
                          {m === "state" ? <MapPin className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
                          {m === "state" ? "By State" : "By Partner"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {orgsLoading || assignmentLoading ? (
                    <div className="flex items-center justify-center py-8 gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      <span className="text-[11px] text-muted-foreground">
                        {assignmentLoading ? "Loading assignments..." : "Loading partners..."}
                      </span>
                    </div>
                  ) : assignMode === "state" ? (
                    /* ── By State ── */
                    <div className="px-3 pt-2 pb-2 space-y-1.5">
                      {/* Selected state pills */}
                      {selectedStates.size > 0 && (
                        <div className="flex flex-wrap gap-1 pb-0.5">
                          {Array.from(selectedStates).map((s) => {
                            const c = getStateColor(s);
                            return (
                              <button
                                key={s}
                                type="button"
                                onClick={() => toggleState(s)}
                                style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
                                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-opacity hover:opacity-80"
                              >
                                {s}
                                <X className="h-2.5 w-2.5 ml-0.5" />
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {/* State search */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold leading-tight text-[#8c0000]">
                          Click to select state(s)
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              const newColorMap = { ...stateColorMap };
                              const usedIndices = new Set(Object.values(newColorMap));
                              let nextIdx = 0;
                              availableStates.filter(s => !selectedStates.has(s)).forEach(s => {
                                while (usedIndices.has(nextIdx)) nextIdx++;
                                newColorMap[s] = nextIdx;
                                usedIndices.add(nextIdx++);
                              });
                              setStateColorMap(newColorMap);
                              setSelectedStates(new Set(availableStates));
                              setSelectedDirectOrgIds(prev => {
                                const next = new Set(prev);
                                orgs.forEach(o => { if (o.state && availableStates.includes(o.state)) next.add(o.id); });
                                return next;
                              });
                            }}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded border border-[#07376a]/40 bg-[#07376a]/10 text-[#07376a] hover:bg-[#07376a]/20 transition-colors"
                          >
                            Assign All
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedStates(new Set());
                              setSelectedDirectOrgIds(prev => {
                                const next = new Set(prev);
                                orgs.forEach(o => { if (o.state) next.delete(o.id); });
                                return next;
                              });
                            }}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                          >
                            Unassign All
                          </button>
                        </div>
                      </div>
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <Input
                          placeholder="Search states..."
                          value={stateSearch}
                          onChange={(e) => setStateSearch(e.target.value)}
                          className="pl-6 h-7 text-[11px]"
                        />
                      </div>
                      {/* State grid */}
                      {visibleStates.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground text-center py-3">
                          {stateSearch ? "No states match your search." : "All states selected."}
                        </p>
                      ) : (
                        <div className="grid grid-cols-6 gap-1 max-h-44 overflow-y-auto">
                          {visibleStates.map((state) => {
                            const count = orgCountByState[state] || 0;
                            return (
                              <button
                                key={state}
                                type="button"
                                onClick={() => toggleState(state)}
                                className="flex flex-col items-center px-1 py-1.5 rounded border text-center transition-colors bg-muted/30 border-border/50 text-gray-700 hover:bg-[#07376a]/10 hover:border-[#07376a]/40"
                                title={`${state} — ${count} partner${count !== 1 ? "s" : ""}`}
                              >
                                <span className="text-[10px] font-semibold leading-tight truncate w-full">{state}</span>
                                <span className="text-[9px] leading-tight mt-0.5 text-muted-foreground">
                                  {count} partner{count !== 1 ? "s" : ""}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* ── By Partner ── */
                    <div className="px-3 pt-2 pb-2 space-y-1.5">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <Input
                          placeholder="Search partners by name, state or branch..."
                          value={orgSearch}
                          onChange={(e) => setOrgSearch(e.target.value)}
                          className="pl-6 h-7 text-[11px]"
                        />
                      </div>
                      {filteredOrgsForPartnerMode.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground text-center py-4">
                          {orgSearch ? "No partners match your search." : "No partners found."}
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-1 max-h-44 overflow-y-auto">
                          {filteredOrgsForPartnerMode.map((org) => {
                            const selected = selectedDirectOrgIds.has(org.id);
                            return (
                              <button
                                key={org.id}
                                type="button"
                                onClick={() => toggleOrg(org.id)}
                                className={[
                                  "flex flex-col items-start px-2 py-1.5 rounded border text-left transition-colors",
                                  selected
                                    ? "bg-[#07376a] border-[#07376a] hover:bg-[#07376a]/90"
                                    : "bg-muted/30 border-border/50 hover:border-primary/40 hover:bg-muted/60",
                                ].join(" ")}
                              >
                                <p className={`text-[11px] font-medium truncate w-full ${selected ? "text-white" : "text-gray-900"}`}>
                                  {org.partner_name}
                                </p>
                                <p className={`text-[10px] truncate w-full ${selected ? "text-white/70" : "text-muted-foreground"}`}>
                                  {[org.branch, org.state].filter(Boolean).join(" · ") || "—"}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                </>
              )}

              {/* Bottom: column-per-state with checkboxes — always visible when states are selected */}
              {hasBottomContent && (
                <div className="border-t border-border/50 max-h-48 overflow-auto">
                  <div className="flex divide-x divide-border/50 min-w-0">
                    {selectedStatesWithPartners.map((s) => {
                      const c = getStateColor(s);
                      const statePartners = orgs.filter((o) => o.state === s);
                      const selectedCount = statePartners.filter((o) => selectedDirectOrgIds.has(o.id)).length;
                      return (
                        <div key={s} className="flex-1 min-w-[140px]">
                          <div
                            className="sticky top-0 px-2 py-1.5 flex items-center justify-between gap-1 border-b"
                            style={{ backgroundColor: c.bg, borderColor: c.border }}
                          >
                            <div className="flex items-center gap-1 min-w-0">
                              <MapPin className="h-2.5 w-2.5 shrink-0" style={{ color: c.text }} />
                              <span className="text-[10px] font-bold uppercase tracking-wide truncate" style={{ color: c.text }}>{s}</span>
                            </div>
                            <span className="text-[9px] shrink-0" style={{ color: c.text, opacity: 0.7 }}>{selectedCount}/{statePartners.length}</span>
                          </div>
                          {statePartners.map((o, idx) => {
                            const checked = selectedDirectOrgIds.has(o.id);
                            return (
                              <button
                                key={o.id}
                                type="button"
                                onClick={() => toggleOrg(o.id)}
                                className={[
                                  "w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors",
                                  idx % 2 === 0 ? "bg-white" : "bg-blue-50/30",
                                  "hover:bg-blue-50",
                                ].join(" ")}
                              >
                                <div className={[
                                  "w-3.5 h-3.5 rounded border-2 shrink-0 flex items-center justify-center transition-colors",
                                  checked ? "bg-[#07376a] border-[#07376a]" : "border-gray-300",
                                ].join(" ")}>
                                  {checked && <Check className="h-2 w-2 text-white" />}
                                </div>
                                <div className="min-w-0">
                                  <p className={`text-[11px] font-medium truncate ${checked ? "text-gray-900" : "text-gray-500"}`}>
                                    {o.partner_name}
                                  </p>
                                  {o.branch && (
                                    <p className="text-[9px] text-muted-foreground truncate">{o.branch}</p>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-4 py-2 border-t bg-muted/20 flex items-center justify-end gap-2 shrink-0">
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="agent-form"
            size="sm"
            className="h-7 text-xs bg-[#07376a] hover:bg-[#07376a]/90 text-white"
            disabled={submitting}
          >
            {submitting ? (
              <><Loader2 className="h-3 w-3 mr-1 animate-spin" />{mode === "create" ? "Creating..." : "Saving..."}</>
            ) : mode === "create" ? (
              <><UserPlus className="h-3 w-3 mr-1" />Create Agent</>
            ) : (
              <><Save className="h-3 w-3 mr-1" />Save Changes</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
