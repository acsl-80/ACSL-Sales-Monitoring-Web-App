
import React, { useState, useEffect } from "react";
import { useRouter } from "@/compat/navigation";
import ProtectedRoute from "../components/ProtectedRoute";
import DashboardLayout from "../components/DashboardLayout";
import { useAuth } from "../contexts/useAuth";
import { useToastNotification } from "../contexts/useToastNotification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Edit,
  Save,
  X,
  Loader2,
  AlertCircle,
  Key,
  User,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import manageProfileService from "../services/manageProfileService";
import ChangePasswordModal from "./components/ChangePasswordModal";

interface ProfileData {
  profile: {
    id: string;
    full_name: string;
    email: string;
    username: string;
    role: string;
    organization_id: string | null;
    created_at: string;
  };
  organization: {
    id: string;
    partner_id: string;
    partner_name: string;
    email?: string;
    contact_person?: string;
    contact_phone?: string;
    alternative_phone?: string;
    address?: string;
    state?: string;
    branch?: string;
    created_at?: string;
    stove_ids?: Array<{
      id: string;
      stove_id: string;
      status: string;
      organization_id: string;
    }>;
  } | null;
  credential_info?: {
    partner_id: string;
    partner_name: string;
    role: string;
    is_dummy_email: boolean;
  };
}

// ── Shared primitives ────────────────────────────────────────────────────────

const DetailItem = ({
  label,
  value,
  span2 = false,
}: {
  label: string;
  value: React.ReactNode;
  span2?: boolean;
}) => (
  <div className={`space-y-0.5 ${span2 ? "md:col-span-2" : ""}`}>
    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
      {label}
    </p>
    <p className="text-xs font-medium text-gray-900">
      {value ?? <span className="text-gray-400">N/A</span>}
    </p>
  </div>
);

const SectionCard = ({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
    <div className="flex items-center justify-between border-b border-primary/20 pb-1.5 mb-3">
      <h3 className="text-[11px] font-semibold text-primary uppercase tracking-wider">
        {title}
      </h3>
      {action}
    </div>
    {children}
  </div>
);

const formatRole = (role?: string) => {
  if (!role) return "—";
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const formatDate = (dateString?: string) => {
  if (!dateString) return "N/A";
  try {
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "Invalid Date";
  }
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAdmin, isSuperAdmin, signOut } = useAuth();
  const { toast } = useToastNotification();
  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stove pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Form state
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    currentPassword: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await manageProfileService.getProfile();
      if (response.success && response.data) {
        setProfileData(response.data);
        setFormData({
          username: response.data.profile.username || "",
          email: response.data.profile.email || "",
          currentPassword: "",
        });
      } else {
        setError(response.error || "Failed to load profile");
        toast.error("Error", response.error || "Failed to load profile");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(msg);
      toast.error("Error", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleEditToggle = () => {
    if (editMode && profileData) {
      setFormData({
        username: profileData.profile.username || "",
        email: profileData.profile.email || "",
        currentPassword: "",
      });
      setFormErrors({});
    }
    setEditMode((v) => !v);
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (formErrors[field]) setFormErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.username.trim()) errors.username = "Username is required";
    if (!formData.email.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
      errors.email = "Invalid email format";
    const hasChanges =
      formData.username !== profileData?.profile.username ||
      formData.email !== profileData?.profile.email;
    if (!hasChanges) errors.general = "No changes detected";
    if (hasChanges && !formData.currentPassword.trim())
      errors.currentPassword = "Current password is required to update your profile";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleLogoutAfterUpdate = async () => {
    await new Promise((r) => setTimeout(r, 2000));
    toast.info("Logging out", "Please log in again with your new credentials");
    await new Promise((r) => setTimeout(r, 1000));
    await signOut();
    router.push("/login");
  };

  const handleSaveProfile = async () => {
    if (!validateForm()) return;
    setUpdateLoading(true);
    setError(null);
    try {
      const updates: { currentPassword: string; newUsername?: string; newEmail?: string } = {
        currentPassword: formData.currentPassword,
      };
      if (formData.username !== profileData?.profile.username) updates.newUsername = formData.username;
      if (formData.email !== profileData?.profile.email) updates.newEmail = formData.email;
      const response = await manageProfileService.updateProfile(updates);
      if (response.success) {
        const updatedFields = response.data?.join(", ") || "profile";
        toast.success("Profile Updated", `Successfully updated: ${updatedFields}`);
        setEditMode(false);
        setFormData((prev) => ({ ...prev, currentPassword: "" }));
        await handleLogoutAfterUpdate();
      } else {
        setFormErrors({ general: response.error || "Failed to update profile" });
        toast.error("Update Failed", response.error || "Failed to update profile");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred";
      setFormErrors({ general: msg });
      toast.error("Error", msg);
    } finally {
      setUpdateLoading(false);
    }
  };

  const handlePasswordChangeSuccess = async () => {
    toast.success("Password Updated", "Your password has been changed successfully");
    await handleLogoutAfterUpdate();
  };

  const getPaginatedStoves = () => {
    if (!profileData?.organization?.stove_ids) return [];
    const start = (currentPage - 1) * itemsPerPage;
    return profileData.organization.stove_ids.slice(start, start + itemsPerPage);
  };

  const totalStovePages = Math.ceil(
    (profileData?.organization?.stove_ids?.length || 0) / itemsPerPage
  );

  // ── Loading / Error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <ProtectedRoute>
        <DashboardLayout currentRoute="profile">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  if (error && !profileData) {
    return (
      <ProtectedRoute>
        <DashboardLayout currentRoute="profile">
          <div className="p-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-600 font-medium">Failed to load profile</p>
                <p className="text-sm text-red-600">{error}</p>
                <Button onClick={fetchProfile} variant="outline" size="sm" className="mt-2">
                  Retry
                </Button>
              </div>
            </div>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  const profile = profileData?.profile;
  const organization = profileData?.organization;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ProtectedRoute>
      <DashboardLayout currentRoute="profile" title="My Profile">
        <div className="p-6 space-y-4 max-w-4xl mx-auto">
          <PageHeader
            icon={User}
            title="My Profile"
          />

          {/* ── Profile Information ─────────────────────────────────────── */}
          <SectionCard
            title="Profile Information"
            action={
              editMode ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleEditToggle} disabled={updateLoading} className="h-7 text-xs">
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveProfile} disabled={updateLoading} className="bg-brand hover:bg-brand/90 text-white h-7 text-xs">
                    {updateLoading ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving...</>
                    ) : (
                      <><Save className="h-3 w-3 mr-1" />Save Changes</>
                    )}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={handleEditToggle} className="h-7 text-xs">
                  <Edit className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              )
            }
          >
            {/* General error */}
            {formErrors.general && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm text-red-600">{formErrors.general}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Full Name — always read-only */}
              <DetailItem label="Full Name" value={profile?.full_name || "N/A"} />

              {/* Role */}
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Role</p>
                <Badge
                  variant={
                    profile?.role === "super_admin" ? "default"
                    : profile?.role === "admin" ? "secondary"
                    : "outline"
                  }
                  className="text-xs mt-0.5"
                >
                  {formatRole(profile?.role)}
                </Badge>
              </div>

              {/* Username */}
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                  Username
                </Label>
                {editMode ? (
                  <>
                    <Input
                      value={formData.username}
                      onChange={(e) => handleChange("username", e.target.value)}
                      className={`h-8 text-xs ${formErrors.username ? "border-red-500" : ""}`}
                      disabled={updateLoading}
                    />
                    {formErrors.username && (
                      <p className="text-xs text-red-600">{formErrors.username}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs font-medium text-gray-900">{profile?.username || "N/A"}</p>
                )}
              </div>

              {/* Email */}
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                  Email
                </Label>
                {editMode ? (
                  <>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange("email", e.target.value)}
                      className={`h-8 text-xs ${formErrors.email ? "border-red-500" : ""}`}
                      disabled={updateLoading}
                    />
                    {formErrors.email && (
                      <p className="text-xs text-red-600">{formErrors.email}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs font-medium text-gray-900">{profile?.email || "N/A"}</p>
                )}
              </div>

              {/* Member since */}
              <DetailItem label="Member Since" value={formatDate(profile?.created_at)} />
            </div>

            {/* Current password — only in edit mode */}
            {editMode && (
              <div className="mt-4 pt-4 border-t border-border/50 space-y-1">
                <Label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                  Current Password <span className="text-red-500 normal-case">*required to save changes</span>
                </Label>
                <Input
                  type="password"
                  value={formData.currentPassword}
                  onChange={(e) => handleChange("currentPassword", e.target.value)}
                  placeholder="Enter your current password to confirm changes"
                  className={`h-8 text-xs ${formErrors.currentPassword ? "border-red-500" : ""}`}
                  disabled={updateLoading}
                />
                {formErrors.currentPassword && (
                  <p className="text-xs text-red-600">{formErrors.currentPassword}</p>
                )}
              </div>
            )}
          </SectionCard>

          {/* ── Organization Information ────────────────────────────────── */}
          {organization && (
            <SectionCard title="Organization Information">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DetailItem label="Partner Name" value={organization.partner_name} />
                <DetailItem label="Partner ID" value={organization.partner_id} />
                {organization.branch && (
                  <DetailItem label="Branch" value={organization.branch} />
                )}
                {organization.state && (
                  <DetailItem label="State" value={organization.state} />
                )}

                {(isAdmin || isSuperAdmin) && (
                  <>
                    {organization.email && (
                      <DetailItem label="Organization Email" value={organization.email} />
                    )}
                    {organization.contact_person && (
                      <DetailItem label="Contact Person" value={organization.contact_person} />
                    )}
                    {organization.contact_phone && (
                      <DetailItem label="Contact Phone" value={organization.contact_phone} />
                    )}
                    {organization.alternative_phone && (
                      <DetailItem label="Alternative Phone" value={organization.alternative_phone} />
                    )}
                    {organization.address && (
                      <DetailItem label="Address" value={organization.address} span2 />
                    )}
                  </>
                )}
              </div>

              {/* Assigned Stoves */}
              {(isAdmin || isSuperAdmin) && organization.stove_ids && organization.stove_ids.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border/50">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-2">
                    Assigned Stoves ({organization.stove_ids.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {getPaginatedStoves().map((stove) => (
                      <Badge
                        key={stove.id}
                        variant="outline"
                        className={`text-xs ${stove.status === "sold" ? "border-green-300 text-green-700 bg-green-50" : "border-gray-300 text-gray-600"}`}
                      >
                        {stove.stove_id}
                        <span className="ml-1 opacity-60">· {stove.status}</span>
                      </Badge>
                    ))}
                  </div>

                  {totalStovePages > 1 && (
                    <div className="flex items-center justify-between pt-3 mt-2 border-t border-border/50">
                      <p className="text-xs text-gray-500">
                        Showing {(currentPage - 1) * itemsPerPage + 1}–
                        {Math.min(currentPage * itemsPerPage, organization.stove_ids.length)} of{" "}
                        {organization.stove_ids.length}
                      </p>
                      <div className="flex gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Prev
                        </Button>
                        <span className="flex items-center px-2 text-xs text-gray-600">
                          {currentPage} / {totalStovePages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setCurrentPage((p) => Math.min(totalStovePages, p + 1))}
                          disabled={currentPage === totalStovePages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          )}

          {/* ── Security ─────────────────────────────────────────────────── */}
          <SectionCard title="Security">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-900">Password</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Change your account password</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setShowPasswordModal(true)}
              >
                <Key className="h-3.5 w-3.5 mr-1.5" />
                Change Password
              </Button>
            </div>
          </SectionCard>

        </div>

        <ChangePasswordModal
          isOpen={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
          onSuccess={handlePasswordChangeSuccess}
        />
      </DashboardLayout>
    </ProtectedRoute>
  );
}
