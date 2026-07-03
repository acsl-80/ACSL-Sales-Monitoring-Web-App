/**
 * Profile Data Utilities
 * Handles loading and processing user profile data
 */

import profileService from "../services/profileService";

/**
 * Loads profile data from localStorage and extracts partner name
 * @returns {Promise<Object>} Object containing partnerName and organizationId
 */
export const loadProfileData = async () => {
  try {
    const profile = profileService.getStoredProfileData();
    // console.log("PARTNER DATA", profile.organizations.partner_name);
    if (profile) {
      return {
        partnerName:
          profile.organizations?.partner_name ||
          profile.organization?.partner_name ||
          "",
        organizationId: profile.organization_id || "",
        success: true,
      };
    }
    return {
      partnerName: "",
      organizationId: "",
      success: false,
      error: "No profile data found",
    };
  } catch (error) {
    console.error("Error loading profile data:", error);
    return {
      partnerName: "",
      organizationId: "",
      success: false,
      error: "Failed to load profile data",
    };
  }
};

/**
 * Gets organization ID from stored profile
 * @returns {string|null} Organization ID or null if not found
 */
export const getOrganizationId = () => {
  return profileService.getOrganizationId();
};
