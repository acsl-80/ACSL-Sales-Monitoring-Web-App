
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import Modal from "@/components/ui/modal";
import { FormGrid, FormFieldWrapper } from "@/components/ui/form-grid";
import { X, Plus, Save } from "lucide-react";
import { lgaAndStates } from "../constants";

const OrganizationFormModal = ({
  isOpen,
  onClose,
  onSubmit,
  initialData = null,
  loading = false,
  submitLoading = false, // Add separate prop for submit loading
}) => {
  const [formData, setFormData] = useState({
    partner_name: "", // Required
    branch: "", // Required
    state: "", // Required
    contact_person: "", // Optional
    contact_phone: "", // Optional
    alternative_phone: "", // Optional
    email: "", // Optional
    address: "", // Optional
  });

  // Update form data when initialData changes
  useEffect(() => {
    if (initialData) {
      setFormData({
        partner_name: initialData.partner_name || "",
        branch: initialData.branch || "",
        state: initialData.state || "",
        contact_person: initialData.contact_person || "",
        contact_phone: initialData.contact_phone || "",
        alternative_phone: initialData.alternative_phone || "",
        email: initialData.email || "",
        address: initialData.address || "",
      });
    } else {
      // Reset form for new organization
      setFormData({
        partner_name: "",
        branch: "",
        state: "",
        contact_person: "",
        contact_phone: "",
        alternative_phone: "",
        email: "",
        address: "",
      });
    }
    // Clear any existing errors when form data changes
    setErrors({});
  }, [initialData, isOpen]);

  const [errors, setErrors] = useState({});

  const nigerianStates = Object.keys(lgaAndStates).sort();

  const validateForm = () => {
    const newErrors = {};

    // Required fields - only 3 required fields
    if (!formData.partner_name.trim()) {
      newErrors.partner_name = "Partner name is required";
    }

    if (!formData.branch.trim()) {
      newErrors.branch = "Branch is required";
    }

    if (!formData.state.trim()) {
      newErrors.state = "State is required";
    }

    // Field length validations
    if (formData.partner_name.length > 100) {
      newErrors.partner_name = "Partner name must be 100 characters or less";
    }

    if (formData.branch.length > 100) {
      newErrors.branch = "Branch must be 100 characters or less";
    }

    if (formData.contact_phone && formData.contact_phone.length > 20) {
      newErrors.contact_phone = "Contact phone must be 20 characters or less";
    }

    if (formData.contact_person && formData.contact_person.length > 100) {
      newErrors.contact_person =
        "Contact person must be 100 characters or less";
    }

    if (formData.alternative_phone && formData.alternative_phone.length > 20) {
      newErrors.alternative_phone =
        "Alternative phone must be 20 characters or less";
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    if (formData.address && formData.address.length > 255) {
      newErrors.address = "Address must be 255 characters or less";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({
        ...prev,
        [field]: undefined,
      }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Clean up form data - remove empty strings
    const cleanedData = Object.entries(formData).reduce((acc, [key, value]) => {
      if (value !== "" && value !== null && value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {});

    // Call onSubmit but don't close modal - parent will handle success/error
    onSubmit(cleanedData);
  };

  const handleClose = () => {
    setErrors({});
    onClose();
  };

  const isEditing = !!initialData;

  return (
    <Modal
      open={isOpen}
      onOpenChange={handleClose}
      title={
        isEditing ? (
          <span className="flex items-center gap-2">
            <Save className="h-5 w-5" /> Edit Organization
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Plus className="h-5 w-5" /> Add New Organization
          </span>
        )
      }
      description={
        isEditing
          ? "Update the organization details below."
          : "Fill in the information below to create a new partner."
      }
      size="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Required Fields Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-900">
            Required Information
          </h3>
          <FormGrid>
            {/* Partner Name */}
            <FormFieldWrapper fullWidth>
              <Label htmlFor="partner_name" className="text-gray-700">
                Partner Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="partner_name"
                value={formData.partner_name}
                onChange={(e) =>
                  handleInputChange("partner_name", e.target.value)
                }
                placeholder="Enter partner name"
                maxLength={100}
                className={`text-sm text-gray-600 ${
                  errors.partner_name ? "border-red-500" : ""
                }`}
              />
              {errors.partner_name && (
                <p className="text-xs text-red-500">{errors.partner_name}</p>
              )}
            </FormFieldWrapper>

            {/* Branch */}
            <FormFieldWrapper>
              <Label htmlFor="branch" className="text-gray-700">
                Branch <span className="text-red-500">*</span>
              </Label>
              <Input
                id="branch"
                value={formData.branch}
                onChange={(e) => handleInputChange("branch", e.target.value)}
                placeholder="Enter branch name"
                maxLength={100}
                className={`text-sm text-gray-600 ${
                  errors.branch ? "border-red-500" : ""
                }`}
              />
              {errors.branch && (
                <p className="text-xs text-red-500">{errors.branch}</p>
              )}
            </FormFieldWrapper>

            {/* State */}
            <FormFieldWrapper>
              <Label htmlFor="state" className="text-gray-700">
                State <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.state}
                onValueChange={(value) => handleInputChange("state", value)}
              >
                <SelectTrigger
                  className={`text-sm text-gray-600 ${
                    errors.state ? "border-red-500" : ""
                  }`}
                >
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {nigerianStates.map((state) => (
                    <SelectItem key={state} value={state}>
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.state && (
                <p className="text-xs text-red-500">{errors.state}</p>
              )}
            </FormFieldWrapper>
          </FormGrid>
        </div>

        {/* Optional Fields Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-900">
            Contact Information (Optional)
          </h3>
          <FormGrid>
            {/* Contact Person */}
            <FormFieldWrapper>
              <Label htmlFor="contact_person" className="text-gray-700">
                Contact Person
              </Label>
              <Input
                id="contact_person"
                value={formData.contact_person}
                onChange={(e) =>
                  handleInputChange("contact_person", e.target.value)
                }
                placeholder="John Doe"
                maxLength={100}
                className={`text-sm text-gray-600 ${
                  errors.contact_person ? "border-red-500" : ""
                }`}
              />
              {errors.contact_person && (
                <p className="text-xs text-red-500">{errors.contact_person}</p>
              )}
            </FormFieldWrapper>

            {/* Contact Phone */}
            <FormFieldWrapper>
              <Label htmlFor="contact_phone" className="text-gray-700">
                Contact Phone
              </Label>
              <Input
                id="contact_phone"
                value={formData.contact_phone}
                onChange={(e) =>
                  handleInputChange("contact_phone", e.target.value)
                }
                placeholder="+234123456789"
                maxLength={20}
                className={`text-sm text-gray-600 ${
                  errors.contact_phone ? "border-red-500" : ""
                }`}
              />
              {errors.contact_phone && (
                <p className="text-xs text-red-500">{errors.contact_phone}</p>
              )}
            </FormFieldWrapper>

            {/* Alternative Phone */}
            <FormFieldWrapper>
              <Label htmlFor="alternative_phone" className="text-gray-700">
                Alternative Phone
              </Label>
              <Input
                id="alternative_phone"
                value={formData.alternative_phone}
                onChange={(e) =>
                  handleInputChange("alternative_phone", e.target.value)
                }
                placeholder="+234987654321"
                maxLength={20}
                className={`text-sm text-gray-600 ${
                  errors.alternative_phone ? "border-red-500" : ""
                }`}
              />
              {errors.alternative_phone && (
                <p className="text-xs text-red-500">
                  {errors.alternative_phone}
                </p>
              )}
            </FormFieldWrapper>

            {/* Email */}
            <FormFieldWrapper>
              <Label htmlFor="email" className="text-gray-700">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange("email", e.target.value)}
                placeholder="contact@example.com"
                className={`text-sm text-gray-600 ${
                  errors.email ? "border-red-500" : ""
                }`}
              />
              {errors.email && (
                <p className="text-xs text-red-500">{errors.email}</p>
              )}
            </FormFieldWrapper>

            {/* Address */}
            <FormFieldWrapper fullWidth>
              <Label htmlFor="address" className="text-gray-700">
                Address
              </Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => handleInputChange("address", e.target.value)}
                placeholder="123 Business Street"
                maxLength={255}
                className={`text-sm text-gray-600 ${
                  errors.address ? "border-red-500" : ""
                }`}
              />
              {errors.address && (
                <p className="text-xs text-red-500">{errors.address}</p>
              )}
            </FormFieldWrapper>
          </FormGrid>
        </div>

        {/* Form Actions */}
        <div className="flex gap-3 pt-6 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            className="flex-1"
            disabled={submitLoading}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={submitLoading}>
            {submitLoading ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                {isEditing ? "Updating..." : "Creating..."}
              </div>
            ) : (
              <>
                {isEditing ? (
                  <Save className="h-4 w-4 mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                {isEditing ? "Update" : "Create"}
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default OrganizationFormModal;
