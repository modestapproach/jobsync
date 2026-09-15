import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { User } from "./models/user.model";
import prisma from "./lib/db";
import { allowedAccessEmails, verifyAccessAssertion } from "./lib/cloudflare-access";

async function getUser(email: string): Promise<User | undefined> {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });
    return user || undefined;
  } catch (error) {
    console.error("Failed to fetch user:", error);
    throw new Error("Failed to fetch user.");
  }
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // Google login via Cloudflare Access: the identity comes from Access's
    // signed request header (verified in verifyAccessAssertion), never from
    // anything the browser posts. The Access email maps to its JobSync user,
    // or to ACCESS_USER_EMAIL for the owner's other Google account.
    Credentials({
      id: "cloudflare-access",
      name: "Google",
      credentials: {},
      async authorize(_credentials, request) {
        const email = await verifyAccessAssertion(request.headers.get("cf-access-jwt-assertion"));
        if (!email || !allowedAccessEmails().includes(email)) return null;
        const user = (await getUser(email)) ?? (process.env.ACCESS_USER_EMAIL ? await getUser(process.env.ACCESS_USER_EMAIL) : undefined);
        return user ?? null;
      },
    }),
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);
          if (!user) return null;
          const passwordsMatch = await bcrypt.compare(password, user.password);
          if (passwordsMatch) return user;
        }
        console.log("Invalid credentials");
        return null;
      },
    }),
  ],
});
