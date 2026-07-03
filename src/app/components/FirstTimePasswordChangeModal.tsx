
import React, { useState, useEffect } from "react";
import { useRouter } from "@/compat/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, AlertCircle, Shield } from "lucide-react";
import manageProfileService from "../services/manageProfileService";
import { useToastNotification } from "../contexts/useToastNotification";
import { useAuth } from "../contexts/useAuth";

const STORAGE_KEY_PREFIX = "password_change_reminder_";
const REMIND_LATER_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface FirstTimePasswordChangeModalProps {
  userProfile: {
    id: string;
    has_changed_password: boolean;
  } | null;
}

const FirstTimePasswordChangeModal: React.FC<
  FirstTimePasswordChangeModalProps
> = ({ userProfile }) => {
  const router = useRouter();
  const { toast } = useToastNotification();
  const { signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showChangeForm, setShowChangeForm] = useState(false);
  const [formData, setFormData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!userProfile) return;

    // Check if user has changed their password
    if (userProfile.has_changed_password) {
      return; // User has already changed password
    }

    const storageKey = `${STORAGE_KEY_PREFIX}${userProfile.id}`;

    // Check localStorage for reminder preferences
    const storedData = localStorage.getItem(storageKey);

    if (storedData) {
      try {
        const data = JSON.parse(storedData);

        // Check if user clicked "Don't remind me again"
        if (data.dontRemindAgain) {
          return;
        }

        // Check if "Remind me later" is still active
        if (data.remindLaterUntil) {
          const now = Date.now();
          if (now < data.remindLaterUntil) {
            // Still within the 24-hour reminder period
            return;
          }
        }
      } catch (e) {
        // Invalid data, clear it
        localStorage.removeItem(storageKey);
      }
    }

    // Show the modal
    setIsOpen(true);
  }, [userProfile]);

  const handleClose = () => {
    setIsOpen(false);
    setShowChangeForm(false);
    setFormData({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setErrors({});
  };

  const handleDontRemindAgain = () => {
    if (!userProfile) return;

    const storageKey = `${STORAGE_KEY_PREFIX}${userProfile.id}`;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        dontRemindAgain: true,
      })
    );

    toast.info(
      "Reminder Disabled",
      "You won't be reminded to change your password again"
    );

    handleClose();
  };

  const handleRemindLater = () => {
    if (!userProfile) return;

    const storageKey = `${STORAGE_KEY_PREFIX}${userProfile.id}`;
    const remindLaterUntil = Date.now() + REMIND_LATER_DURATION;

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        remindLaterUntil,
      })
    );

    toast.info(
      "Reminder Postponed",
      "We'll remind you again in 24 hours"
    );

    handleClose();
  };

  const handleChangePasswordClick = () => {
    setShowChangeForm(true);
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.currentPassword.trim()) {
      newErrors.currentPassword = "Current password is required";
    }

    if (!formData.newPassword.trim()) {
      newErrors.newPassword = "New password is required";
    } else if (formData.newPassword.length < 8) {
      newErrors.newPassword = "Password must be at least 8 characters";
    }

    if (!formData.confirmPassword.trim()) {
      newErrors.confirmPassword = "Please confirm your new password";
    } else if (formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    if (
      formData.currentPassword &&
      formData.newPassword &&
      formData.currentPassword === formData.newPassword
    ) {
      newErrors.newPassword =
        "New password must be different from current password";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogoutAfterUpdate = async () => {
    // Wait 2 seconds to show success message
    await new Promise((resolve) => setTimeout(resolve, 2000));

    toast.info("Logging out", "Please log in again with your new password");

    // Wait 1 more second
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Sign out and redirect to login
    await signOut();
    router.push("/login");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setErrors({});

    try {
      const response = await manageProfileService.updateProfile({
        currentPassword: formData.currentPassword,
        newPassword: formData.newPassword,
      });

      if (response.success) {
        toast.success(
          "Password Changed",
          "Your password has been updated successfully"
        );

        // Clear localStorage reminder
        if (userProfile) {
          const storageKey = `${STORAGE_KEY_PREFIX}${userProfile.id}`;
          localStorage.removeItem(storageKey);
        }

        handleClose();

        // Auto-logout after password change
        await handleLogoutAfterUpdate();
      } else {
        setErrors({ general: response.error || "Failed to update password" });
        toast.error("Update Failed", response.error || "Failed to update password");
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "An unexpected error occurred";
      setErrors({ general: errorMsg });
      toast.error("Error", errorMsg);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-full">
              <Shield className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <DialogTitle className="text-xl font-semibold">
                {showChangeForm
                  ? "Change Your Password"
                  : "Password Change Required"}
              </DialogTitle>
              <DialogDescription>
                {showChangeForm
                  ? "Create a secure password for your account"
                  : "We recommend changing your generated password"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!showChangeForm ? (
          // Initial prompt
          <div className="space-y-4 py-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800">
                Your account is currently using a generated password. For
                security reasons, we strongly recommend changing it to a
                password you'll remember.
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="font-medium text-sm">What would you like to do?</h4>
              <div className="space-y-2">
                <Button
                  onClick={handleChangePasswordClick}
                  className="w-full bg-[#07376a] hover:bg-[#07376a]/90"
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Change Password Now
                </Button>
                <Button
                  onClick={handleRemindLater}
                  variant="outline"
                  className="w-full"
                >
                  Remind Me in 24 Hours
                </Button>
                <Button
                  onClick={handleDontRemindAgain}
                  variant="ghost"
                  className="w-full text-gray-600"
                >
                  Don't Remind Me Again
                </Button>
              </div>
            </div>
          </div>
        ) : (
          // Password change form
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            {/* General Error */}
            {errors.general && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-600">{errors.general}</p>
              </div>
            )}

            {/* Current Password */}
            <div className="space-y-2">
              <Label htmlFor="firsttime-currentPassword">
                Current Password <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="firsttime-currentPassword"
                  type={showCurrentPassword ? "text" : "password"}
                  value={formData.currentPassword}
                  onChange={(e) =>
                    handleChange("currentPassword", e.target.value)
                  }
                  className={
                    errors.currentPassword ? "border-red-500 pr-10" : "pr-10"
                  }
                  placeholder="Enter your current (generated) password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  tabIndex={-1}
                >
                  {showCurrentPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.currentPassword && (
                <p className="text-sm text-red-600">{errors.currentPassword}</p>
              )}
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="firsttime-newPassword">
                New Password <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="firsttime-newPassword"
                  type={showNewPassword ? "text" : "password"}
                  value={formData.newPassword}
                  onChange={(e) => handleChange("newPassword", e.target.value)}
                  className={
                    errors.newPassword ? "border-red-500 pr-10" : "pr-10"
                  }
                  placeholder="Enter your new password (min 8 characters)"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  tabIndex={-1}
                >
                  {showNewPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.newPassword && (
                <p className="text-sm text-red-600">{errors.newPassword}</p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="firsttime-confirmPassword">
                Confirm New Password <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="firsttime-confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={(e) =>
                    handleChange("confirmPassword", e.target.value)
                  }
                  className={
                    errors.confirmPassword ? "border-red-500 pr-10" : "pr-10"
                  }
                  placeholder="Re-enter your new password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-sm text-red-600">{errors.confirmPassword}</p>
              )}
            </div>

            {/* Footer Buttons */}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowChangeForm(false)}
                disabled={loading}
              >
                Back
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-[#07376a] hover:bg-[#07376a]/90"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  "Update Password"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FirstTimePasswordChangeModal;
