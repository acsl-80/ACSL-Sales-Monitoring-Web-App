
import { useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { User, Mail, Building, Lock, Shield, Save, Eye, EyeOff, Loader2 } from "lucide-react";
import PasswordStrengthIndicator from "./PasswordStrengthIndicator";
import manageProfileService from "../services/manageProfileService";
import { useToastNotification } from "../contexts/useToastNotification";

interface UserProfileModalProps {
  open: boolean;
  onClose: () => void;
  profileData: {
    profile: {
      id: string;
      full_name: string;
      email: string;
      username: string;
      role: string;
    };
    organization?: {
      partner_name: string;
      branch?: string;
    } | null;
  };
  onProfileUpdate: () => void;
}

const UserProfileModal = ({ open, onClose, profileData, onProfileUpdate }: UserProfileModalProps) => {
  const { toast } = useToastNotification();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const { profile, organization } = profileData;

  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast.error("Error", "Current password is required");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Error", "Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Error", "Passwords do not match");
      return;
    }

    setSavingPassword(true);
    try {
      const response = await manageProfileService.updateProfile({
        currentPassword,
        newPassword,
      });

      if (response.success) {
        toast.success("Success", "Password updated successfully");
        setNewPassword("");
        setConfirmPassword("");
        setCurrentPassword("");
        onProfileUpdate();
        onClose();
      } else {
        toast.error("Update Failed", response.error || "Failed to update password");
      }
    } catch (error: any) {
      console.error("Error updating password:", error);
      toast.error("Error", error.message || "Failed to update password");
    } finally {
      setSavingPassword(false);
    }
  };

  const initials = profile.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[480px] !p-0 overflow-hidden gap-0 border-0 shadow-2xl" showPaddingOnDialogContent={false}>
        {/* Header with gradient */}
        <div className="relative bg-gradient-to-br from-[#063664] to-[#194977] px-6 pt-8 pb-12 text-white">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')] opacity-50" />
          <div className="relative flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/30 flex items-center justify-center text-xl font-bold tracking-wide">
              {initials}
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{profile.full_name}</h2>
              <p className="text-blue-200 text-sm mt-0.5">{profile.email || "No email"}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 -mt-4">
          <div className="bg-background rounded-xl shadow-sm border border-border p-5 space-y-5">
            {/* Info Fields */}
            <div className="grid gap-4">
              {/* Name */}
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Full Name</p>
                  <p className="text-sm font-medium text-foreground truncate">{profile.full_name}</p>
                </div>
              </div>

              {/* Username */}
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Username</p>
                  <p className="text-sm font-medium text-foreground truncate">{profile.username || "Not set"}</p>
                </div>
              </div>

              {/* Email */}
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Email</p>
                  <p className="text-sm font-medium text-foreground truncate">{profile.email || "Not set"}</p>
                </div>
              </div>

              {/* Organization */}
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Building className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Organization</p>
                  <p className="text-sm font-medium text-foreground truncate">{organization?.partner_name || "No Organization"}</p>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-3 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Lock className="h-3 w-3" /> Security
                </span>
              </div>
            </div>

            {/* Password Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">Change Password</p>
              </div>
              <div className="space-y-2.5">
                {/* Current Password */}
                <div className="relative">
                  <Input
                    type={showCurrentPassword ? "text" : "password"}
                    placeholder="Current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="h-9 text-sm pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* New Password */}
                <div className="relative">
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-9 text-sm pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <PasswordStrengthIndicator password={newPassword} />
                
                {/* Confirm Password */}
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-9 text-sm pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive">Passwords do not match</p>
                )}
                <Button
                  onClick={handleChangePassword}
                  disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword}
                  className="w-full h-9 bg-[#063664] hover:bg-[#194977] text-white text-sm"
                >
                  {savingPassword ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Updating...</>
                  ) : "Update Password"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UserProfileModal;
