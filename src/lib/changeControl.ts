// The ACSL ERP's Change Control form. Configurable so the ERP address can
// move without a code change; defaults to the production ERP.
const ERP_CC_URL =
  import.meta.env.VITE_ERP_CHANGE_CONTROL_URL || "https://www.atmosfair.site/change-control";

/**
 * Builds a link to the ERP's "raise a change request" form, prefilled with
 * which app the request comes from and the exact page the person was on.
 * Call at click or render time so `from` always reflects the current page.
 */
export function buildChangeControlUrl(currentUrl: string = window.location.href): string {
  return `${ERP_CC_URL}/new?app=sales-web&from=${encodeURIComponent(currentUrl)}`;
}
