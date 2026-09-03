/**
 * Application authentication (Auth.js v5, credentials + JWT sessions).
 *
 * This is STRICTLY separate from data-source authorization. Signing in here never
 * grants access to a provider, and a provider OAuth grant never signs anyone in.
 * The two token stores share no code and no cookie.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/signin" },
  // Railway, and any other platform that terminates TLS upstream, puts the app
  // behind a proxy, so the request host has to come from forwarded headers. That
  // is opted into explicitly via AUTH_TRUST_HOST rather than trusting the Host
  // header unconditionally in production, where a spoofed Host could otherwise
  // poison generated callback URLs. AUTH_URL is read by Auth.js from the
  // environment on its own and is never hardcoded here.
  trustHost: process.env.AUTH_TRUST_HOST === "true" || process.env.NODE_ENV !== "production",
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (!user) {
          // Equalise timing so a missing account is not distinguishable from a
          // wrong password.
          await bcrypt.compare(parsed.data.password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi");
          return null;
        }
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) {
        (session.user as { id?: string }).id = token.uid as string;
      }
      return session;
    },
  },
});

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
