// Validation functions for branch operations

export interface BranchCreateData {
  organization_id: string;
  name: string;
  country?: string;
  state?: string;
  lga?: string;
}

export interface BranchUpdateData {
  name?: string;
  country?: string;
  state?: string;
  lga?: string;
}

export function validateBranchCreateData(data: any): BranchCreateData {
  console.log("🔍 Validating branch creation data:", data);

  const errors: string[] = [];

  // Required fields
  if (!data.organization_id || typeof data.organization_id !== "string") {
    errors.push("organization_id is required and must be a valid UUID string");
  }

  if (!data.name || typeof data.name !== "string" || data.name.trim().length === 0) {
    errors.push("name is required and must be a non-empty string");
  }

  if (data.name && data.name.trim().length > 100) {
    errors.push("name must be 100 characters or less");
  }

  // Optional fields validation
  if (data.country && typeof data.country !== "string") {
    errors.push("country must be a string");
  }

  if (data.country && data.country.trim().length > 50) {
    errors.push("country must be 50 characters or less");
  }

  if (data.state && typeof data.state !== "string") {
    errors.push("state must be a string");
  }

  if (data.state && data.state.trim().length > 50) {
    errors.push("state must be 50 characters or less");
  }

  if (data.lga && typeof data.lga !== "string") {
    errors.push("lga must be a string");
  }

  if (data.lga && data.lga.trim().length > 50) {
    errors.push("lga must be 50 characters or less");
  }

  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(", ")}`);
  }

  const validatedData: BranchCreateData = {
    organization_id: data.organization_id,
    name: data.name.trim(),
    country: data.country ? data.country.trim() : "Nigeria", // Default to Nigeria
    state: data.state ? data.state.trim() : null,
    lga: data.lga ? data.lga.trim() : null,
  };

  console.log("✅ Branch creation data validated successfully");
  return validatedData;
}

export function validateBranchUpdateData(data: any): BranchUpdateData {
  console.log("🔍 Validating branch update data:", data);

  const errors: string[] = [];

  // At least one field should be provided for update
  const updateFields = ["name", "country", "state", "lga"];
  const providedFields = updateFields.filter(field => data[field] !== undefined);

  if (providedFields.length === 0) {
    errors.push("At least one field must be provided for update");
  }

  // Validate provided fields
  if (data.name !== undefined) {
    if (typeof data.name !== "string" || data.name.trim().length === 0) {
      errors.push("name must be a non-empty string");
    }
    if (data.name && data.name.trim().length > 100) {
      errors.push("name must be 100 characters or less");
    }
  }

  if (data.country !== undefined) {
    if (typeof data.country !== "string") {
      errors.push("country must be a string");
    }
    if (data.country && data.country.trim().length > 50) {
      errors.push("country must be 50 characters or less");
    }
  }

  if (data.state !== undefined) {
    if (data.state !== null && typeof data.state !== "string") {
      errors.push("state must be a string or null");
    }
    if (data.state && data.state.trim().length > 50) {
      errors.push("state must be 50 characters or less");
    }
  }

  if (data.lga !== undefined) {
    if (data.lga !== null && typeof data.lga !== "string") {
      errors.push("lga must be a string or null");
    }
    if (data.lga && data.lga.trim().length > 50) {
      errors.push("lga must be 50 characters or less");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(", ")}`);
  }

  const validatedData: BranchUpdateData = {};

  if (data.name !== undefined) {
    validatedData.name = data.name.trim();
  }
  if (data.country !== undefined) {
    validatedData.country = data.country ? data.country.trim() : data.country;
  }
  if (data.state !== undefined) {
    validatedData.state = data.state ? data.state.trim() : data.state;
  }
  if (data.lga !== undefined) {
    validatedData.lga = data.lga ? data.lga.trim() : data.lga;
  }

  console.log("✅ Branch update data validated successfully");
  return validatedData;
}

export function validateUUID(uuid: string, fieldName: string): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  if (!uuid || !uuidRegex.test(uuid)) {
    throw new Error(`${fieldName} must be a valid UUID`);
  }
}
