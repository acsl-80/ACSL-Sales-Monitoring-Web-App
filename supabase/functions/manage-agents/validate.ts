// Validation module for agent data

export function validateAgentData(data: any) {
  console.log("🔍 Validating agent data...");

  if (!data || typeof data !== "object") {
    throw new Error("validation: Invalid data format");
  }

  const errors: string[] = [];

  // Required fields validation
  if (!data.email || typeof data.email !== "string" || !data.email.trim()) {
    errors.push("Email is required");
  } else if (!isValidEmail(data.email)) {
    errors.push("Invalid email format");
  }

  if (
    !data.password ||
    typeof data.password !== "string" ||
    data.password.length < 6
  ) {
    errors.push("Password is required and must be at least 6 characters");
  }

  if (
    !data.full_name ||
    typeof data.full_name !== "string" ||
    !data.full_name.trim()
  ) {
    errors.push("Full name is required");
  }

  // Phone is required
  if (!data.phone || typeof data.phone !== "string" || !data.phone.trim()) {
    errors.push("Phone number is required");
  }

  if (data.organization_id && typeof data.organization_id !== "string") {
    errors.push("Organization ID must be a string");
  }

  if (errors.length > 0) {
    throw new Error(`validation: ${errors.join(", ")}`);
  }

  return {
    email: data.email.trim().toLowerCase(),
    password: data.password,
    full_name: data.full_name.trim(),
    phone: data.phone?.trim() || null,
    organization_id: data.organization_id || null,
  };
}

export function validateUpdateData(data: any) {
  console.log("🔍 Validating update data...");

  if (!data || typeof data !== "object") {
    throw new Error("validation: Invalid data format");
  }

  const errors: string[] = [];
  const validatedData: any = {};

  // Email validation (optional for updates)
  if (data.email !== undefined) {
    if (!data.email || typeof data.email !== "string" || !data.email.trim()) {
      errors.push("Email cannot be empty");
    } else if (!isValidEmail(data.email)) {
      errors.push("Invalid email format");
    } else {
      validatedData.email = data.email.trim().toLowerCase();
    }
  }

  // Full name validation (optional for updates)
  if (data.full_name !== undefined) {
    if (
      !data.full_name ||
      typeof data.full_name !== "string" ||
      !data.full_name.trim()
    ) {
      errors.push("Full name cannot be empty");
    } else {
      validatedData.full_name = data.full_name.trim();
    }
  }

  // Phone validation (optional for updates)
  if (data.phone !== undefined) {
    if (data.phone && typeof data.phone !== "string") {
      errors.push("Phone must be a string");
    } else {
      validatedData.phone = data.phone?.trim() || null;
    }
  }

  // Organization ID validation (optional for updates, usually only super_admin can change this)
  if (data.organization_id !== undefined) {
    if (data.organization_id && typeof data.organization_id !== "string") {
      errors.push("Organization ID must be a string");
    } else {
      validatedData.organization_id = data.organization_id || null;
    }
  }

  if (errors.length > 0) {
    throw new Error(`validation: ${errors.join(", ")}`);
  }

  // Ensure at least one field is being updated
  if (Object.keys(validatedData).length === 0) {
    throw new Error(
      "validation: At least one field must be provided for update"
    );
  }

  return validatedData;
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
