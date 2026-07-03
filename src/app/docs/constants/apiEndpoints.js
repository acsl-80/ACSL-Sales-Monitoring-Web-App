// API Endpoints Documentation Constants
// This file contains all API endpoint definitions used across the documentation

export const API_BASE_CONFIG = {
  baseUrl:
    import.meta.env.VITE_SUPABASE_URL ||
    "https://your-supabase-project.supabase.co",
  functionsPath: "/functions/v1",
  get functionsUrl() {
    return `${this.baseUrl}${this.functionsPath}`;
  },
};

// Admin API Endpoints
export const ADMIN_ENDPOINTS = {
  // Dashboard Endpoints
  dashboard: {
    getStats: {
      endpoint: "get-dashboard-stats",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/get-dashboard-stats`,
      description: "Retrieve dashboard statistics for admin users",
      requiredAuth: true,
      role: "admin",
      parameters: {},
      response: {
        success: "boolean",
        data: {
          totalSales: "number",
          monthlySales: "number",
          activeAgents: "number",
          totalRevenue: "number",
        },
      },
    },
    getUserProfile: {
      endpoint: "get-user-profile",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/get-user-profile`,
      description: "Get current user profile information",
      requiredAuth: true,
      role: "admin",
      parameters: {},
      response: {
        success: "boolean",
        data: {
          id: "string",
          full_name: "string",
          email: "string",
          role: "string",
          organization_id: "string",
        },
      },
    },
  },

  // Sales Management Endpoints
  sales: {
    getSalesAdvanced: {
      endpoint: "get-sales-advanced",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/get-sales-advanced`,
      description:
        "Advanced sales data retrieval with filtering and pagination for admin users (Returns Format 2 - Database Format)",
      requiredAuth: true,
      role: "admin",
      parameters: {
        page: "number (optional, default: 1)",
        limit: "number (optional, default: 50)",
        search: "string (optional)",
        status: "string (optional)",
        date_from: "string (optional, ISO date)",
        date_to: "string (optional, ISO date)",
        agent_id: "string (optional)",
        sort_by: "string (optional, default: 'created_at')",
        sort_order: "string (optional, 'asc' or 'desc', default: 'desc')",
        responseFormat:
          "string (optional, 'format1' or 'format2', default: 'format2' for admin)",
      },
      response: {
        success: "boolean",
        data: [
          {
            id: "string (UUID)",
            stove_serial_no: "string",
            sales_date: "string (ISO date)",
            created_at: "string (ISO timestamp)",
            end_user_name: "string",
            contact_person: "string",
            phone: "string",
            other_phone: "string",
            partner_name: "string",
            state_backup: "string",
            lga_backup: "string",
            addresses: {
              full_address: "string",
              latitude: "number",
              longitude: "number",
            },
            organizations: {
              partner_name: "string",
              state: "string",
            },
          },
        ],
        pagination: {
          total: "number",
          limit: "number",
          offset: "number",
          hasMore: "boolean",
        },
      },
    },
    getSale: {
      endpoint: "get-sale",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/get-sale`,
      description:
        "Retrieve a single sale record using ID, transaction ID, or stove serial number. Supports flexible lookup methods with organization-based access control.",
      requiredAuth: true,
      role: "admin",
      parameters: {
        id: "UUID (optional) - Sale's unique identifier",
        transaction_id: "string (optional) - Transaction ID of the sale",
        stove_serial_no: "string (optional) - Stove serial number",
        NOTE: "You must provide exactly ONE of: id, transaction_id, or stove_serial_no",
      },
      response: {
        success: "boolean",
        data: {
          id: "string (UUID) - Unique sale identifier",
          transaction_id: "string - Transaction ID",
          stove_serial_no: "string - Stove serial number",
          customer_name: "string - Customer full name",
          customer_phone: "string - Customer phone number",
          total_price: "number - Sale total price",
          status: "string - Sale status (completed, pending, etc.)",
          created_at: "string (ISO timestamp) - Creation timestamp",
          organization_id: "string - Organization identifier",
          agent_id: "string - Sales agent identifier",
          address: {
            id: "string - Address record ID",
            street: "string - Street address",
            city: "string - City name",
            state: "string - State name",
            postal_code: "string - Postal code",
          },
          stove_image: {
            id: "string - Image record ID",
            file_url: "string - Image URL",
            file_name: "string - Image filename",
          },
          agreement_image: {
            id: "string - Agreement record ID",
            file_url: "string - Agreement document URL",
            file_name: "string - Agreement filename",
          },
        },
        message: "string (optional) - Success message",
      },
      errorResponses: {
        400: {
          success: false,
          message:
            "Missing required parameter: id, transaction_id, or stove_serial_no",
        },
        401: {
          success: false,
          message: "Unauthorized",
        },
        404: {
          success: false,
          message: "Sale not found or access denied",
          error: "Error details...",
        },
        500: {
          success: false,
          message: "Unexpected error",
          error: "Error details...",
        },
      },
      useCases: [
        "Customer Support: Look up sales by transaction ID when customers call",
        "Field Service: Find sales by stove serial number for maintenance",
        "Admin Dashboard: Get detailed sale information by UUID",
        "Mobile App: Quick sale lookup using any available identifier",
      ],
      features: [
        "Flexible Lookup: Find sales by UUID, transaction ID, or stove serial number",
        "Security: Organization-based access control (users only see their org's sales)",
        "Rich Data: Returns sale with related address and image data",
        "Super Admin: Super admins can access all sales across organizations",
      ],
    },
    createSale: {
      endpoint: "create-sale",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/create-sale`,
      description: "Create a new sale record",
      requiredAuth: true,
      role: "admin",
      parameters: {
        stove_id: "string (required)",
        customer_name: "string (required)",
        customer_phone: "string (required)",
        customer_address: "string (required)",
        price: "number (required)",
        agent_id: "string (optional)",
        payment_method: "string (optional)",
        notes: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "newly created sale object",
        message: "string",
      },
    },
    updateSale: {
      endpoint: "update-sale",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/update-sale`,
      description: "Update an existing sale record",
      requiredAuth: true,
      role: "admin",
      parameters: {
        sale_id: "string (required)",
        customer_name: "string (optional)",
        customer_phone: "string (optional)",
        customer_address: "string (optional)",
        price: "number (optional)",
        status: "string (optional)",
        notes: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "updated sale object",
        message: "string",
      },
    },
    getStoveIds: {
      endpoint: "get-stove-ids",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/get-stove-ids`,
      description: "Get available stove IDs for sale creation",
      requiredAuth: true,
      role: "admin",
      parameters: {
        organization_id: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "array of available stove objects",
      },
    },
    uploadImage: {
      endpoint: "upload-image",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/upload-image`,
      description: "Upload images for sales (stove or agreement images)",
      requiredAuth: true,
      role: "admin",
      parameters: {
        image: "string (base64 encoded image)",
        filename: "string (required)",
        folder: "string (optional, default: 'stove_images')",
      },
      response: {
        success: "boolean",
        data: {
          url: "string",
          public_id: "string",
        },
      },
    },
  },

  // Agent Management Endpoints
  agents: {
    getAgents: {
      endpoint: "manage-agents",
      method: "GET",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-agents`,
      description: "Get list of sales agents for admin's organization",
      requiredAuth: true,
      role: "admin",
      parameters: {
        page: "number (optional, default: 1)",
        limit: "number (optional, default: 20)",
        search: "string (optional)",
        status: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "array of agent objects",
        pagination: "pagination object",
      },
    },
    getAgent: {
      endpoint: "manage-agents/{agent_id}",
      method: "GET",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-agents/{agent_id}`,
      description: "Get detailed information about a specific agent",
      requiredAuth: true,
      role: "admin",
      parameters: {
        agent_id: "string (required, in URL path)",
      },
      response: {
        success: "boolean",
        data: "agent object with full details",
      },
    },
    createAgent: {
      endpoint: "manage-agents",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-agents`,
      description: "Create a new sales agent",
      requiredAuth: true,
      role: "admin",
      parameters: {
        full_name: "string (required)",
        email: "string (required)",
        phone: "string (required)",
        address: "string (optional)",
        role: "string (default: 'agent')",
      },
      response: {
        success: "boolean",
        data: "newly created agent object",
        message: "string",
      },
    },
    updateAgent: {
      endpoint: "manage-agents/{agent_id}",
      method: "PUT",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-agents/{agent_id}`,
      description: "Update an existing agent",
      requiredAuth: true,
      role: "admin",
      parameters: {
        agent_id: "string (required, in URL path)",
        full_name: "string (optional)",
        email: "string (optional)",
        phone: "string (optional)",
        address: "string (optional)",
        status: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "updated agent object",
        message: "string",
      },
    },
    deleteAgent: {
      endpoint: "manage-agents/{agent_id}",
      method: "DELETE",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-agents/{agent_id}`,
      description: "Delete an agent",
      requiredAuth: true,
      role: "admin",
      parameters: {
        agent_id: "string (required, in URL path)",
      },
      response: {
        success: "boolean",
        message: "string",
      },
    },
  },

  // Branch Management Endpoints
  branches: {
    getBranches: {
      endpoint: "manage-branches",
      method: "GET",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-branches`,
      description: "Get branches for admin's organization",
      requiredAuth: true,
      role: "admin",
      parameters: {
        page: "number (optional, default: 1)",
        limit: "number (optional, default: 20)",
        search: "string (optional)",
        state: "string (optional)",
        city: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "array of branch objects",
        pagination: "pagination object",
      },
    },
    getBranch: {
      endpoint: "manage-branches/{branch_id}",
      method: "GET",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-branches/{branch_id}`,
      description: "Get detailed information about a specific branch",
      requiredAuth: true,
      role: "admin",
      parameters: {
        branch_id: "string (required, in URL path)",
      },
      response: {
        success: "boolean",
        data: "branch object with full details",
      },
    },
    createBranch: {
      endpoint: "manage-branches",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-branches`,
      description: "Create a new branch for admin's organization",
      requiredAuth: true,
      role: "admin",
      parameters: {
        name: "string (required)",
        address: "string (required)",
        city: "string (required)",
        state: "string (required)",
        phone: "string (optional)",
        manager_name: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "newly created branch object",
        message: "string",
      },
    },
    updateBranch: {
      endpoint: "manage-branches/{branch_id}",
      method: "PUT",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-branches/{branch_id}`,
      description: "Update an existing branch",
      requiredAuth: true,
      role: "admin",
      parameters: {
        branch_id: "string (required, in URL path)",
        name: "string (optional)",
        address: "string (optional)",
        city: "string (optional)",
        state: "string (optional)",
        phone: "string (optional)",
        manager_name: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "updated branch object",
        message: "string",
      },
    },
  },

  // Activity Logging Endpoints
  activities: {
    logActivity: {
      endpoint: "log-sales-activity",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/log-sales-activity`,
      description: "Log a sales activity for tracking purposes",
      requiredAuth: true,
      role: "admin",
      parameters: {
        sale_id: "string (required)",
        activity_type: "string (required)",
        description: "string (required)",
        metadata: "object (optional)",
      },
      response: {
        success: "boolean",
        data: "logged activity object",
        message: "string",
      },
    },
    getActivities: {
      endpoint: "get-sales-activities",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/get-sales-activities`,
      description: "Get sales activities history",
      requiredAuth: true,
      role: "admin",
      parameters: {
        page: "number (optional, default: 1)",
        limit: "number (optional, default: 20)",
        sale_id: "string (optional)",
        activity_type: "string (optional)",
        date_from: "string (optional, ISO date)",
        date_to: "string (optional, ISO date)",
      },
      response: {
        success: "boolean",
        data: "array of activity objects",
        pagination: "pagination object",
      },
    },
  },
};

// Super Admin API Endpoints
export const SUPER_ADMIN_ENDPOINTS = {
  // Advanced Sales Endpoints
  sales: {
    getSale: {
      endpoint: "get-sale",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/get-sale`,
      description:
        "Retrieve a single sale record using ID, transaction ID, or stove serial number. Super admins can access sales from any organization.",
      requiredAuth: true,
      role: "super_admin",
      parameters: {
        id: "UUID (optional) - Sale's unique identifier",
        transaction_id: "string (optional) - Transaction ID of the sale",
        stove_serial_no: "string (optional) - Stove serial number",
        NOTE: "You must provide exactly ONE of: id, transaction_id, or stove_serial_no",
      },
      response: {
        success: "boolean",
        data: {
          id: "string (UUID) - Unique sale identifier",
          transaction_id: "string - Transaction ID",
          stove_serial_no: "string - Stove serial number",
          customer_name: "string - Customer full name",
          customer_phone: "string - Customer phone number",
          total_price: "number - Sale total price",
          status: "string - Sale status (completed, pending, etc.)",
          created_at: "string (ISO timestamp) - Creation timestamp",
          organization_id: "string - Organization identifier",
          agent_id: "string - Sales agent identifier",
          address: "object - Address information with full details",
          stove_image: "object - Stove image information",
          agreement_image: "object - Agreement document information",
        },
      },
      superAdminFeatures: [
        "Access sales from ANY organization (not restricted by organization_id)",
        "Full system-wide sale lookup capabilities",
        "Cross-organization data access for support and auditing",
        "Complete sale data including all related information",
      ],
    },
    getSalesAdvanced: {
      endpoint: "get-sales-advanced",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/get-sales-advanced`,
      description:
        "Advanced sales data retrieval with comprehensive filtering across all organizations (Super Admin only - Returns Format 1 - Standardized Format)",
      requiredAuth: true,
      role: "super_admin",
      parameters: {
        limit: "number (optional, default: 100)",
        offset: "number (optional, default: 0)",
        search: "string (optional)",
        states: "array of strings (optional)",
        organizationIds: "array of strings (optional)",
        startDate: "string (optional, ISO date)",
        endDate: "string (optional, ISO date)",
        responseFormat:
          "string (optional, 'format1' or 'format2', default: 'format1' for super_admin)",
      },
      response: {
        success: "boolean",
        data: [
          {
            serialNumber: "string",
            salesDate: "string (ISO date)",
            created: "string (ISO timestamp)",
            state: "string",
            district: "string",
            address: "string",
            latitude: "number",
            longitude: "number",
            phone: "string",
            contactPerson: "string",
            otherContactPhone: "string",
            salesPartner: "string",
            userName: "string",
            userSurname: "string",
            cpa: "null or string",
          },
        ],
        pagination: {
          total: "number",
          limit: "number",
          offset: "number",
          hasMore: "boolean",
        },
      },
    },
  },

  // Organization Management Endpoints
  organizations: {
    getOrganizations: {
      endpoint: "manage-organizations",
      method: "GET",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-organizations`,
      description: "Get all partner organizations (Super Admin only)",
      requiredAuth: true,
      role: "super_admin",
      parameters: {
        page: "number (optional, default: 1)",
        limit: "number (optional, default: 20)",
        search: "string (optional)",
        type: "string (optional)",
        status: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "array of organization objects",
        pagination: "pagination object",
      },
    },
    getOrganization: {
      endpoint: "manage-organizations/{organization_id}",
      method: "GET",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-organizations/{organization_id}`,
      description: "Get detailed information about a specific organization",
      requiredAuth: true,
      role: "super_admin",
      parameters: {
        organization_id: "string (required, in URL path)",
      },
      response: {
        success: "boolean",
        data: "organization object with full details",
      },
    },
    createOrganization: {
      endpoint: "manage-organizations",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-organizations`,
      description: "Create a new partner organization",
      requiredAuth: true,
      role: "super_admin",
      parameters: {
        name: "string (required)",
        partner_email: "string (required)",
        type: "string (required)",
        address: "string (required)",
        contact_info: "object (optional)",
      },
      response: {
        success: "boolean",
        data: "newly created organization object",
        message: "string",
      },
    },
    updateOrganization: {
      endpoint: "manage-organizations/{organization_id}",
      method: "PUT",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-organizations/{organization_id}`,
      description: "Update an existing organization",
      requiredAuth: true,
      role: "super_admin",
      parameters: {
        organization_id: "string (required, in URL path)",
        name: "string (optional)",
        partner_email: "string (optional)",
        type: "string (optional)",
        address: "string (optional)",
        contact_info: "object (optional)",
      },
      response: {
        success: "boolean",
        data: "updated organization object",
        message: "string",
      },
    },
    importOrganizationsCSV: {
      endpoint: "manage-organizations?import_csv=true",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-organizations?import_csv=true`,
      description: "Import organizations from CSV file",
      requiredAuth: true,
      role: "super_admin",
      parameters: {
        csv_data: "string (CSV content as string)",
        mapping: "object (column mapping configuration)",
      },
      response: {
        success: "boolean",
        data: {
          imported: "number",
          failed: "number",
          errors: "array of error objects",
        },
        message: "string",
      },
    },
  },

  // Branch Management (Cross-Organization)
  branches: {
    getAllBranches: {
      endpoint: "manage-branches?super_admin=true",
      method: "GET",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-branches?super_admin=true`,
      description: "Get branches across all organizations (Super Admin only)",
      requiredAuth: true,
      role: "super_admin",
      parameters: {
        page: "number (optional, default: 1)",
        limit: "number (optional, default: 20)",
        search: "string (optional)",
        organization_id: "string (optional)",
        state: "string (optional)",
        city: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "array of branch objects with organization details",
        pagination: "pagination object",
      },
    },
    getPartnerBranches: {
      endpoint: "manage-branches/partner/{organization_id}",
      method: "GET",
      url: `${API_BASE_CONFIG.functionsUrl}/manage-branches/partner/{organization_id}`,
      description: "Get branches for a specific partner organization",
      requiredAuth: true,
      role: "super_admin",
      parameters: {
        organization_id: "string (required, in URL path)",
        page: "number (optional, default: 1)",
        limit: "number (optional, default: 20)",
        search: "string (optional)",
      },
      response: {
        success: "boolean",
        data: "array of branch objects",
        organization: "organization object",
        pagination: "pagination object",
      },
    },
  },

  // Agreement Images Endpoints
  agreementImages: {
    getAgreementImage: {
      endpoint: "get-agreement-image-by-serial",
      method: "POST",
      url: `${API_BASE_CONFIG.functionsUrl}/get-agreement-image-by-serial`,
      description: "Get agreement image by serial number",
      requiredAuth: true,
      role: "super_admin",
      parameters: {
        serial_number: "string (required)",
      },
      response: {
        success: "boolean",
        data: {
          image_url: "string",
          sale_info: "object",
          customer_info: "object",
        },
      },
    },
  },
};

// Flutter Mobile App Endpoints (for reference)
export const MOBILE_ENDPOINTS = {
  // These endpoints are also used by the Flutter mobile app
  auth: {
    login: "Handled by Supabase Auth",
    logout: "Handled by Supabase Auth",
    refreshToken: "Handled by Supabase Auth",
  },

  // Shared endpoints used by both web and mobile
  shared: {
    createSale: ADMIN_ENDPOINTS.sales.createSale,
    uploadImage: ADMIN_ENDPOINTS.sales.uploadImage,
    getStoveIds: ADMIN_ENDPOINTS.sales.getStoveIds,
    getSalesAdvanced: ADMIN_ENDPOINTS.sales.getSalesAdvanced,
  },
};

// Error Response Structure
export const ERROR_RESPONSES = {
  unauthorized: {
    success: false,
    error: "Unauthorized access",
    message: "Authentication required or invalid token",
    statusCode: 401,
  },
  forbidden: {
    success: false,
    error: "Forbidden",
    message: "Insufficient permissions for this operation",
    statusCode: 403,
  },
  notFound: {
    success: false,
    error: "Not found",
    message: "Requested resource not found",
    statusCode: 404,
  },
  validationError: {
    success: false,
    error: "Validation error",
    message: "Invalid input parameters",
    statusCode: 400,
    details: "array of validation error details",
  },
  serverError: {
    success: false,
    error: "Internal server error",
    message: "An unexpected error occurred",
    statusCode: 500,
  },
};

// Authentication Requirements
export const AUTH_REQUIREMENTS = {
  headers: {
    Authorization: "Bearer <supabase_jwt_token>",
    "Content-Type": "application/json",
  },
  roles: {
    admin: "Can access organization-specific resources",
    super_admin: "Can access all resources across organizations",
    agent: "Limited access to sales creation and viewing",
  },
  tokenRefresh:
    "Tokens are automatically refreshed by the tokenManager utility",
};
