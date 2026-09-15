import type { NextAuthConfig } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
    };
  }
}

export const authConfig = {
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  secret: process.env.AUTH_SECRET,
  callbacks: {
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const isLoggedIn = !!auth?.user;
      // Behind Cloudflare Access every request carries a signed identity, so
      // the password form is skipped: /signin hands off to Google SSO. After
      // a sign-out (?manual=1) or a failed SSO (?sso=…) the form stays.
      if (
        nextUrl.pathname === "/signin" &&
        !isLoggedIn &&
        request.headers.has("cf-access-jwt-assertion") &&
        !nextUrl.searchParams.has("manual") &&
        !nextUrl.searchParams.has("sso") &&
        !nextUrl.searchParams.has("error")
      ) {
        const sso = new URL("/signin/sso", nextUrl);
        const callbackUrl = nextUrl.searchParams.get("callbackUrl");
        if (callbackUrl) sso.searchParams.set("callbackUrl", callbackUrl);
        return Response.redirect(sso);
      }
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard");
      const isApiRoute = nextUrl.pathname.startsWith("/api");

      if (isOnDashboard || isApiRoute) {
        return isLoggedIn;
      } else if (isLoggedIn) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      const userId = (token.id as string) || token.sub;
      if (userId) {
        session.user.id = userId;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
