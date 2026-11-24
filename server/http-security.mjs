const DEFAULT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob: https://cdn.piltoverarchive.com https://exburst.dev https://cmsassets.rgpub.io https://static.dotgg.gg",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self' https:"
].join("; ");

export function securityHeaders(extra = {}) {
  return {
    "content-security-policy": process.env.RIFTBOUND_CONTENT_SECURITY_POLICY || DEFAULT_CSP,
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...extra
  };
}

export function healthPayload() {
  return {
    ok: true,
    status: "ready",
    version: process.env.RIFTBOUND_RELEASE_VERSION || "development",
    startedAt: processStartedAt
  };
}

const processStartedAt = new Date().toISOString();
