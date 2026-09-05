
import { useState, useEffect, useRef, useMemo } from "react";
import { supabaseUrl as SUPABASE_URL } from "@/lib/supabaseConfig";
import { getSupabase } from "@/lib/supabaseClient";
import { useRouter } from "@/compat/navigation";
import Link from "@/compat/Link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  Pencil,
  X,
} from "lucide-react";
import DateRangePicker from "@/app/components/ui/date-range-picker";
import GooglePlacesInput from "@/app/components/ui/google-places-input";
import { getGeoData, getGeoDataSync } from "@/lib/geoDataService";
import adminSalesService from "../../../services/adminSalesService";
import profileService from "../../../services/profileService";
import { validateSalesForm, isValidNgPhone, NG_PHONE_FORMAT_MESSAGE } from "../../../utils/salesFormValidation";
import {
  createInitialFormData,
  populateFormDataForEdit,
  normalizeSaleLocation,
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
import { formatCurrency as formatCurrencyShared } from "@/app/utils/formatCurrency";
import { fieldLabel, fieldOptions, groupLabel, payloadLabel } from "@/lib/saleDictionary";

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
  const [gpsCapturing, setGpsCapturing] = useState(false);
  const [gpsError, setGpsError] = useState(null);
  // Once an address is confirmed (Google pick, "use as entered", or the field
  // loses focus with text in it) the search input collapses into a compact
  // card — mirrors the selected-partner chip pattern elsewhere in this form.
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Initialize form data based on mode
  const [formData, setFormData] = useState(createInitialFormData());
  const [originalFormData, setOriginalFormData] = useState(null); // For edit mode comparison
  const initializedRef = useRef(false); // Track if form has been initialized
  const [isInitializing, setIsInitializing] = useState(false); // Track if we're currently initializing

  // Buyer & End User auto-fill toggle
  const [sameAsEndUser, setSameAsEndUser] = useState(false);

  // File refs and states - now using extracted components
  const [stoveImagePreview, setStoveImagePreview] = useState(null);
  const [agreementImagePreview, setAgreementImagePreview] = useState(null);
  const [uploadingImages, setUploadingImages] = useState({
    stove: false,
    agreement: false,
  });

  // Validation state
  const [errors, setErrors] = useState({});
  const [phoneChecking, setPhoneChecking] = useState(false);
  const phoneCheckTokenRef = useRef(0);

  // Installment payment state
  // `paymentModels` is the full active catalogue, fetched once. The picker is
  // narrowed to the selected partner's entitlements via `orgPaymentModelIds`.
  const [paymentModels, setPaymentModels] = useState([]);
  // Sales model IDs the selected partner is tied to. `null` = unknown (no
  // partner picked yet, or the row predates the field) and shows every model;
  // an empty array is a real answer meaning full payment only.
  const [orgPaymentModelIds, setOrgPaymentModelIds] = useState(null);
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

  // Live end-user phone duplicate check (debounced). Flags an existing customer
  // as the user types so the error surfaces before submit. Cancelled sales live
  // in `cancelled_purchases` (not `sales`), so cancelling frees the phone.
  useEffect(() => {
    const raw = formData.phone || "";
    const digits = raw.replace(/\D+/g, "");
    // Skip duplicate lookup unless the number is a valid NG mobile — the format
    // error (set by handleInputChange) already covers the wrong-format case.
    if (!isValidNgPhone(raw) || digits.length < 7) {
      setPhoneChecking(false);
      setErrors((prev) =>
        prev.phone && prev.phone.startsWith("A customer with this phone")
          ? { ...prev, phone: null }
          : prev,
      );
      return;
    }
    const token = ++phoneCheckTokenRef.current;
    setPhoneChecking(true);
    const timer = setTimeout(async () => {
      try {
        const sb = getSupabase();
        const tail = digits.slice(-10);
        const currentId = isEditMode ? initialData?.id : null;
        let q = sb
          .from("sales")
          .select("id, transaction_id, phone")
          .ilike("phone", `%${tail}%`)
          .limit(50);
        if (currentId) q = q.neq("id", currentId);
        const { data } = await q;
        if (token !== phoneCheckTokenRef.current) return;
        // Last-10 comparison, matching create-sale and the mobile app: the same
        // subscriber can be stored as 0803… or 234803… and both must collide.
        const tailKey = digits.slice(-10);
        const clash = (data || []).find((r) => {
          const rowDigits = String(r.phone ?? "").replace(/\D+/g, "");
          return rowDigits.length >= 10 && rowDigits.slice(-10) === tailKey;
        });
        setErrors((prev) => {
          if (clash) {
            return {
              ...prev,
              phone: `A customer with this phone number already exists (sale ${clash.transaction_id}).`,
            };
          }
          if (prev.phone && prev.phone.startsWith("A customer with this phone")) {
            return { ...prev, phone: null };
          }
          return prev;
        });
      } catch (err) {
        console.warn("Live phone check failed", err);
      } finally {
        if (token === phoneCheckTokenRef.current) setPhoneChecking(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [formData.phone, isEditMode, initialData?.id]);

  // Auto-fill Contact Person / Buyer and Contact Phone from end-user details
  // when the "same as end user" checkbox is selected.
  useEffect(() => {
    if (!sameAsEndUser) return;
    const firstName = (formData.endUserName || "").trim();
    const surname = (formData.endUserSurname || "").trim();
    const fullName = [firstName, surname].filter(Boolean).join(" ");
    setFormData((prev) => ({
      ...prev,
      contactPerson: fullName,
      contactPhone: prev.phone || "",
    }));
  }, [sameAsEndUser, formData.endUserName, formData.endUserSurname, formData.phone]);

  // Centralized states + LGAs (geo-data edge fn → cache → bundled fallback).
  // Seed synchronously from cache/bundled so the first render has data, then
  // refresh from the network.
  const [geoData, setGeoData] = useState(() => getGeoDataSync());
  useEffect(() => {
    let alive = true;
    getGeoData().then((d) => {
      if (alive) setGeoData(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  const nigerianStates = geoData.states;
  const lgaAndStates = geoData.lgas;

  const stateOptions = useMemo(() => {
    const list = [...nigerianStates];
    if (formData.stateBackup && !list.includes(formData.stateBackup)) {
      list.unshift(formData.stateBackup);
    }
    return list;
  }, [nigerianStates, formData.stateBackup]);

  const lgaOptionsForSelectedState = useMemo(() => {
    const options = (formData.stateBackup && lgaAndStates[formData.stateBackup]) || [];
    const list = [...options];
    if (formData.lgaBackup && !list.includes(formData.lgaBackup)) {
      list.unshift(formData.lgaBackup);
    }
    return list;
  }, [lgaAndStates, formData.stateBackup, formData.lgaBackup]);

  const selectedLgaLabel = formData.lgaBackup || "";
  const selectedStateLabel = formData.stateBackup || "";

  // Case/whitespace-insensitive lookup that returns the canonical string from `list`.
  const findCI = (list, v) => {
    const needle = String(v || "").trim().toLowerCase();
    if (!needle) return undefined;
    return (list || []).find((x) => String(x).trim().toLowerCase() === needle);
  };

  // Reconcile persisted state/LGA to the geo catalogue's canonical casing so
  // Radix Select (strict, case-sensitive value match) can render the saved LGA
  // on the Edit Sale form.
  useEffect(() => {
    if (!isEditMode) return;
    if (!lgaAndStates || Object.keys(lgaAndStates).length === 0) return;
    if (!formData.stateBackup && !formData.lgaBackup) return;

    const normalizedLocation = normalizeSaleLocation(
      {
        stateBackup: formData.stateBackup,
        lgaBackup: formData.lgaBackup,
      },
      lgaAndStates
    );
    const canonicalState = normalizedLocation.stateBackup;
    const canonicalLga = normalizedLocation.lgaBackup;

    if (
      canonicalState !== formData.stateBackup ||
      canonicalLga !== formData.lgaBackup
    ) {
      setFormData((prev) => ({
        ...prev,
        stateBackup: canonicalState,
        lgaBackup: canonicalLga,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, lgaAndStates, formData.stateBackup, formData.lgaBackup]);

  // Helper: resolve the currently active partner organization id(s).
  // Legacy duplicate org rows share the same partner+state+branch, so a stove
  // can live on any one of them — we search/validate across the full set.
  const getActiveOrgIds = () => {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem("saa_selected_org_ids");
      if (raw) {
        try {
          const ids = JSON.parse(raw);
          if (Array.isArray(ids) && ids.length > 0) return ids;
        } catch {
          /* fall through to single-id resolution */
        }
      }
      const single = sessionStorage.getItem("saa_selected_org_id");
      if (single) return [single];
    }
    const profileOrg = profileService.getOrganizationId();
    return profileOrg ? [profileOrg] : [];
  };

  // Single-id accessor kept for callers (e.g. createSale) that need exactly one.
  const getActiveOrgId = () => getActiveOrgIds()[0] || null;

  // AJAX search: pull stove IDs as the user types (debounced).
  // Only IDs that belong to the selected partner org and are not sold are returned.
  useEffect(() => {
    if (isEditMode) return; // edit mode locks the stove id
    const orgIds = getActiveOrgIds();
    if (orgIds.length === 0) {
      setFilteredStoves([]);
      return;
    }
    let cancelled = false;
    setStoveSearching(true);
    const handle = setTimeout(async () => {
      const res = await adminSalesService.searchStoveIds(orgIds, stoveSearchTerm, 25);
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
    const orgIds = getActiveOrgIds();
    const term = (stoveSearchTerm || "").trim();
    if (orgIds.length === 0 || !term) {
      setStoveValidity("idle");
      setStoveValidityMessage("");
      return;
    }
    let cancelled = false;
    setStoveValidity("checking");
    setStoveValidityMessage("");
    const handle = setTimeout(async () => {
      const res = await adminSalesService.validateStoveId(orgIds, term);
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
          // Cap raised from 100 → 500 so legitimately distinct partner_name
          // variants (e.g. "…(Amina Sales Model)") aren't pushed off the initial
          // list before the user searches.
          const params = new URLSearchParams({ limit: "500", offset: "0" });
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
          const populatedData = await populateFormDataForEdit(initialData, lgaAndStates);
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
          // A new sale's agent is the signed-in person until somebody says otherwise.
          const me = profileService.getStoredProfileData();
          if (me?.full_name) {
            setFormData((prev) =>
              prev.salesAgentName ? prev : { ...prev, salesAgentName: me.full_name, salesAgentUserId: me.id ?? null },
            );
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
            sessionStorage.removeItem("saa_selected_org_ids");
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

      // Resolve org id(s) — across all duplicate rows of the picked partner.
      const organizationIds = getActiveOrgIds();

      if (organizationIds.length === 0) {
        // No org context yet — partner picker is shown; wait for selection
        setNeedsPartnerSelection(true);
        setStovesLoading(false);
        return;
      }

      // Fetch stoves across the partner's org id(s) with "available" status
      const response = await adminSalesService.getAvailableStoveIds(
        organizationIds,
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

  // The catalogue narrowed to what this partner may actually sell. Resolved
  // locally so no per-partner request is ever made.
  //
  // `orgPaymentModelIds` carries three distinct states and they must not be
  // conflated: a list restricts to that list, `[]` means genuinely none
  // assigned (full payment only), and `null` means unknown — the lookup failed
  // or the row predates entitlements — which falls back to the whole
  // catalogue. `create-sale` applies the identical rule; keep the two in step,
  // or the picker offers models the endpoint then rejects.
  // A partner with NO assignments gets EVERY active model. The sync only covers
  // partners the external app has sent, so treating "none assigned" as "no
  // models" would block sales for every unsynced partner rather than protect
  // them. Only an explicit list restricts. `create-sale` applies the identical
  // rule — if these diverge, the picker and the server disagree.
  const visiblePaymentModels = useMemo(() => {
    if (!orgPaymentModelIds || orgPaymentModelIds.length === 0) {
      return paymentModels;
    }
    const allowed = new Set(orgPaymentModelIds);
    return paymentModels.filter((m) => allowed.has(m.id));
  }, [paymentModels, orgPaymentModelIds]);

  // The one real empty state left: the partner is assigned models this
  // catalogue can't resolve (inactive, or created after we loaded). That's a
  // data fault, not a permission, so it must not fall back to "show all" —
  // doing so would hide it.
  const partnerModelsUnresolved =
    orgPaymentModelIds !== null &&
    orgPaymentModelIds.length > 0 &&
    visiblePaymentModels.length === 0 &&
    !modelsLoading;

  const fetchPaymentModels = async () => {
    // Fetched once, for every role. Partner entitlements are applied on top of
    // this list rather than by re-querying per partner.
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


  // The sync mints sales models on the fly, so a partner can reference a model
  // that did not exist when this page loaded its catalogue. Rather than show an
  // empty picker (which reads as "no installment option"), refetch once when we
  // meet an ID we don't know.
  const refetchedForUnknownIds = useRef(false);
  useEffect(() => {
    if (isEditMode || modelsLoading) return;
    if (!orgPaymentModelIds || orgPaymentModelIds.length === 0) return;
    const known = new Set(paymentModels.map((m) => m.id));
    const hasUnknown = orgPaymentModelIds.some((id) => !known.has(id));
    if (hasUnknown && !refetchedForUnknownIds.current) {
      refetchedForUnknownIds.current = true;
      fetchPaymentModels();
    }
  }, [orgPaymentModelIds, paymentModels, modelsLoading, isEditMode]);

  // A model chosen for one partner must not survive into a partner that isn't
  // entitled to it — create-sale rejects that, so drop it back to full payment.
  useEffect(() => {
    if (isEditMode || !isInstallment || !selectedModelId) return;
    if (!visiblePaymentModels.some((m) => m.id === selectedModelId)) {
      handlePaymentTypeChange("full_payment");
    }
  }, [visiblePaymentModels, selectedModelId, isInstallment, isEditMode]);

  // A full payment means the customer settles the whole sale amount up front,
  // so sale amount and amount received are the same number — we collect it once
  // and mirror it into both fields rather than asking twice.
  const isSingleAmountField = !isEditMode && !isInstallment;

  // If an installment sale is paid off in full at the point of sale it isn't an
  // installment sale at all — drop it back to full payment.
  useEffect(() => {
    if (isEditMode || !isInstallment) return;
    const amount = Number(formData.amount);
    if (amount > 0 && Number(formData.amountReceived) >= amount) {
      handlePaymentTypeChange("full_payment", { keepAmount: true });
    }
  }, [isEditMode, isInstallment, formData.amount, formData.amountReceived]);

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
      // Full payment collects one figure that serves as both the sale amount
      // and the amount received.
      ...(field === "amount" && isSingleAmountField ? { amountReceived: value } : {}),
    }));

    // Live format check for phone fields — flag invalid format on every keystroke.
    if (field === "contactPhone" || field === "phone") {
      const trimmed = String(value || "").trim();
      if (trimmed && !isValidNgPhone(trimmed)) {
        setErrors((prev) => ({ ...prev, [field]: NG_PHONE_FORMAT_MESSAGE }));
        return;
      }
      // Valid (or empty) — clear format error; the duplicate-check effect will
      // repopulate `phone` if the number already exists.
      setErrors((prev) => ({ ...prev, [field]: null }));
      return;
    }

    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => ({
        ...prev,
        [field]: null,
      }));
    }
  };


  // Edit mode loads an existing address — show it collapsed immediately
  // rather than as an open search field.
  useEffect(() => {
    if (isEditMode && formData.addressData?.fullAddress?.trim()) {
      setAddressConfirmed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, initialData?.id]);

  const handleClearAddress = () => {
    handleAddressSelect({
      fullAddress: "",
      street: "",
      city: "",
      state: "",
      country: "Nigeria",
      latitude: null,
      longitude: null,
    });
    setAddressConfirmed(false);
  };

  const handleAddressSelect = (addressData) => {
    setFormData((prev) => ({
      ...prev,
      addressData: {
        fullAddress: addressData.fullAddress || "",
        street: addressData.street || "",
        // A place that names no town keeps the one the agent typed.
        city: addressData.city || prev.addressData?.city || "",
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

  // For rural/village addresses Google Places can't resolve, silently capture
  // raw GPS coordinates from the browser in the background — no button, no
  // blocking prompt beyond the browser's own permission dialog. Only fills in
  // coordinates that are still empty, so it never overwrites a Google pick.
  useEffect(() => {
    if (isEditMode) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setGpsCapturing(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsCapturing(false);
        setFormData((prev) =>
          prev.addressData.latitude != null && prev.addressData.longitude != null
            ? prev
            : {
                ...prev,
                addressData: {
                  ...prev.addressData,
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                },
              }
        );
      },
      (err) => {
        setGpsCapturing(false);
        // Silent by default — only surface if the user explicitly denied,
        // which they may want to fix for future sales.
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError("Location permission denied — enable it to auto-capture GPS.");
        }
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode]);

  const handleStateChange = (stateValue) => {
    if (!stateValue) return;
    setFormData((prev) => ({
      ...prev,
      stateBackup: stateValue,
      lgaBackup: isInitializing || prev.stateBackup === stateValue ? prev.lgaBackup : "",
    }));
  };

  const handleLgaChange = (lgaValue) => {
    if (!lgaValue) return;
    handleInputChange("lgaBackup", lgaValue);
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
  const handlePaymentTypeChange = (value, { keepAmount = false } = {}) => {
    if (value === "full_payment") {
      setIsInstallment(false);
      setSelectedModelId("");
      setSelectedModel(null);
      setInitialPaymentAmount("");
      setInitialPaymentMethod("");
      setInitialPaymentProofImageId("");
      setInitialPaymentProofPreview(null);
      if (keepAmount) {
        // Full payment collapses to one number — received matches the sale amount.
        setFormData((prev) => ({ ...prev, amountReceived: prev.amount }));
      } else {
        setFormData((prev) => ({ ...prev, amount: "", amountReceived: "" }));
      }
    } else {
      // value is a payment model ID
      setIsInstallment(true);
      setSelectedModelId(value);
      // The model fixes the sale amount; the received figure becomes the
      // initial payment, so it must be re-entered.
      setFormData((prev) => ({ ...prev, amountReceived: "" }));
    }
  };

  const formatCurrency = (v) => formatCurrencyShared(v);

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
          sessionStorage.removeItem("saa_selected_org_ids");
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

  // NOTE: the success-state early return lives AFTER all hooks (just before the
  // main return below). Returning here would render fewer hooks than the
  // previous pass and crash with "Rendered fewer hooks than expected" — which
  // surfaced as the root "Something went wrong" page after a successful sale on
  // the full Sell Stove page (showSuccessState && !isModal).

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
      // A partner can have several duplicate org rows for the SAME
      // partner+state+branch (legacy imports). Record every matching id so stove
      // search/validation runs across all of them — otherwise a stove attached
      // to a sibling duplicate row is invisible/unsellable.
      const norm = (s) => (s || "").toLowerCase().trim();
      const dupIds = partnerBranches
        .filter(
          (r) =>
            norm(r.partner_name) === norm(org.partner_name) &&
            norm(r.state) === norm(org.state) &&
            norm(r.branch) === norm(org.branch),
        )
        .map((r) => r.id);
      const orgIds = Array.from(new Set([org.id, ...dupIds])).filter(Boolean);
      sessionStorage.setItem("saa_selected_org_id", org.id);
      sessionStorage.setItem("saa_selected_org_ids", JSON.stringify(orgIds));
      sessionStorage.setItem("saa_selected_org_name", org.partner_name || "");
    }
    handleInputChange("partnerName", org.partner_name || "");
    handleInputChange("retailerBranch", org.branch || "");
    setErrors((prev) => ({ ...prev, partnerName: null, state: null, branch: null }));
    fetchAvailableStoves();
    // Sales models are tied to the partner, but they are never fetched per
    // partner: the org row already carries the IDs, which we resolve against
    // the catalogue loaded once on mount.
    setOrgPaymentModelIds(
      Array.isArray(org.payment_model_ids) ? org.payment_model_ids : null,
    );
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


  // `picked` is the org row the user clicked, not just its name — it is the
  // guaranteed-present fallback if the branch lookup below comes back thin.
  const handlePartnerPick = async (picked) => {
    const partnerName = picked?.partner_name || "";
    setSelectedPartnerName(partnerName);
    setSelectedState("");
    setPartnerBranches([]);
    setPartnerSearch(partnerName);
    setShowPartnerDropdown(false);
    handleInputChange("partnerName", partnerName);
    handleInputChange("retailerBranch", "");
    resetStoveSelection();
    // Entitlements belong to the branch that is about to be picked, not to the
    // partner we just left.
    setOrgPaymentModelIds(null);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("saa_selected_org_id");
      sessionStorage.removeItem("saa_selected_org_ids");
    }

    setBranchesLoading(true);
    try {
      // Tolerant name match: the dropdown label and the stored partner_name can
      // differ by case or stray whitespace (e.g. a trailing space, or a double
      // space, on the Amina variant). A brittle `===` there returns zero rows →
      // empty state/branch → no org id recorded → the partner's stoves become
      // unsellable. Normalize both sides before comparing.
      const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
      const target = norm(partnerName);
      // Start from the rows already loaded — the picked partner is always in
      // there, so state/branch can never come back empty.
      let rows = (partners || []).filter((o) => norm(o.partner_name) === target);
      if (!rows.some((o) => o.id === picked.id)) rows = [picked, ...rows];
      // Show them immediately, so a failing lookup below still leaves a usable
      // branch rather than an empty dropdown.
      setPartnerBranches(rows);

      let fetched = [];
      const isSaaAgent = isSuperAdmin && userRole !== "super_admin";
      if (isSaaAgent) {
        const result = await superAdminAgentService.getAgentOrganizations(userId);
        fetched = result.data || [];
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        // Search on the part of the name before any bracket: the server does a
        // substring match, so this still reaches every branch, while keeping the
        // term free of characters that have meaning inside a PostgREST filter.
        const searchTerm = (partnerName.split("(")[0] || partnerName).trim();
        const params = new URLSearchParams({
          limit: "500",
          offset: "0",
          search: searchTerm,
        });
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/manage-organizations?${params}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        const result = await res.json();
        if (res.ok) fetched = result.data || [];
      }

      // Merge the server's branches in, keyed by id so nothing duplicates.
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const o of fetched) {
        if (norm(o.partner_name) === target) byId.set(o.id, o);
      }
      rows = Array.from(byId.values());
      setPartnerBranches(rows);

      if (rows.length === 0) {
        // Don't leave state/branch silently empty — tell the user why.
        setErrors((prev) => ({
          ...prev,
          partnerName: "No branches configured for this partner",
        }));
        return;
      }

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
      sessionStorage.removeItem("saa_selected_org_ids");
    }
    const branches = partnerBranches.filter((r) => r.state === stateValue);
    if (branches.length === 1) finalizeBranchPick(branches[0]);
  };

  const handleBranchPick = (orgId) => {
    const org = partnerBranches.find((r) => r.id === orgId);
    if (org) finalizeBranchPick(org);
  };

  // Success state - only show if showSuccessState is true and not modal.
  // Placed here (after every hook) so the hook order is identical whether or not
  // the sale succeeded — see the note where this block used to live.
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

            <FormField label={`${payloadLabel("salesDate")} *`} error={errors.salesDate} htmlFor="salesDate">
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
                  <Label htmlFor="partnerSearch">{payloadLabel("partnerName")} *</Label>
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
                              onClick={() => handlePartnerPick(p)}
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
                  <Label htmlFor="partnerBranch">{payloadLabel("retailerBranch")} *</Label>
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
                <ReadOnlyTile label={payloadLabel("partnerName")} value={formData.partnerName} />
                <ReadOnlyTile label={payloadLabel("retailerBranch")} value={formData.retailerBranch} />
              </>
            )}
          </div>
        </div>



        {/* Buyer & End User */}
        <div className="bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Buyer &amp; End User</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-4">
            <FormField label={fieldLabel("sales_agent_name")} htmlFor="salesAgentName">
              <Input
                id="salesAgentName"
                value={formData.salesAgentName ?? ""}
                onChange={(e) => {
                  // A name typed over the default is no longer the signed-in user.
                  handleInputChange("salesAgentName", e.target.value);
                  handleInputChange("salesAgentUserId", null);
                }}
                placeholder="As written on the agreement"
              />
            </FormField>
            {/* The joined endUserName still travels; the two parts travel beside it. */}
            <FormField label={`${fieldLabel("end_user_first_name")} *`} error={errors.endUserName} htmlFor="endUserName">
              <Input
                id="endUserName"
                value={formData.endUserName}
                onChange={(e) => handleInputChange("endUserName", e.target.value)}
                placeholder="End user first name"
                className={errors.endUserName ? "border-red-500" : ""}
              />
            </FormField>
            <FormField label={`${fieldLabel("end_user_surname")} *`} error={errors.endUserSurname} htmlFor="endUserSurname">
              <Input
                id="endUserSurname"
                value={formData.endUserSurname}
                onChange={(e) => handleInputChange("endUserSurname", e.target.value)}
                placeholder="End user surname"
                className={errors.endUserSurname ? "border-red-500" : ""}
              />
            </FormField>
            <FormField label={`${payloadLabel("phone")} *`} error={errors.phone} htmlFor="phone">
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleInputChange("phone", e.target.value)}
                placeholder="+234 803 123 4567"
                className={errors.phone ? "border-red-500" : ""}
                aria-invalid={errors.phone ? "true" : "false"}
              />
              {phoneChecking && !errors.phone && (
                <p className="mt-1 text-xs text-gray-500">Checking…</p>
              )}
            </FormField>
            <FormField label={payloadLabel("aka")} htmlFor="aka">
              <Input
                id="aka"
                value={formData.aka}
                onChange={(e) => handleInputChange("aka", e.target.value)}
                placeholder="Alias or nickname"
              />
            </FormField>
            <div className="col-span-1 md:col-span-2 lg:col-span-3 flex items-center gap-3 py-2">
              <Checkbox
                id="sameAsEndUser"
                checked={sameAsEndUser}
                onCheckedChange={(checked) => setSameAsEndUser(Boolean(checked))}
              />
              <Label htmlFor="sameAsEndUser" className="text-sm font-medium text-gray-700 cursor-pointer">
                Tick if the customer is also the contact (Buyer Name)
              </Label>
            </div>
            <FormField label={`${payloadLabel("contactPerson")} *`} error={errors.contactPerson} htmlFor="contactPerson">
              <Input
                id="contactPerson"
                value={formData.contactPerson}
                onChange={(e) => handleInputChange("contactPerson", e.target.value)}
                placeholder="Buyer name"
                className={errors.contactPerson ? "border-red-500" : ""}
              />
            </FormField>
            <FormField label={`${payloadLabel("contactPhone")} *`} error={errors.contactPhone} htmlFor="contactPhone">
              <Input
                id="contactPhone"
                type="tel"
                value={formData.contactPhone}
                onChange={(e) => handleInputChange("contactPhone", e.target.value)}
                placeholder="+234 803 123 4567"
                className={errors.contactPhone ? "border-red-500" : ""}
              />
            </FormField>
          </div>
        </div>

        {/* Sale & Payment */}
        <div className="bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Sale &amp; Payment</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-4">
            {/* Stove serial */}
            <FormField label={`${fieldLabel("stove_serial_no")} *${isEditMode ? " (locked)" : ""}`} error={errors.stoveSerialNo} htmlFor="stoveSerialNo">
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
                <Label>{payloadLabel("paymentModelId")}</Label>
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
              <ReadOnlyTile label={payloadLabel("isInstallment")} value="Full Payment" />
            ) : paymentModels.length > 0 ? (
              <FormField label={`${payloadLabel("isInstallment")} *`} htmlFor="paymentType">
                <Select value={isInstallment ? selectedModelId : "full_payment"} onValueChange={handlePaymentTypeChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_payment">Full Payment</SelectItem>
                    {visiblePaymentModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name} — {formatCurrency(model.fixed_price)} / {model.duration_months} mo
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {partnerModelsUnresolved && (
                  <p className="mt-1 text-xs text-amber-600">
                    This partner is assigned {orgPaymentModelIds.length} sales
                    model{orgPaymentModelIds.length === 1 ? "" : "s"} that
                    could not be loaded — they may be inactive. Only full
                    payment is available until that is resolved.
                  </p>
                )}
              </FormField>
            ) : null}

            {/* Sale amount — for a full payment this doubles as the amount
                received, so we only ask for it once. */}
            <FormField
              label={
                isSingleAmountField
                  ? `${payloadLabel("amount")} / ${fieldLabel("first_payment")} (₦) *`
                  : `${payloadLabel("amount")} (₦) *`
              }
              error={errors.amount}
              htmlFor="amount"
            >
              <Input
                id="amount"
                type="text"
                inputMode="numeric"
                value={formatAmountInput(formData.amount)}
                onChange={(e) => handleInputChange("amount", parseAmountInput(e.target.value))}
                placeholder="Enter amount"
                className={errors.amount ? "border-red-500" : ""}
              />
              {isSingleAmountField && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Full payment — the customer pays the sale amount in full.
                </p>
              )}
            </FormField>

            {/* Amount received — installments only; full payment mirrors the
                sale amount above. */}
            {!isSingleAmountField && (
              <FormField label={`${fieldLabel("first_payment")} (₦)`} error={errors.amountReceived} htmlFor="amountReceived">
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
            )}
          </div>
        </div>

        {/* Location */}
        <div className="bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Location</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-4">
            <FormField label={`${payloadLabel("stateBackup")} *`} error={errors.stateBackup} htmlFor="stateBackup">
              <Select
                key={`state-${selectedStateLabel}-${stateOptions.length}`}
                value={formData.stateBackup}
                onValueChange={handleStateChange}
              >
                <SelectTrigger className={errors.stateBackup ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select state">{selectedStateLabel || undefined}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {stateOptions.map((state) => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={`${payloadLabel("lgaBackup")} *`} error={errors.lgaBackup} htmlFor="lgaBackup">
              <Select
                key={`lga-${selectedStateLabel}-${selectedLgaLabel}-${lgaOptionsForSelectedState.length}`}
                value={formData.lgaBackup}
                onValueChange={handleLgaChange}
                disabled={!formData.stateBackup}
              >
                <SelectTrigger className={errors.lgaBackup ? "border-red-500" : ""}>
                  <SelectValue placeholder={formData.stateBackup ? "Select LGA" : "Select state first"}>
                    {selectedLgaLabel || undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {lgaOptionsForSelectedState.map((lga) => (
                    <SelectItem key={lga} value={lga}>{lga}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={fieldLabel("city")} htmlFor="city">
              <Input
                id="city"
                value={formData.addressData?.city ?? ""}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, addressData: { ...(prev.addressData ?? {}), city: e.target.value } }))
                }
                placeholder="Town or village on the agreement"
              />
            </FormField>
            <div className="md:col-span-2 lg:col-span-3">
              <FormField label={`${fieldLabel("full_address")} *`} error={errors.address || errors.location} htmlFor="address">
                {addressConfirmed && formData.addressData?.fullAddress ? (
                  <div className="flex items-center gap-2 rounded-lg border border-[#4a5d0f] bg-[#4a5d0f]/10 px-3 py-2.5">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#4a5d0f]" />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-[#4a5d0f]">
                      {formData.addressData.fullAddress}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAddressConfirmed(false)}
                      className="rounded p-1 text-[#4a5d0f] hover:bg-[#4a5d0f]/15"
                      aria-label="Edit address"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAddress}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                      aria-label="Clear address"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div>
                    <GooglePlacesInput
                      value={formData.addressData}
                      onChange={handleAddressSelect}
                      onConfirm={() => setAddressConfirmed(true)}
                      biasState={formData.stateBackup}
                      biasLga={formData.lgaBackup}
                      placeholder={
                        formData.stateBackup
                          ? `Search address in ${formData.lgaBackup || formData.stateBackup}...`
                          : "Select state & LGA first for better matches..."
                      }
                      className={`w-full ${errors.address ? "border-red-500" : ""}`}
                      autoFocus={Boolean(formData.addressData?.fullAddress)}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Type the address freely — you don&apos;t have to pick a Google result.
                      For villages or areas Google doesn&apos;t recognise, use it as entered
                      from the dropdown.
                    </p>
                    {gpsCapturing && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                        <Loader2 className="h-3 w-3 animate-spin" /> Capturing your location…
                      </p>
                    )}
                    {gpsError && <p className="mt-1 text-xs text-amber-700">{gpsError}</p>}
                  </div>
                )}
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
            <FormField label={payloadLabel("potQuantity")} htmlFor="potQuantity">
              <Select value={formData.potQuantity.toString()} onValueChange={(v) => handleInputChange("potQuantity", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {fieldOptions("pot_quantity").map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <div>
              <Label>{payloadLabel("heatRetentionDevice")}</Label>
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
              <Label>{payloadLabel("previousStoveType")}</Label>
              <div className="flex flex-wrap gap-4 mt-2">
                {fieldOptions("previous_stove_type").map(({ value, label }) => (
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
            <FormField label={payloadLabel("mealsPerDay")} htmlFor="mealsPerDay">
              <Input id="mealsPerDay" value={formData.mealsPerDay} onChange={(e) => handleInputChange("mealsPerDay", e.target.value)} placeholder="e.g., 2 meals" />
            </FormField>
            <FormField label={payloadLabel("cookingFuelSource")} htmlFor="cookingFuelSource">
              <Input id="cookingFuelSource" value={formData.cookingFuelSource} onChange={(e) => handleInputChange("cookingFuelSource", e.target.value)} placeholder="e.g., Local market" />
            </FormField>
            <FormField label={payloadLabel("cookingLocation")} htmlFor="cookingLocation">
              <Input id="cookingLocation" value={formData.cookingLocation} onChange={(e) => handleInputChange("cookingLocation", e.target.value)} placeholder="e.g., Outdoors, kitchen" />
            </FormField>
          </div>
        </div>

        {/* Terms & Conditions */}
        <div className={`bg-[#fafafa] rounded-xl p-5 ${errors.termsAccepted ? "border border-red-400" : "border border-gray-100"}`}>
          {(() => {
            const termsItems = [
              { key: "poaGoverned", label: "PoA / UNFCCC governed — stove subsidised by Carbon Credits" },
              { key: "monitoring", label: "Agreed to cooperate for monitoring purposes" },
              { key: "noResell", label: "Agreed not to resell the stove" },
              { key: "emissionReductions", label: "Ceded emission reductions to atmosfair gGmbH" },
              { key: "noExport", label: "Agreed not to take stove outside Nigeria" },
              { key: "demonstration", label: "Received demonstration for efficient firewood usage" },
            ];
            const allAccepted = termsItems.every(({ key }) => formData.termsAccepted?.[key]);
            return (
              <>
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="text-base font-semibold text-gray-900">{groupLabel("agreement")} *</h3>
            <button
              type="button"
              onClick={() =>
                handleInputChange(
                  "termsAccepted",
                  termsItems.reduce((acc, { key }) => ({ ...acc, [key]: !allAccepted }), {})
                )
              }
              className="text-sm font-medium text-brand hover:underline shrink-0"
            >
              {allAccepted ? "Clear all" : "Accept all"}
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-1 mb-3">All items below must be acknowledged before submitting.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {termsItems.map(({ key, label }) => (
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
              </>
            );
          })()}
        </div>

        {/* Images & Signature */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-4 bg-[#fafafa] rounded-xl border border-gray-100 p-5">
          <div>
            <Label className="text-base font-semibold">Images &amp; Documents</Label>
            <div className="space-y-4 mt-2">
              <ImageUploadSection
                label={`${fieldLabel("stove_image_id")} (optional)`}
                preview={stoveImagePreview}
                uploading={uploadingImages.stove}
                onUpload={(file) => handleImageUpload(file, "stove")}
                placeholder="Take a photo with your camera or upload from your device"
                error={errors.stoveImage}
                enableCamera
              />
              <ImageUploadSection
                label={`${fieldLabel("agreement_image_id")} (optional)`}
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
                label={`${payloadLabel("signature")} *`}
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
