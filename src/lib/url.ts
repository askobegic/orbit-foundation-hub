// Only http(s) URLs are safe to store or render as a clickable profile
// link. Rejects javascript:, data:, vbscript:, file:, and any other
// scheme. Uses the platform URL parser (not a hand-rolled regex) so it
// agrees with how the browser itself will interpret the same string.
export function isSafeProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
