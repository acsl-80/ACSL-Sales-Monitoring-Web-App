// Only ever treat a value as a page link when it is an actual web URL — never
// a javascript: link, a bare path, or a protocol-relative host.
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
