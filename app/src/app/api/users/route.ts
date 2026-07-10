import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const ROLES = ["ADMIN", "MANAGER", "MEMBER"] as const;
type Role = (typeof ROLES)[number];

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      teamId: true,
      managerId: true,
      team: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true, email: true } },
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(users);
}

// POST /api/users  { name, email, password, role?, teamId? }  -> admin creates a user
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role: Role = ROLES.includes(body.role) ? body.role : "MEMBER";
  const teamId = typeof body.teamId === "string" && body.teamId ? body.teamId : null;
  const managerId = typeof body.managerId === "string" && body.managerId ? body.managerId : null;

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return NextResponse.json({ error: "Team not found" }, { status: 400 });
  }
  if (managerId) {
    const manager = await prisma.user.findUnique({ where: { id: managerId } });
    if (!manager) return NextResponse.json({ error: "Manager not found" }, { status: 400 });
  }

  const hashed = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { name, email, password: hashed, role, teamId, managerId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      teamId: true,
      managerId: true,
      team: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(user, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { userId, role, teamId, managerId, excludedFromInsights } = body as {
    userId: string;
    role?: "ADMIN" | "MANAGER" | "MEMBER";
    teamId?: string | null;
    managerId?: string | null;
    excludedFromInsights?: boolean;
  };

  // A user can't report to themselves.
  if (managerId && managerId === userId) {
    return NextResponse.json({ error: "A user cannot be their own manager" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(role && { role }),
      ...(teamId !== undefined && { teamId }),
      ...(managerId !== undefined && { managerId }),
      // Admin-only: hide/show a user in the Insights team view.
      ...(typeof excludedFromInsights === "boolean" && { excludedFromInsights }),
    },
    select: { id: true, name: true, email: true, role: true, teamId: true, managerId: true, excludedFromInsights: true },
  });

  return NextResponse.json(updated);
}
