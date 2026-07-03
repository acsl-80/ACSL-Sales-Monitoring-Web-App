// Validation module for admin user data

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateAdminUserData(
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

  // Required fields for creation
  if (operation === "create") {
    if (
      !data.full_name ||
      typeof data.full_name !== "string" ||
      data.full_name.trim().length === 0
    ) {
      errors.push("Full name is required");
    }

    if (
      !data.email ||
      typeof data.email !== "string" ||
      data.email.trim().length === 0
    ) {
      errors.push("Email is required");
    }

    if (
      !data.organization_id ||
      typeof data.organization_id !== "string" ||
      data.organization_id.trim().length === 0
    ) {
      errors.push("Organization ID is required");
    }
  }

  // Validate full name if provided
  if (data.full_name !== undefined) {
    if (typeof data.full_name !== "string") {
      errors.push("Full name must be a string");
    } else if (data.full_name.trim().length === 0) {
      errors.push("Full name cannot be empty");
    } else if (data.full_name.trim().length > 100) {
      errors.push("Full name cannot exceed 100 characters");
    } else if (!/^[a-zA-Z\s'-]+$/.test(data.full_name.trim())) {
      errors.push(
        "Full name can only contain letters, spaces, hyphens, and apostrophes"
      );
    }
  }

  // Validate email if provided
  if (data.email !== undefined) {
    if (typeof data.email !== "string") {
      errors.push("Email must be a string");
    } else if (data.email.trim().length === 0) {
      errors.push("Email cannot be empty");
    } else if (!isValidEmail(data.email)) {
      errors.push("Email must be a valid email address");
    } else if (data.email.length > 255) {
      errors.push("Email cannot exceed 255 characters");
    }
  }

  // Validate organization_id if provided
  if (data.organization_id !== undefined) {
    if (typeof data.organization_id !== "string") {
      errors.push("Organization ID must be a string");
    } else if (data.organization_id.trim().length === 0) {
      errors.push("Organization ID cannot be empty");
    } else if (!isValidUUID(data.organization_id)) {
      errors.push("Organization ID must be a valid UUID");
    }
  }

  // Validate password if provided (only for creation)
  if (data.password !== undefined) {
    if (operation === "update") {
      errors.push("Password cannot be updated through this endpoint");
    } else if (typeof data.password !== "string") {
      errors.push("Password must be a string");
    } else if (data.password.length < 8) {
      errors.push("Password must be at least 8 characters long");
    } else if (data.password.length > 128) {
      errors.push("Password cannot exceed 128 characters");
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(data.password)) {
      errors.push(
        "Password must contain at least one lowercase letter, one uppercase letter, and one number"
      );
    }
  }

  // Validate role if provided (should only be admin)
  if (data.role !== undefined) {
    if (data.role !== "admin") {
      errors.push("Role must be 'admin' for this endpoint");
    }
  }

  // Validate any unexpected fields
  const allowedFields = [
    "full_name",
    "email",
    "organization_id",
    "password",
    "role",
  ];

  const providedFields = Object.keys(data);
  const unexpectedFields = providedFields.filter(
    (field) => !allowedFields.includes(field)
  );

  if (unexpectedFields.length > 0) {
    errors.push(`Unexpected fields: ${unexpectedFields.join(", ")}`);
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

// Helper function to validate UUID format
function isValidUUID(uuid: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
