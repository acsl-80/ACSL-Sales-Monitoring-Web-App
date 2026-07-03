
import { useState, useEffect, useRef, useMemo } from "react";
import { supabaseUrl as SUPABASE_URL } from "@/lib/supabaseConfig";
import { useRouter } from "@/compat/navigation";
import Link from "@/compat/Link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Save,
  Loader2,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import DateRangePicker from "@/app/components/ui/date-range-picker";
import GooglePlacesInput from "@/app/components/ui/google-places-input";
import { lgaAndStates } from "../../../constants";
import adminSalesService from "../../../services/adminSalesService";
import profileService from "../../../services/profileService";
import { validateSalesForm } from "../../../utils/salesFormValidation";
import {
  createInitialFormData,
  populateFormDataForEdit,
  transformFormDataForAPI,
  hasFormDataChanged,
} from "../../../utils/salesFormUtils";
import {
  loadProfileData,
  getOrganizationId,
} from "../../../utils/profileUtils";
import ImageUploadSection from "../../../components/ui/ImageUploadSection";
import SignatureCanvas from "../../../components/ui/SignatureCanvas";
import paymentModelService from "../../../services/paymentModelService";
import superAdminAgentService from "../../../services/superAdminAgentService";
import { useAuth } from "../../../contexts/useAuth";

const FormField = ({ label, error, children, htmlFor }) => (
  <div>
    <Label htmlFor={htmlFor}>{label}</Label>
    {children}
    {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
  </div>
);

const ReadOnlyTile = ({ label, value }) => (
  <div>
    <Label>{label}</Label>
    <Input value={value || ""} readOnly className="bg-gray-100" />
  </div>
);

const SAA_ROLES = ["super_admin", "acsl_agent", "acsl_agent_manager", "super_admin_agent"];

const CreateSalesForm = ({
  onSuccess,
  onCancel = null,
  cancelHref = "",
  isModal = false,
  showSuccessState = true,
  mode = "create",
  initialData = null,
  userRole = null,
  userId = null,
}) => {
  const router = useRouter();
  const { supabase } = useAuth();
  const isSuperAdmin = SAA_ROLES.includes(userRole);
  // True when no organization context exists yet — show partner picker regardless of role
  const [needsPartnerSelection, setNeedsPartnerSelection] = useState(false);
  const [loading, setLoading] = useState(false);
  const [availableStoves, setAvailableStoves] = useState([]);
  const [stovesLoading, setStovesLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Initialize form data based on mode
  const [formData, setFormData] = useState(createInitialFormData());
  const [originalFormData, setOriginalFormData] = useState(null); // For edit mode comparison
  const initializedRef = useRef(false); // Track if form has been initialized
  const [isInitializing, setIsInitializing] = useState(false); // Track if we're currently initializing

  // File refs and states - now using extracted components
  const [stoveImagePreview, setStoveImagePreview] = useState(null);
  const [agreementImagePreview, setAgreementImagePreview] = useState(null);
  const [uploadingImages, setUploadingImages] = useState({
    stove: false,
    agreement: false,
  });

  // Validation state
  const [errors, setErrors] = useState({});

  // Installment payment state
  const [paymentModels, setPaymentModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [isInstallment, setIsInstallment] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedModel, setSelectedModel] = useState(null);
  const [initialPaymentAmount, setInitialPaymentAmount] = useState("");
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("");
  const [initialPaymentProofImageId, setInitialPaymentProofImageId] = useState("");
  const [initialPaymentProofPreview, setInitialPaymentProofPreview] = useState(null);
  const [uploadingProof, setUploadingProof] = useState(false);

  // Stove search state
  const [stoveSearchTerm, setStoveSearchTerm] = useState("");
  const [showStoveDropdown, setShowStoveDropdown] = useState(false);
  const [filteredStoves, setFilteredStoves] = useState([]);
  const [stoveSearching, setStoveSearching] = useState(false);
  // Validation status for the typed/selected stove ID:
  //  "idle" | "checking" | "valid" | "invalid"
  const [stoveValidity, setStoveValidity] = useState("idle");
  const [stoveValidityMessage, setStoveValidityMessage] = useState("");


  // Partner search state (super admin only)
  const [partners, setPartners] = useState([]);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [showPartnerDropdown, setShowPartnerDropdown] = useState(false);
  const [partnersLoading, setPartnersLoading] = useState(false);

  // Partner → State → Branch cascade
  const [selectedPartnerName, setSelectedPartnerName] = useState("");
  const [partnerBranches, setPartnerBranches] = useState([]); // org rows for picked partner
  const [selectedState, setSelectedState] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(false);

  // Determine if this is edit mode
  const isEditMode = mode === "edit" && initialData;

  // Get states from constants
  const nigerianStates = Object.keys(lgaAndStates).sort();

  // Helper: resolve the currently active partner organization id
  const getActiveOrgId = () => {
    const sessionOrg = typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem("saa_selected_org_id")
      : null;
    return sessionOrg || profileService.getOrganizationId() || null;
  };

  // AJAX search: pull stove IDs as the user types (debounced).
  // Only IDs that belong to the selected partner org and are not sold are returned.
  useEffect(() => {
    if (isEditMode) return; // edit mode locks the stove id
    const orgId = getActiveOrgId();
    if (!orgId) {
      setFilteredStoves([]);
      return;
    }
    let cancelled = false;
    setStoveSearching(true);
    const handle = setTimeout(async () => {
      const res = await adminSalesService.searchStoveIds(orgId, stoveSearchTerm, 25);
      if (cancelled) return;
      setFilteredStoves(res.success ? (res.data || []) : []);
      setStoveSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      setStoveSearching(false);
    };
  }, [stoveSearchTerm, formData.partnerName, formData.retailerBranch, isEditMode]);

  // Validate the typed stove id against the partner's available stoves (debounced).
  useEffect(() => {
    if (isEditMode) return;
    const orgId = getActiveOrgId();
    const term = (stoveSearchTerm || "").trim();
    if (!orgId || !term) {
      setStoveValidity("idle");
      setStoveValidityMessage("");
      return;
    }
    let cancelled = false;
    setStoveValidity("checking");
    setStoveValidityMessage("");
    const handle = setTimeout(async () => {
      const res = await adminSalesService.validateStoveId(orgId, term);
      if (cancelled) return;
      if (res.success && res.valid) {
        setStoveValidity("valid");
        setStoveValidityMessage("Valid stove ID for this partner.");
        setFormData((prev) => ({ ...prev, stoveSerialNo: term }));
        if (errors.stoveSerialNo) setErrors((prev) => ({ ...prev, stoveSerialNo: null }));
      } else {
        setStoveValidity("invalid");
        setStoveValidityMessage(
          res.success
            ? "This stove ID is not assigned to the selected partner or is unavailable."
            : "Could not validate stove ID. Please try again.",
        );
        setFormData((prev) => ({ ...prev, stoveSerialNo: "" }));
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [stoveSearchTerm, formData.partnerName, formData.retailerBranch, isEditMode]);



  // Close stove dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest(".stove-search-container")) {
        setShowStoveDropdown(false);
      }
      if (!event.target.closest(".partner-search-container")) {
        setShowPartnerDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Debounced partner search (any user without a known org can pick a partner)
  useEffect(() => {
    if (isEditMode) return;


    const t = setTimeout(async () => {
      setPartnersLoading(true);
      try {
        // SAA agents (non-super_admin) see only their assigned partners.
        // Super admins and everyone else without an org go through manage-organizations.
        const isSaaAgent = isSuperAdmin && userRole !== "super_admin";
        if (isSaaAgent) {
          const result = await superAdminAgentService.getAgentOrganizations(userId);
          const all = result.data || [];
          const q = partnerSearch.trim().toLowerCase();
          setPartners(
            q
              ? all.filter((p) =>
                  (p.partner_name || "").toLowerCase().includes(q) ||
                  (p.branch || "").toLowerCase().includes(q)
                )
              : all
          );
        } else {
          const { data: { session } } = await supabase.auth.getSession();
          const params = new URLSearchParams({ limit: "100", offset: "0" });
          if (partnerSearch.trim()) params.set("search", partnerSearch.trim());
          const res = await fetch(
            `${SUPABASE_URL}/functions/v1/manage-organizations?${params}`,
            { headers: { Authorization: `Bearer ${session.access_token}` } }
          );
          const result = await res.json();
          if (res.ok) setPartners(result.data || []);
        }
      } catch (err) {
        console.error("Error searching partners:", err);
      } finally {
        setPartnersLoading(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [partnerSearch, needsPartnerSelection, isSuperAdmin, isEditMode, userRole, userId]);

  // Initialize form data on mount
  useEffect(() => {
    // Prevent multiple initializations
    if (initializedRef.current) return;

    const initializeForm = async () => {
      try {
        setIsInitializing(true); // Start initialization
        if (isEditMode && initialData) {
          // Edit mode: populate form with existing data
          const populatedData = await populateFormDataForEdit(initialData);
          setFormData(populatedData);
          setOriginalFormData(populatedData);

          // Set image previews if they exist
          // get-sale returns stove_image / agreement_image as objects { url, ... }
          // financial report list returns stove_image_id { url, ... }
          const stoveUrl =
            initialData.stove_image?.url ||
            initialData.stove_image_id?.url ||
            (typeof initialData.stove_image === "string" ? initialData.stove_image : null);
          if (stoveUrl) setStoveImagePreview(stoveUrl);

          const agreementUrl =
            initialData.agreement_image?.url ||
            initialData.agreement_image_id?.url ||
            (typeof initialData.agreement_image === "string" ? initialData.agreement_image : null);
          if (agreementUrl) setAgreementImagePreview(agreementUrl);

          // Set stove search term to current stove serial
          if (initialData.stove_serial_no) {
            setStoveSearchTerm(initialData.stove_serial_no);
          }

          // For edit mode, create a single-item stove list with current stove
          if (initialData?.stove_serial_no) {
            setAvailableStoves([{ stove_id: initialData.stove_serial_no }]);
            setFilteredStoves([{ stove_id: initialData.stove_serial_no }]);
          }
          setStovesLoading(false);
        } else if (!isEditMode) {
          // Create mode: load profile data and generate transaction ID
          const profileData = await loadProfileData();

          // Ensure profile is loaded (covers stale cache / fresh login)
          if (!profileService.getStoredProfileData()) {
            await profileService.fetchAndStoreProfile();
          }

          // Generate transaction ID
          const generateTransactionId = () => {
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            let result = "";
            for (let i = 0; i < 6; i++) {
              result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return result;
          };

          // Super admins always pick a partner explicitly on each new sale
          if (userRole === "super_admin" && typeof sessionStorage !== "undefined") {
            sessionStorage.removeItem("saa_selected_org_id");
            sessionStorage.removeItem("saa_selected_org_name");
          }

          // Determine whether we have an org context yet
          const knownOrgId =
            userRole === "super_admin"
              ? null
              : profileService.getOrganizationId() ||
                (typeof sessionStorage !== "undefined"
                  ? sessionStorage.getItem("saa_selected_org_id")
                  : null);
          const mustPickPartner = !knownOrgId;
          setNeedsPartnerSelection(mustPickPartner);

          // Partner name fallback: SAA sessionStorage → profile
          const saaPartnerName =
            typeof sessionStorage !== "undefined"
              ? sessionStorage.getItem("saa_selected_org_name")
              : null;

          const preselectedPartnerName = saaPartnerName || profileData?.partnerName || "";
          setFormData((prev) => ({
            ...prev,
            transactionId: generateTransactionId(),
            partnerName: preselectedPartnerName,
          }));
          if (preselectedPartnerName) {
            setPartnerSearch(preselectedPartnerName);
            setSelectedPartnerName(preselectedPartnerName);
          }


          // Auto-load stoves only if we already have an org; otherwise wait for partner pick
          if (!mustPickPartner) {
            fetchAvailableStoves();
          } else {
            setStovesLoading(false);
          }
        }

        initializedRef.current = true;
        setIsInitializing(false); // End initialization
      } catch (error) {
        console.error("Error initializing form:", error);
        setError("Failed to initialize form data");
        setIsInitializing(false); // End initialization even on error
      }
    };

    initializeForm();
  }, [isEditMode, initialData?.id]); // Only depend on the ID to prevent infinite loops

  // Reset initialization flag when mode or data changes
  useEffect(() => {
    initializedRef.current = false;
  }, [mode, initialData?.id]);

  // Check and fetch profile if not already stored
  useEffect(() => {
    const checkProfile = async () => {
      const profile = profileService.getStoredProfileData();
      if (!profile) {
        // If no profile is stored, try to fetch it
        const result = await profileService.fetchAndStoreProfile();
        if (!result.success) {
          setError("Failed to load user profile. Please log in again.");
        }
      }
    };

    checkProfile();
  }, []);

  const fetchAvailableStoves = async () => {
    try {
      setStovesLoading(true);

      // Get organization ID from stored profile (or SAA sessionStorage fallback)
      const organizationId =
        profileService.getOrganizationId() ||
        (typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem("saa_selected_org_id")
          : null);

      if (!organizationId) {
        // No org context yet — partner picker is shown; wait for selection
        setNeedsPartnerSelection(true);
        setStovesLoading(false);
        return;
      }

      // Fetch stoves with organization ID and "available" status
      const response = await adminSalesService.getAvailableStoveIds(
        organizationId,
        "available"
      );

      if (response.success) {
        setAvailableStoves(response.data || []);
      } else {
        setError("Failed to load available stoves");
      }
    } catch (err) {
      console.error("Error fetching stoves:", err);
      setError("An error occurred while loading available stoves");
    } finally {
      setStovesLoading(false);
    }
  };

  const fetchPaymentModels = async () => {
    // Payment models are decoupled from partners — always list every active
    // model so any user can pick any payment type freely regardless of partner.
    try {
      setModelsLoading(true);
      const all = await paymentModelService.getPaymentModels({ status: "active" });
      const models = (all?.data || []).filter((m) => m && m.is_active !== false);
      setPaymentModels(models);
    } catch (err) {
      console.error("Error fetching payment models:", err);
    } finally {
      setModelsLoading(false);
    }
  };

  // Fetch payment models on mount so the picker is always available
  useEffect(() => {
    if (isEditMode) return;
    fetchPaymentModels();
  }, [isEditMode]);


  // Update selected model details when model ID changes
  useEffect(() => {
    if (selectedModelId) {
      const model = paymentModels.find((m) => m.id === selectedModelId);
      setSelectedModel(model || null);
      if (model) {
        // Auto-fill amount with model's fixed price
        handleInputChange("amount", model.fixed_price.toString());
      }
    } else {
      setSelectedModel(null);
    }
  }, [selectedModelId, paymentModels]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => ({
        ...prev,
        [field]: null,
      }));
    }
  };

  const handleAddressSelect = (addressData) => {
    setFormData((prev) => ({
      ...prev,
      addressData: {
        fullAddress: addressData.fullAddress || "",
        street: addressData.street || "",
        city: addressData.city || "",
        state: addressData.state || "",
        country: addressData.country || "Nigeria",
        latitude: addressData.latitude || null,
        longitude: addressData.longitude || null,
      },
    }));

    // Clear address error when valid address is selected
    if (errors.address || errors.location) {
      setErrors((prev) => ({
        ...prev,
        address: null,
        location: null,
      }));
    }
  };

  const handleStateChange = (stateValue) => {
    setFormData((prev) => ({
      ...prev,
      stateBackup: stateValue,
      // Only reset LGA if we're not initializing the form
      lgaBackup: isInitializing ? prev.lgaBackup : "",
    }));
  };

  const handleImageUpload = async (file, type) => {
    if (!file) return;

    try {
      setUploadingImages((prev) => ({ ...prev, [type]: true }));

      // Use the correct type names to match Flutter
      const uploadType = type === "stove" ? "stoveImage" : "agreementImage";

      // Upload image using form data (matching Flutter implementation)
      const response = await adminSalesService.uploadImage(file, uploadType);

      if (response.success) {
        const field = type === "stove" ? "stoveImageId" : "agreementImageId";
        // The response should contain the upload data with id
        const uploadData = response.data.upload || response.data;
        setFormData((prev) => ({ ...prev, [field]: uploadData.id }));

        // Set preview
        const reader = new FileReader();
        reader.onload = (e) => {
          if (type === "stove") {
            setStoveImagePreview(e.target.result);
          } else {
            setAgreementImagePreview(e.target.result);
          }
        };
        reader.readAsDataURL(file);
      } else {
        setError(`Failed to upload ${type} image`);
      }
    } catch (err) {
      console.error(`Error uploading ${type} image:`, err);
      setError(`An error occurred while uploading ${type} image`);
    } finally {
      setUploadingImages((prev) => ({ ...prev, [type]: false }));
    }
  };

  // Signature handlers - now handled by SignatureCanvas component
  const handleSignatureChange = (signatureData) => {
    setFormData((prev) => ({ ...prev, signature: signatureData }));
  };

  // Handle initial payment proof image upload
  const handleProofImageUpload = async (file) => {
    if (!file) return;
    try {
      setUploadingProof(true);
      const response = await adminSalesService.uploadImage(file, "paymentProof");
      if (response.success) {
        const uploadData = response.data.upload || response.data;
        setInitialPaymentProofImageId(uploadData.id);
        const reader = new FileReader();
        reader.onload = (e) => setInitialPaymentProofPreview(e.target.result);
        reader.readAsDataURL(file);
      } else {
        setError("Failed to upload payment proof image");
      }
    } catch (err) {
      console.error("Error uploading proof image:", err);
      setError("An error occurred while uploading payment proof image");
    } finally {
      setUploadingProof(false);
    }
  };

  // Handle payment type dropdown change
  const handlePaymentTypeChange = (value) => {
    if (value === "full_payment") {
      setIsInstallment(false);
      setSelectedModelId("");
      setSelectedModel(null);
      setInitialPaymentAmount("");
      setInitialPaymentMethod("");
      setInitialPaymentProofImageId("");
      setInitialPaymentProofPreview(null);
      handleInputChange("amount", "");
    } else {
      // value is a payment model ID
      setIsInstallment(true);
      setSelectedModelId(value);
    }
  };

  const formatCurrency = (amount) =>
    `₦${Number(amount).toLocaleString("en-NG")}`;

  // Format a raw number string with commas for display in inputs
  const formatAmountInput = (value) => {
    const digits = String(value).replace(/[^0-9]/g, "");
    if (!digits) return "";
    return Number(digits).toLocaleString("en-NG");
  };

  // Strip commas to get raw number string
  const parseAmountInput = (value) => {
    return value.replace(/[^0-9]/g, "");
  };

  const validateForm = () => {
    const newErrors = validateSalesForm(formData);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Validate installment-specific fields
    if (isInstallment) {
      if (!selectedModelId) {
        setError("Please select a payment model for installment payment");
        return;
      }
    }

    // For edit mode, check if any changes were made
    if (
      isEditMode &&
      originalFormData &&
      !hasFormDataChanged(formData, originalFormData)
    ) {
      setError("No changes detected to save");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Transform form data for API
      const apiData = transformFormDataForAPI(formData);

      // For SAA users who have no profile org_id, include the org from sessionStorage
      const saaOrgId =
        typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem("saa_selected_org_id")
          : null;
      if (saaOrgId) {
        apiData.organizationId = saaOrgId;
      }

      // Add installment payment data if applicable
      if (isInstallment && selectedModelId) {
        apiData.isInstallment = true;
        apiData.paymentModelId = selectedModelId;
        if (initialPaymentAmount && parseFloat(initialPaymentAmount) > 0) {
          apiData.initialPaymentAmount = parseFloat(initialPaymentAmount);
          apiData.initialPaymentMethod = initialPaymentMethod || "cash";
          if (initialPaymentProofImageId) {
            apiData.initialPaymentProofImageId = initialPaymentProofImageId;
          }
        }
      }

      let response;
      if (isEditMode) {
        response = await adminSalesService.updateSale(initialData.id, apiData);
      } else {
        response = await adminSalesService.createSale(apiData);
      }

      if (response.success) {
        // Clean up SAA org selection from sessionStorage
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem("saa_selected_org_id");
        }
        setSuccess(true);
        if (onSuccess) {
          onSuccess(response.data);
        }
        // If it's a modal, don't show success state, let parent handle it
        if (isModal && onSuccess) {
          return;
        }
      } else {
        setError(
          response.error || `Failed to ${isEditMode ? "update" : "create"} sale`
        );
      }
    } catch (err) {
      console.error(`Error ${isEditMode ? "updating" : "creating"} sale:`, err);
      setError(
        `An unexpected error occurred while ${
          isEditMode ? "updating" : "creating"
        } the sale`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else if (!isModal) {
      router.push("/admin/sales");
    }
  };

  // Success state - only show if showSuccessState is true and not modal
  if (success && showSuccessState && !isModal) {
    return (
      <div className="h-[70dvh] flex items-center justify-center">
        <div className="text-center">
          <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Sale Created Successfully!
          </h2>
          <p className="text-gray-600 mb-4">
            The sale has been recorded and will be processed.
          </p>
          <Button onClick={() => router.push("/admin/sales")}>
            View Sales
          </Button>
        </div>
      </div>
    );
  }

  // Distinct partners (by partner_name) shown in the cascade dropdown
  const distinctPartners = useMemo(() => {
    const seen = new Map();
    for (const p of partners) {
      const key = p.partner_name || "";
      if (key && !seen.has(key)) seen.set(key, p);
    }
    return Array.from(seen.values());
  }, [partners]);

  const availableStates = useMemo(() => {
    const set = new Set(partnerBranches.map((b) => b.state).filter(Boolean));
    return Array.from(set).sort();
  }, [partnerBranches]);

  const availableBranches = useMemo(
    () => partnerBranches.filter((b) => b.state === selectedState),
    [partnerBranches, selectedState],
  );

  const finalizeBranchPick = (org) => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("saa_selected_org_id", org.id);
      sessionStorage.setItem("saa_selected_org_name", org.partner_name || "");
    }
    handleInputChange("partnerName", org.partner_name || "");
    handleInputChange("retailerBranch", org.branch || "");
    setErrors((prev) => ({ ...prev, partnerName: null, state: null, branch: null }));
    fetchAvailableStoves();
    // Payment models are global — no need to refetch per partner.
  };

  const resetStoveSelection = () => {
    setAvailableStoves([]);
    setFilteredStoves([]);
    setStoveSearchTerm("");
    setShowStoveDropdown(false);
    setStoveValidity("idle");
    setStoveValidityMessage("");
    setFormData((prev) => ({ ...prev, stoveSerialNo: "" }));
    if (errors.stoveSerialNo) {
      setErrors((prev) => ({ ...prev, stoveSerialNo: null }));
    }
  };


  const handlePartnerPick = async (partnerName) => {
    setSelectedPartnerName(partnerName);
    setSelectedState("");
    setPartnerBranches([]);
    setPartnerSearch(partnerName);
    setShowPartnerDropdown(false);
    handleInputChange("partnerName", partnerName);
    handleInputChange("retailerBranch", "");
    resetStoveSelection();
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("saa_selected_org_id");
    }

    setBranchesLoading(true);
    try {
      let rows = [];
      const isSaaAgent = isSuperAdmin && userRole !== "super_admin";
      if (isSaaAgent) {
        const result = await superAdminAgentService.getAgentOrganizations(userId);
        rows = (result.data || []).filter((o) => o.partner_name === partnerName);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const params = new URLSearchParams({
          limit: "500",
          offset: "0",
          search: partnerName,
        });
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/manage-organizations?${params}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        const result = await res.json();
        if (res.ok) {
          rows = (result.data || []).filter((o) => o.partner_name === partnerName);
        }
      }
      setPartnerBranches(rows);

      // Auto-select when only one option
      const states = Array.from(new Set(rows.map((r) => r.state).filter(Boolean)));
      if (states.length === 1) {
        setSelectedState(states[0]);
        const branches = rows.filter((r) => r.state === states[0]);
        if (branches.length === 1) finalizeBranchPick(branches[0]);
      }
    } catch (err) {
      console.error("Error loading partner branches:", err);
    } finally {
      setBranchesLoading(false);
    }
  };

  const handleStatePick = (stateValue) => {
    setSelectedState(stateValue);
    handleInputChange("retailerBranch", "");
    resetStoveSelection();
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("saa_selected_org_id");
    }
    const branches = partnerBranches.filter((r) => r.state === stateValue);
    if (branches.length === 1) finalizeBranchPick(branches[0]);
  };

  const handleBranchPick = (orgId) => {
    const org = partnerBranches.find((r) => r.id === orgId);
    if (org) finalizeBranchPick(org);
  };




  return (
    <div className="max-w-5xl mx-auto p-5">
      {/* Sales Form Header */}
      <div className="mb-6 rounded-lg overflow-hidden border border-[#4a5d0f]/20">
        <div className="bg-gradient-to-r from-[#4a5d0f] to-[#6b8016] px-6 py-5 flex items-center gap-4">
          <div className="h-11 w-11 rounded-lg bg-white/15 flex items-center justify-center">
            <FileText className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-semibold text-white leading-tight">
              {isEditMode ? "Edit Sale" : "Record a New Sale"}
            </h1>
            <p className="text-sm text-white/80 mt-0.5">
              {isEditMode
                ? "Update the details of this sales transaction."
                : "Fill in the details below to register a stove sale."}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-4 [&_input]:shadow-none [&_textarea]:shadow-none [&_[role=combobox]]:shadow-none"
      >

        {/* Transaction Information */}
        <div className="bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Transaction Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-4 mt-2">
            {/* Transaction ID is auto-generated and hidden from the UI */}

            <FormField label="Sales Date *" error={errors.salesDate} htmlFor="salesDate">
              <Input
                id="salesDate"
                type="date"
                value={formData.salesDate}
                onChange={(e) => {
                  const today = new Date().toISOString().split("T")[0];
                  // iOS Safari ignores the `max` attribute, so clamp future dates here
                  const value = e.target.value > today ? today : e.target.value;
                  handleInputChange("salesDate", value);
                }}
                max={new Date().toISOString().split("T")[0]}
                className={`w-48 ${errors.salesDate ? "border-red-500" : ""}`}
              />
            </FormField>
            {!isEditMode ? (
              <>
                <div>
                  <Label htmlFor="partnerSearch">Partner *</Label>
                  <div className="relative partner-search-container">
                    <Input
                      id="partnerSearch"
                      value={partnerSearch}
                      onChange={(e) => {
                        setPartnerSearch(e.target.value);
                        setShowPartnerDropdown(true);
                        // Clear previously selected partner & cascade when user edits
                        if (formData.partnerName) handleInputChange("partnerName", "");
                        if (selectedPartnerName) {
                          setSelectedPartnerName("");
                          setSelectedState("");
                          setPartnerBranches([]);
                          handleInputChange("retailerBranch", "");
                          resetStoveSelection();
                        }
                      }}
                      onFocus={() => setShowPartnerDropdown(true)}
                      placeholder={partnersLoading ? "Loading partners..." : "Click to select or type to search..."}
                      className={errors.partnerName ? "border-red-500" : ""}
                    />
                    {showPartnerDropdown && (

                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-52 overflow-auto">
                        {partnersLoading ? (
                          <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching...
                          </div>
                        ) : distinctPartners.length === 0 ? (
                          <p className="px-3 py-2 text-sm text-muted-foreground">No partners found</p>
                        ) : (
                          distinctPartners.map((p) => (
                            <div
                              key={p.partner_name}
                              className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
                              onClick={() => handlePartnerPick(p.partner_name)}
                            >
                              {p.partner_name}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  {errors.partnerName && <p className="text-sm text-red-500 mt-1">{errors.partnerName}</p>}
                </div>

                <div>
                  <Label htmlFor="partnerState">State *</Label>
                  <Select
                    value={selectedState}
                    onValueChange={handleStatePick}
                    disabled={!selectedPartnerName || branchesLoading || availableStates.length === 0}
                  >
                    <SelectTrigger id="partnerState">
                      <SelectValue
                        placeholder={
                          !selectedPartnerName
                            ? "Select a partner first"
                            : branchesLoading
                              ? "Loading..."
                              : availableStates.length === 0
                                ? "No states available"
                                : "Select state"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableStates.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="partnerBranch">Branch *</Label>
                  <Select
                    value={
                      formData.retailerBranch
                        ? partnerBranches.find(
                            (b) => b.state === selectedState && b.branch === formData.retailerBranch,
                          )?.id || ""
                        : ""
                    }
                    onValueChange={handleBranchPick}
                    disabled={!selectedState || availableBranches.length === 0}
                  >
                    <SelectTrigger id="partnerBranch">
                      <SelectValue
                        placeholder={
                          !selectedState
                            ? "Select a state first"
                            : availableBranches.length === 0
                              ? "No branches available"
                              : "Select branch"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableBranches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.branch}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <ReadOnlyTile label="Partner" value={formData.partnerName} />
                <ReadOnlyTile label="Branch" value={formData.retailerBranch} />
              </>
            )}
          </div>
        </div>



        {/* Buyer & End User */}
        <div className="bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Buyer &amp; End User</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-4">
            <FormField label="Contact Person / Buyer *" error={errors.contactPerson} htmlFor="contactPerson">
              <Input
                id="contactPerson"
                value={formData.contactPerson}
                onChange={(e) => handleInputChange("contactPerson", e.target.value)}
                placeholder="Buyer name"
                className={errors.contactPerson ? "border-red-500" : ""}
              />
            </FormField>
            <FormField label="Contact Phone *" error={errors.contactPhone} htmlFor="contactPhone">
              <Input
                id="contactPhone"
                type="tel"
                value={formData.contactPhone}
                onChange={(e) => handleInputChange("contactPhone", e.target.value)}
                placeholder="+234 803 123 4567"
                className={errors.contactPhone ? "border-red-500" : ""}
              />
            </FormField>
            <FormField label="End User First Name *" error={errors.endUserName} htmlFor="endUserName">
              <Input
                id="endUserName"
                value={formData.endUserName}
                onChange={(e) => handleInputChange("endUserName", e.target.value)}
                placeholder="End user first name"
                className={errors.endUserName ? "border-red-500" : ""}
              />
            </FormField>
            <FormField label="End User Surname *" error={errors.endUserSurname} htmlFor="endUserSurname">
              <Input
                id="endUserSurname"
                value={formData.endUserSurname}
                onChange={(e) => handleInputChange("endUserSurname", e.target.value)}
                placeholder="End user surname"
                className={errors.endUserSurname ? "border-red-500" : ""}
              />
            </FormField>
            <FormField label="End User Phone *" error={errors.phone} htmlFor="phone">
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleInputChange("phone", e.target.value)}
                placeholder="+234 803 123 4567"
                className={errors.phone ? "border-red-500" : ""}
              />
            </FormField>
            <FormField label="AKA" htmlFor="aka">
              <Input
                id="aka"
                value={formData.aka}
                onChange={(e) => handleInputChange("aka", e.target.value)}
                placeholder="Alias or nickname"
              />
            </FormField>
          </div>
        </div>

        {/* Sale & Payment */}
        <div className="bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Sale &amp; Payment</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-4">
            {/* Stove serial */}
            <FormField label={`Stove Serial No *${isEditMode ? " (locked)" : ""}`} error={errors.stoveSerialNo} htmlFor="stoveSerialNo">
              {isEditMode ? (
                <Input value={formData.stoveSerialNo || stoveSearchTerm || ""} readOnly className="bg-gray-100" />
              ) : (() => {
                const partnerPickerActive = needsPartnerSelection;
                const branchPending = partnerPickerActive && selectedPartnerName && !formData.partnerName;
                const noPartnerYet = partnerPickerActive && !selectedPartnerName;
                const stoveDisabled = noPartnerYet || branchPending;
                const stovePlaceholder = noPartnerYet
                  ? "Select a partner first"
                  : branchPending
                    ? "Select a branch to continue"
                    : "Type to search stove ID...";
                const term = (stoveSearchTerm || "").trim();
                const showDropdown = showStoveDropdown && !stoveDisabled && term.length > 0;
                return (
                <div className="relative stove-search-container">
                  <div className="relative">
                    <Input
                      id="stoveSerialNo"
                      value={stoveSearchTerm}
                      onChange={(e) => { setStoveSearchTerm(e.target.value); setShowStoveDropdown(true); }}
                      onFocus={() => setShowStoveDropdown(true)}
                      placeholder={stovePlaceholder}
                      className={`pr-9 ${
                        errors.stoveSerialNo || stoveValidity === "invalid"
                          ? "border-red-500"
                          : stoveValidity === "valid"
                            ? "border-green-600"
                            : ""
                      }`}
                      disabled={stoveDisabled}
                      autoComplete="off"
                    />
                    <div className="absolute inset-y-0 right-2 flex items-center">
                      {stoveValidity === "checking" && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {stoveValidity === "valid" && (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      )}
                      {stoveValidity === "invalid" && (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )}
                    </div>
                  </div>
                  {showDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-auto">
                      {stoveSearching ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching...
                        </div>
                      ) : filteredStoves.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">
                          No matching stove IDs for this partner
                        </p>
                      ) : (
                        filteredStoves.map((stove) => (
                          <div
                            key={stove.id || stove.stove_id}
                            className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
                            onClick={() => {
                              setStoveSearchTerm(stove.stove_id);
                              setFormData((prev) => ({ ...prev, stoveSerialNo: stove.stove_id }));
                              setShowStoveDropdown(false);
                              if (errors.stoveSerialNo) setErrors((prev) => ({ ...prev, stoveSerialNo: null }));
                            }}
                          >
                            {stove.stove_id}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {stoveValidityMessage && (
                    <p className={`mt-1 text-xs ${
                      stoveValidity === "valid" ? "text-green-600" : "text-red-600"
                    }`}>
                      {stoveValidityMessage}
                    </p>
                  )}
                </div>
                );
              })()}

            </FormField>

            {/* Payment type */}
            {isEditMode && initialData?.is_installment && initialData?.payment_model ? (
              <div>
                <Label>Payment Model</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={`${initialData.payment_model.name} — ₦${Number(initialData.payment_model.fixed_price).toLocaleString("en-NG")} / ${initialData.payment_model.duration_months} mo`}
                    readOnly
                    className="bg-gray-100"
                  />
                  <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs px-2 py-0.5 whitespace-nowrap">Installment</Badge>
                </div>
              </div>
            ) : isEditMode ? (
              <ReadOnlyTile label="Payment Type" value="Full Payment" />
            ) : paymentModels.length > 0 ? (
              <FormField label="Payment Type *" htmlFor="paymentType">
                <Select value={isInstallment ? selectedModelId : "full_payment"} onValueChange={handlePaymentTypeChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_payment">Full Payment</SelectItem>
                    {paymentModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name} — {formatCurrency(model.fixed_price)} / {model.duration_months} mo
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}

            {/* Sale amount */}
            <FormField label="Sale Amount (₦) *" error={errors.amount} htmlFor="amount">
              <Input
                id="amount"
                type="text"
                inputMode="numeric"
                value={formatAmountInput(formData.amount)}
                onChange={(e) => handleInputChange("amount", parseAmountInput(e.target.value))}
                placeholder="Enter amount"
                className={`${errors.amount ? "border-red-500" : ""} ${isEditMode ? "bg-gray-100" : ""}`}
                readOnly={isEditMode}
              />
            </FormField>

            {/* Amount received */}
            <FormField label="Amount Received (₦)" error={errors.amountReceived} htmlFor="amountReceived">
              <Input
                id="amountReceived"
                type="text"
                inputMode="numeric"
                value={formatAmountInput(formData.amountReceived)}
                onChange={(e) => handleInputChange("amountReceived", parseAmountInput(e.target.value))}
                placeholder="Enter amount received"
                className={errors.amountReceived ? "border-red-500" : ""}
              />
            </FormField>
          </div>
        </div>

        {/* Location */}
        <div className="bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Location</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-4">
            <FormField label="State *" error={errors.stateBackup} htmlFor="stateBackup">
              <Select value={formData.stateBackup} onValueChange={handleStateChange}>
                <SelectTrigger className={errors.stateBackup ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {nigerianStates.map((state) => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="LGA *" error={errors.lgaBackup} htmlFor="lgaBackup">
              <Select value={formData.lgaBackup} onValueChange={(v) => handleInputChange("lgaBackup", v)} disabled={!formData.stateBackup}>
                <SelectTrigger className={errors.lgaBackup ? "border-red-500" : ""}>
                  <SelectValue placeholder={formData.stateBackup ? "Select LGA" : "Select state first"} />
                </SelectTrigger>
                <SelectContent>
                  {formData.stateBackup && lgaAndStates[formData.stateBackup]?.map((lga) => (
                    <SelectItem key={lga} value={lga}>{lga}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <div className="md:col-span-2 lg:col-span-3">
              <FormField label="Residential Address *" error={errors.address || errors.location} htmlFor="address">
                <GooglePlacesInput
                  value={formData.addressData}
                  onChange={handleAddressSelect}
                  biasState={formData.stateBackup}
                  biasLga={formData.lgaBackup}
                  placeholder={
                    formData.stateBackup
                      ? `Search address in ${formData.lgaBackup || formData.stateBackup}...`
                      : "Select state & LGA first for better matches..."
                  }
                  className={`w-full ${errors.address ? "border-red-500" : ""}`}
                />
              </FormField>
            </div>
            {formData.addressData.latitude && formData.addressData.longitude && (
              <>
                <div>
                  <Label>Latitude</Label>
                  <Input value={formData.addressData.latitude} readOnly className="bg-gray-100 font-mono" />
                </div>
                <div>
                  <Label>Longitude</Label>
                  <Input value={formData.addressData.longitude} readOnly className="bg-gray-100 font-mono" />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Stove Set */}
        <div className="bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Stove Set</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-4">
            <FormField label="Pots Quantity" htmlFor="potQuantity">
              <Select value={formData.potQuantity.toString()} onValueChange={(v) => handleInputChange("potQuantity", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 pots</SelectItem>
                  <SelectItem value="1">1 pot</SelectItem>
                  <SelectItem value="2">2 pots</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <div>
              <Label>Wonderbox (Heat Retention)</Label>
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={formData.heatRetentionDevice}
                  onChange={(e) => handleInputChange("heatRetentionDevice", e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand"
                />
                <span className="text-sm text-muted-foreground">Included</span>
              </label>
            </div>
          </div>
        </div>

        {/* Cooking Habits */}
        <div className="bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Cooking Habits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-4">
            <div className="md:col-span-2 lg:col-span-3">
              <Label>Previous Stove Type</Label>
              <div className="flex flex-wrap gap-4 mt-2">
                {[
                  { value: "charcoal", label: "Charcoal" },
                  { value: "wood_stove", label: "Wood (3 stone)" },
                  { value: "other", label: "Other" },
                ].map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="previousStoveType"
                      value={value}
                      checked={formData.previousStoveType === value}
                      onChange={(e) => handleInputChange("previousStoveType", e.target.value)}
                      className="h-4 w-4 text-brand"
                    />
                    <span className="text-sm text-muted-foreground">{label}</span>
                  </label>
                ))}
              </div>
              {formData.previousStoveType === "other" && (
                <Input
                  value={formData.previousStoveOther}
                  onChange={(e) => handleInputChange("previousStoveOther", e.target.value)}
                  placeholder="Describe stove type"
                  className="mt-2"
                />
              )}
            </div>
            <FormField label="Meals per day" htmlFor="mealsPerDay">
              <Input id="mealsPerDay" value={formData.mealsPerDay} onChange={(e) => handleInputChange("mealsPerDay", e.target.value)} placeholder="e.g., 2 meals" />
            </FormField>
            <FormField label="Fuel Source" htmlFor="cookingFuelSource">
              <Input id="cookingFuelSource" value={formData.cookingFuelSource} onChange={(e) => handleInputChange("cookingFuelSource", e.target.value)} placeholder="e.g., Local market" />
            </FormField>
            <FormField label="Cooking Location" htmlFor="cookingLocation">
              <Input id="cookingLocation" value={formData.cookingLocation} onChange={(e) => handleInputChange("cookingLocation", e.target.value)} placeholder="e.g., Outdoors, kitchen" />
            </FormField>
          </div>
        </div>

        {/* Terms & Conditions */}
        <div className={`bg-[#fafafa] rounded-xl p-5 ${errors.termsAccepted ? "border border-red-400" : "border border-gray-100"}`}>
          <h3 className="text-base font-semibold text-gray-900 mb-4">Terms &amp; Conditions *</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-3">All items below must be acknowledged before submitting.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {[
              { key: "poaGoverned", label: "PoA / UNFCCC governed — stove subsidised by Carbon Credits" },
              { key: "monitoring", label: "Agreed to cooperate for monitoring purposes" },
              { key: "noResell", label: "Agreed not to resell the stove" },
              { key: "emissionReductions", label: "Ceded emission reductions to atmosfair gGmbH" },
              { key: "noExport", label: "Agreed not to take stove outside Nigeria" },
              { key: "demonstration", label: "Received demonstration for efficient firewood usage" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={formData.termsAccepted?.[key] ?? false}
                  onChange={(e) => handleInputChange("termsAccepted", { ...formData.termsAccepted, [key]: e.target.checked })}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-brand"
                />
                <span className="text-sm text-muted-foreground group-hover:text-foreground leading-tight">{label}</span>
              </label>
            ))}
          </div>
          {errors.termsAccepted && <p className="text-sm text-red-500 mt-2">{errors.termsAccepted}</p>}
        </div>

        {/* Images & Signature */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-4 bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <div>
            <Label className="text-base font-semibold">Images &amp; Documents</Label>
            <div className="space-y-4 mt-2">
              <ImageUploadSection
                label="Stove Photo *"
                preview={stoveImagePreview}
                uploading={uploadingImages.stove}
                onUpload={(file) => handleImageUpload(file, "stove")}
                placeholder="Upload a clear photo of the stove"
                error={errors.stoveImage}
              />
              <ImageUploadSection
                label="Agreement Document (optional)"
                preview={agreementImagePreview}
                uploading={uploadingImages.agreement}
                onUpload={(file) => handleImageUpload(file, "agreement")}
                placeholder="Upload the signed agreement document"
                error={errors.agreementImage}
                uploadIcon={FileText}
                buttonText="Upload Agreement"
                accept="application/pdf,image/*"
              />
            </div>
          </div>

          <div>
            <Label className="text-base font-semibold">Digital Signature</Label>
            <div className="mt-2">
              <SignatureCanvas
                signature={formData.signature}
                onSignatureChange={handleSignatureChange}
                error={errors.signature}
                label="Customer Signature *"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pb-2">
          <Button type="button" variant="outline" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading} className="bg-brand hover:bg-brand/90 text-white">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isEditMode ? "Updating..." : "Creating..."}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {isEditMode ? "Update Sale" : "Create Sale"}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CreateSalesForm;
