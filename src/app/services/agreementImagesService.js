// Agreement Images Service for user agreement image operations
import { createClientComponentClient } from "@/lib/supabaseClient";
import { supabaseUrl } from "@/lib/supabaseConfig";
import tokenManager from "../../utils/tokenManager";

const API_BASE_URL = supabaseUrl;
const API_FUNCTIONS_URL = `${API_BASE_URL}/functions/v1`;

class AgreementImagesService {
  constructor() {
    this.supabase = createClientComponentClient();
    this.getAgreementImageURL = `${API_FUNCTIONS_URL}/get-agreement-image-by-serial`;
  }

  // Get token using tokenManager
  async getToken() {
    try {
      return await tokenManager.getValidToken();
    } catch (error) {
      console.error("🖼️ [AgreementImages] Token error:", error);
      return null;
    }
  }

  // Helper method to build headers
  async getHeaders() {
    const token = await this.getToken();
    const headers = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  // Get agreement image as binary data
  async getAgreementImageBinary(serialNumber) {
    try {
      const token = await this.getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const url = `${
        this.getAgreementImageURL
      }?serial_number=${encodeURIComponent(serialNumber)}&return_type=binary`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `No agreement image found for serial number: ${serialNumber}`
          );
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      const imageUrl = window.URL.createObjectURL(blob);

      return {
        success: true,
        data: {
          imageUrl,
          blob,
          contentType: response.headers.get("content-type"),
          serialNumber: response.headers.get("x-serial-number"),
          uploadId: response.headers.get("x-upload-id"),
        },
        error: null,
      };
    } catch (error) {
      console.error("Error fetching agreement image binary:", error);
      return {
        success: false,
        data: null,
        error: error.message || "Failed to fetch agreement image",
      };
    }
  }

  // Get agreement image details (metadata)
  async getAgreementImageDetails(serialNumber) {
    try {
      const token = await this.getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const url = `${
        this.getAgreementImageURL
      }?serial_number=${encodeURIComponent(serialNumber)}&return_type=details`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `No agreement image found for serial number: ${serialNumber}`
          );
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      return {
        success: true,
        data: data.data,
        error: null,
      };
    } catch (error) {
      console.error("Error fetching agreement image details:", error);
      return {
        success: false,
        data: null,
        error: error.message || "Failed to fetch agreement image details",
      };
    }
  }

  // Search for serial numbers that might match the search term (for auto-suggestions)
  // This would need to be implemented as a separate endpoint, but for now we'll simulate it
  async searchSerialNumbers(searchTerm) {
    try {
      // This is a placeholder - in a real implementation, you'd call an endpoint
      // that searches through available serial numbers
      const mockResults = [
        `${searchTerm}001`,
        `${searchTerm}002`,
        `${searchTerm}003`,
        `SN${searchTerm}`,
        `${searchTerm}ABC`,
      ].filter((serial) => serial.length >= 3); // Only show if search term is meaningful

      return {
        success: true,
        data: mockResults.slice(0, 5), // Limit to 5 suggestions
        error: null,
      };
    } catch (error) {
      console.error("Error searching serial numbers:", error);
      return {
        success: false,
        data: [],
        error: error.message || "Failed to search serial numbers",
      };
    }
  }

  // Clean up blob URLs to prevent memory leaks
  cleanupImageUrl(imageUrl) {
    if (imageUrl && imageUrl.startsWith("blob:")) {
      window.URL.revokeObjectURL(imageUrl);
    }
  }
}

const agreementImagesService = new AgreementImagesService();
export default agreementImagesService;
