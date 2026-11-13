// Temporary admin gate until Phase 2 role-based accounts. Used by proxy.ts (every request) and again by the
// data layer (lib/api.ts) before any API call, so a proxy matcher gap can't expose owner data.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAuthorized(authorization: string | null): boolean {
  const user = process.env.ADMIN_BASIC_USER;
  const pass = process.env.ADMIN_BASIC_PASSWORD;
  if (!user || !pass) return false; // fail closed when unconfigured
  if (!authorization?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(authorization.slice(6).trim());
  } catch {
    return false;
  }
  return timingSafeEqual(decoded, `${user}:${pass}`);
}
