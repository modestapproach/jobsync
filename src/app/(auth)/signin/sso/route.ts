import { AuthError } from "next-auth";
import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { signIn } from "@/auth";

// GET /signin/sso — sign the owner in from the Cloudflare Access (Google)
// identity on this request. /signin forwards here automatically; on any
// failure the password form comes back with ?sso=failed so it never loops.
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("callbackUrl");
  // Only same-site paths: never bounce a signed-in session to another origin.
  const redirectTo = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
  try {
    await signIn("cloudflare-access", { redirectTo });
  } catch (error) {
    unstable_rethrow(error); // signIn's success path is a redirect
    if (!(error instanceof AuthError)) console.error("Access SSO failed:", error);
    return NextResponse.redirect(new URL("/signin?sso=failed", request.nextUrl));
  }
  return NextResponse.redirect(new URL(redirectTo, request.nextUrl));
}
