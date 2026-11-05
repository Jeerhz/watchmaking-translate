// Shared-code gate: the site is open when ACCESS_CODE is unset (local dev); otherwise every
// page and API route needs the cookie set by /api/login.

export const COOKIE = "gmt_access";

export async function accessToken(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gmt-desk:${code}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
