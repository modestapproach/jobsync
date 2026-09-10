import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // https://nextjs.org/docs/app/building-your-application/routing/middleware#matcher
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    // /api/automations/tick is the Cron Trigger entry; it authenticates with
    // CRON_SECRET (no user session) and must not be redirected to sign-in.
    "/api/((?!auth|mcp|automations/tick).*)",
  ],
};
