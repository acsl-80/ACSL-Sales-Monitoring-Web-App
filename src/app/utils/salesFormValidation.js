/**
 * Sales Form Validation Utilities
 * Contains validation functions for sales form data
 * Uses consistent base64 signature validation
 */

import { isValidSignature } from "./signatureUtils";
import { missingByRules } from "../../lib/saleFieldRules";

/**
 * Validates a Nigerian mobile phone number. Accepts:
 *   08031234567          (11 digits, leading 0)
 *   +2348031234567       (with +234 country code)
 *   2348031234567        (13 digits, leading 234)
 * Spaces, dashes and parens in the raw value are ignored.
 *
 * Mirrored by `PhoneUtils.isValidNigerianPhone` in the mobile app — keep the
 * two in step, and note this one additionally enforces the NG mobile prefix
 * ([7-9][0-1]), so it is the stricter of the pair.
 */
export const isValidNgPhone = (raw) => {
  if (!raw) return false;
  const cleaned = String(raw).replace(/[\s\-()]/g, "");
  return /^(?:0|\+?234)[7-9][0-1]\d{8}$/.test(cleaned);
};

export const NG_PHONE_FORMAT_MESSAGE =
  "Enter a valid phone number (e.g. 08031234567, +2348031234567, or 2348031234567).";

/**
 * Validates the sales form data
 * @param {Object} formData - The form data to validate
 * @returns {Object} - Object containing validation errors (empty if valid)
 */
/**
 * The sales app's own rule for a record. `options.rules` are the dated rules
 * from public.sale_field_rules (see lib/saleFieldRules): a field they require
 * for the record's sales date is reported missing here, by the agreement's
 * name for it, so the form refuses what the server would mark incomplete.
 */
export const validateSalesForm = (formData, options = {}) => {
  const errors = {};

  // Transaction ID validation (should be auto-generated)
  if (!formData.transactionId.trim()) {
    errors.transactionId = "Transaction ID is required";
  }

  // Sales date validation
  if (!formData.salesDate) {
    errors.salesDate = "Sales date is required";
  }

  // Contact person validation
  // The contact person and contact phone are optional since A4: the
  // customer is the contact when they are empty. A phone given is still a phone.

  // Contact phone validation
  if ((formData.contactPhone || "").trim() && !isValidNgPhone(formData.contactPhone)) {
    errors.contactPhone = NG_PHONE_FORMAT_MESSAGE;
  }

  // End user first name validation
  if (!formData.endUserName.trim()) {
    errors.endUserName = "End user first name is required";
  }

  // End user surname validation
  if (!formData.endUserSurname || !formData.endUserSurname.trim()) {
    errors.endUserSurname = "End user surname is required";
  }

  // State validation
  if (!formData.stateBackup) {
    errors.stateBackup = "State is required";
  }

  // LGA validation
  if (!formData.lgaBackup) {
    errors.lgaBackup = "LGA is required";
  }

  // Phone validation
  if (!formData.phone.trim()) {
    errors.phone = "End user phone number is required";
  } else if (!isValidNgPhone(formData.phone)) {
    errors.phone = NG_PHONE_FORMAT_MESSAGE;
  }

  // Amount validation
  if (!formData.amount || parseFloat(formData.amount) <= 0) {
    errors.amount = "Valid sale amount is required";
  }

  // Amount received cannot exceed the sales amount
  if (
    formData.amountReceived !== "" &&
    formData.amountReceived !== null &&
    formData.amountReceived !== undefined
  ) {
    const received = parseFloat(formData.amountReceived);
    const saleAmount = parseFloat(formData.amount);
    if (!Number.isNaN(received) && !Number.isNaN(saleAmount) && received > saleAmount) {
      errors.amountReceived = "Amount received cannot be greater than the sales amount";
    }
  }

  // Stove serial number validation
  if (!formData.stoveSerialNo) {
    errors.stoveSerialNo = "Stove serial number is required";
  }

  // Address validation — free text is allowed. The address may be typed
  // manually (a "raw" address not on Google Maps); GPS coordinates are OPTIONAL
  // and default to 0,0 on submit when the address was not picked from Google.
  if (!formData.addressData.fullAddress.trim()) {
    errors.address = "Residential address is required";
  }

  // Image validation
  // Stove photo is now OPTIONAL (was required). A sale can be submitted without
  // it; the backend records the sale as pending/incomplete when it's missing.
  // if (!formData.stoveImageId) {
  //   errors.stoveImage = "Stove photo is required";
  // }

  // TEMP: agreement document not required for now — re-enable later
  // if (!formData.agreementImageId) {
  //   errors.agreementImage = "Agreement document is required";
  // }

  // Signature validation - uses enhanced validation for both base64 and data URL formats
  if (!isValidSignature(formData.signature)) {
    errors.signature = "Customer signature is required";
  }

  // Terms & Conditions — all 6 must be ticked
  const tc = formData.termsAccepted || {};
  const tcKeys = ["poaGoverned", "monitoring", "noResell", "emissionReductions", "noExport", "demonstration"];
  const allTicked = tcKeys.every((k) => tc[k] === true);
  if (!allTicked) {
    errors.termsAccepted = "All terms and conditions must be accepted";
  }


  // The dated rules, for this record's day. A field the validator already
  // reported is not reported twice.
  for (const missing of missingByRules(options.rules ?? [], formData)) {
    if (!errors[missing.key]) errors[missing.key] = `${missing.label} is required`;
  }

  return errors;
};

/**
 * Checks if the form is valid (no validation errors)
 * @param {Object} formData - The form data to validate
 * @returns {boolean} - True if form is valid, false otherwise
 */
export const isValidSalesForm = (formData, options = {}) => {
  const errors = validateSalesForm(formData, options);
  return Object.keys(errors).length === 0;
};

/**
 * Field-specific validation functions for real-time validation
 */
export const fieldValidators = {
  transactionId: (value) => {
    if (!value?.trim()) {
      return "Transaction ID is required";
    }
    return null;
  },

  salesDate: (value) => {
    if (!value) {
      return "Sales date is required";
    }
    return null;
  },

  // Optional since A4; nothing to say about it field by field.
  contactPerson: () => null,

  contactPhone: (value) => {
    if (!value?.trim()) return null;
    if (!isValidNgPhone(value)) {
      return NG_PHONE_FORMAT_MESSAGE;
    }
    return null;
  },

  endUserName: (value) => {
    if (!value?.trim()) {
      return "End user name is required";
    }
    return null;
  },

  stateBackup: (value) => {
    if (!value) {
      return "State is required";
    }
    return null;
  },

  lgaBackup: (value) => {
    if (!value) {
      return "LGA is required";
    }
    return null;
  },

  phone: (value) => {
    if (!value?.trim()) {
      return "End user phone number is required";
    }
    if (!isValidNgPhone(value)) {
      return NG_PHONE_FORMAT_MESSAGE;
    }
    return null;
  },

  amount: (value) => {
    if (!value || parseFloat(value) <= 0) {
      return "Valid sale amount is required";
    }
    return null;
  },

  stoveSerialNo: (value) => {
    if (!value) {
      return "Stove serial number is required";
    }
    return null;
  },

  address: (addressData) => {
    if (!addressData?.fullAddress?.trim()) {
      return "Residential address is required";
    }
    return null;
  },

  // GPS is optional — a manually typed ("raw") address that isn't on Google
  // Maps is allowed. Coordinates default to 0,0 on submit when not provided.
  location: () => null,

  stoveImage: () => {
    // Stove photo is optional — never blocks submission.
    return null;
  },

  agreementImage: (agreementImageId) => {
    if (!agreementImageId) {
      return "Agreement document is required";
    }
    return null;
  },

  signature: (signature) => {
    if (!isValidSignature(signature)) {
      return "Customer signature is required";
    }
    return null;
  },
};
