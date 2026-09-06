import { isStoveDbFormat, toStoveDbRows } from "../_shared/stove-db-shape.ts";
import type { SaleOptionLists } from "../_shared/sale-options.ts";
// Format transformer module for different response formats

export interface ClaraFormat {
  serialNumber: string;
  salesDate: string;
  created: string;
  state: string;
  district: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  contactPerson: string;
  otherContactPhone: string | null;
  salesPartner: string;
  userName: string;
  userSurname: string;
  cpa: Record<string, boolean> | string | null;
}

export function transformToFormat1(salesData: any[]): ClaraFormat[] {
  console.log("🔄 Transforming to Format 1 (Clara's format)...");
  
  return salesData.map(sale => {
    // Extract names from full_name or end_user_name
    // The name in its two columns since slice F2 (A2). The first-word guess
    // remains only for a row that somehow carries neither part.
    const fullName = sale.end_user_name || '';
    const nameParts = fullName.trim().split(' ');
    const userName = sale.end_user_first_name || (sale.end_user_surname ? '' : nameParts[0] || '');
    const userSurname = sale.end_user_surname || (sale.end_user_first_name ? '' : nameParts.slice(1).join(' ') || '');

    // Extract address information. Address may arrive as `addresses` (main-query
    // join) or `address` (fetched in fetch-related) — support both.
    const addr = sale.addresses || sale.address;
    const address = addr?.full_address ||
                   `${addr?.street || ''} ${addr?.city || ''}`.trim() ||
                   '';

    const state = sale.state_backup || addr?.state || sale.organizations?.state || sale.organization?.state || '';
    const district = sale.lga_backup || '';

    // Extract coordinates
    const latitude = addr?.latitude || null;
    const longitude = addr?.longitude || null;
    
    // Extract partner/field assistant info
    const salesPartner = sale.partner_name || sale.organizations?.partner_name || '';
    
    // Format dates
    const salesDate = sale.sales_date || '';
    const created = sale.created_at ? new Date(sale.created_at).toISOString() : '';
    
    return {
      serialNumber: sale.stove_serial_no || '',
      salesDate: salesDate,
      created: created,
      state: state,
      district: district,
      address: address,
      latitude: latitude,
      longitude: longitude,
      phone: sale.phone || sale.contact_phone || '',
      contactPerson: sale.contact_person || '',
      otherContactPhone: sale.other_phone || null,
      salesPartner: salesPartner,
      userName: userName,
      userSurname: userSurname,
      cpa: sale.terms_accepted ?? null, // D27: CPA is the six consents the agreement carries
    };
  });
}

export function keepFormat2(salesData: any[]): any[] {
  console.log("🔄 Keeping Format 2 (current database format)...");
  // Return the original format as-is
  return salesData;
}

export function transformResponse(
  salesData: any[],
  format: string,
  /** The registry's option lists, for the Stove DB shape's choice labels. */
  optionLists: SaleOptionLists | null = null,
): any[] {
  if (!salesData || salesData.length === 0) {
    return [];
  }
  // The Stove DB shape (slice F4): the parent database's names, word for word.
  if (isStoveDbFormat(format)) {
    return toStoveDbRows(salesData, optionLists);
  }

  switch (format) {
    case 'format1':
    case '1':
      return transformToFormat1(salesData);
    case 'format2':
    case '2':
      return keepFormat2(salesData);
    default:
      // Default to format1 as requested
      return transformToFormat1(salesData);
  }
}
