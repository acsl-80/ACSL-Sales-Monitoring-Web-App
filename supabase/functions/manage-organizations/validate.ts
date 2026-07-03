// Validation module for organization and user data

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface CreateOrganizationWithUserData {
  // Organization fields - Only 8 fields as specified
  partner_name: string; // Required - Partner name
  branch: string; // Required - Branch
  state: string; // Required - State
  contact_person?: string; // Optional - Contact person
  contact_phone?: string; // Optional - Contact phone number
  alternative_phone?: string; // Optional - Alternative phone number
  email?: string; // Optional - Email
  address?: string; // Optional - Address

  // Admin user fields (auto-generated from partner data)
  admin_full_name?: string;
  admin_email?: string;
}

export function validateOrganizationData(
  data: any,
  operation: "create" | "update"
): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return {
      isValid: false,
      errors: ["Invalid data format: Expected object"],
    };
  }

  // Required fields for creation - Only 3 required fields
  if (operation === "create") {
    if (
      !data.partner_name ||
      typeof data.partner_name !== "string" ||
      data.partner_name.trim().length === 0
    ) {
      errors.push("Partner name is required");
    }

    if (
      !data.branch ||
      typeof data.branch !== "string" ||
      data.branch.trim().length === 0
    ) {
      errors.push("Branch is required");
    }

    if (
      !data.state ||
      typeof data.state !== "string" ||
      data.state.trim().length === 0
    ) {
      errors.push("State is required");
    }

    // Admin user fields are auto-generated, but if provided, they must be valid
    if (data.admin_full_name !== undefined) {
      if (
        typeof data.admin_full_name !== "string" ||
        data.admin_full_name.trim().length === 0
      ) {
        errors.push(
          "Admin user full name must be a non-empty string if provided"
        );
      }
    }

    if (data.admin_email !== undefined) {
      if (
        typeof data.admin_email !== "string" ||
        data.admin_email.trim().length === 0
      ) {
        errors.push("Admin user email must be a non-empty string if provided");
      } else if (!isValidEmail(data.admin_email)) {
        errors.push(
          "Admin user email must be a valid email address if provided"
        );
      }
    }
  }

  // Validate admin user fields for creation (if provided)
  if (operation === "create") {
    if (data.admin_full_name && typeof data.admin_full_name === "string") {
      if (data.admin_full_name.trim().length === 0) {
        errors.push("Admin user full name cannot be empty");
      } else if (data.admin_full_name.trim().length > 100) {
        errors.push("Admin user full name cannot exceed 100 characters");
      }
    }

    if (data.admin_email && typeof data.admin_email === "string") {
      if (data.admin_email.trim().length === 0) {
        errors.push("Admin user email cannot be empty");
      } else if (!isValidEmail(data.admin_email)) {
        errors.push("Admin user email must be a valid email address");
      }
    }
  }

  // Validate admin user fields for updates (if provided)
  if (operation === "update") {
    if (data.admin_full_name !== undefined) {
      if (typeof data.admin_full_name !== "string") {
        errors.push("Admin user full name must be a string");
      } else if (data.admin_full_name.trim().length === 0) {
        errors.push("Admin user full name cannot be empty");
      } else if (data.admin_full_name.trim().length > 100) {
        errors.push("Admin user full name cannot exceed 100 characters");
      }
    }

    if (data.admin_email !== undefined) {
      if (typeof data.admin_email !== "string") {
        errors.push("Admin user email must be a string");
      } else if (data.admin_email.trim().length === 0) {
        errors.push("Admin user email cannot be empty");
      } else if (!isValidEmail(data.admin_email)) {
        errors.push("Admin user email must be a valid email address");
      }
    }
  }
  // Validate partner name
  if (data.partner_name !== undefined) {
    if (typeof data.partner_name !== "string") {
      errors.push("Partner name must be a string");
    } else if (data.partner_name.trim().length === 0) {
      errors.push("Partner name cannot be empty");
    } else if (data.partner_name.trim().length > 100) {
      errors.push("Partner name cannot exceed 100 characters");
    }
  }

  // Validate branch field
  if (data.branch !== undefined) {
    if (typeof data.branch !== "string") {
      errors.push("Branch must be a string");
    } else if (data.branch.trim().length === 0) {
      errors.push("Branch cannot be empty");
    } else if (data.branch.trim().length > 100) {
      errors.push("Branch cannot exceed 100 characters");
    }
  }

  // Validate contact phone - optional field
  if (data.contact_phone !== undefined && data.contact_phone !== null) {
    if (typeof data.contact_phone !== "string") {
      errors.push("Contact phone must be a string");
    } else if (data.contact_phone.length > 20) {
      errors.push("Contact phone cannot exceed 20 characters");
    }
  }

  // Validate email - optional field
  if (data.email !== undefined && data.email !== null) {
    if (typeof data.email !== "string") {
      errors.push("Email must be a string");
    } else if (data.email.trim().length > 0 && !isValidEmail(data.email)) {
      errors.push("Email must be a valid email address");
    }
  }

  // Validate contact person if provided
  if (data.contact_person !== undefined && data.contact_person !== null) {
    if (typeof data.contact_person !== "string") {
      errors.push("Contact person must be a string");
    } else if (data.contact_person.length > 100) {
      errors.push("Contact person cannot exceed 100 characters");
    }
  }

  // Validate alternative phone if provided
  if (data.alternative_phone !== undefined && data.alternative_phone !== null) {
    if (typeof data.alternative_phone !== "string") {
      errors.push("Alternative phone must be a string");
    } else if (data.alternative_phone.length > 20) {
      errors.push("Alternative phone cannot exceed 20 characters");
    }
  }

  // Validate state - required field
  if (data.state !== undefined) {
    if (typeof data.state !== "string") {
      errors.push("State must be a string");
    } else if (data.state.trim().length === 0 && operation === "create") {
      errors.push("State cannot be empty");
    } else if (data.state.length > 100) {
      errors.push("State cannot exceed 100 characters");
    }
  }

  // Validate address - optional field
  if (data.address !== undefined && data.address !== null) {
    if (typeof data.address !== "string") {
      errors.push("Address must be a string");
    } else if (data.address.length > 255) {
      errors.push("Address cannot exceed 255 characters");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Helper function to validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
