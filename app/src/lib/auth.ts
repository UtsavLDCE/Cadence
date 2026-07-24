import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Derive base URL from the request host so logout/callbacks work behind any
  // host/IP without AUTH_URL. Set in config so it survives a stale/empty env —
  // AUTH_TRUST_HOST wasn't reaching the container. App sits behind our own
  // compose/proxy, not arbitrary Host headers, so this is safe.
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.password) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        // Stamp last login — the only server-side login signal (JWT sessions
        // aren't persisted). Surfaced in the admin Engagement tab.
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, teamId: true },
        });
        token.role = dbUser?.role ?? "MEMBER";
        token.teamId = dbUser?.teamId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        session.user.role = token.role as "ADMIN" | "MANAGER" | "MEMBER";
        session.user.teamId = token.teamId as string | null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
