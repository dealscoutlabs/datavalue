import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: real authorization happens in the data layer (lib/api.ts sends the session to the
// API, which verifies it on every call) and inside every server action.
export function proxy(request: NextRequest) {
  if (!request.cookies.get("rs_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/agent/:path*"],
};
