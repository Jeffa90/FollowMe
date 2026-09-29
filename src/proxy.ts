import { NextRequest, NextResponse } from "next/server";

// Per-request CSP nonce + security headers. Embed routes may be framed by SharePoint/Teams; everything else may not.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const isEmbed = request.nextUrl.pathname.startsWith("/embed/");
  const ancestors = isEmbed
    ? `'self' ${process.env.EMBED_FRAME_ANCESTORS ?? "https://*.sharepoint.com https://teams.microsoft.com https://*.teams.microsoft.com"}`
    : "'none'";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // React inline style attributes; scripts remain nonce-locked
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${ancestors}`,
    "frame-src 'none'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!isEmbed) res.headers.set("X-Frame-Options", "DENY");
  if (process.env.NODE_ENV === "production") res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
