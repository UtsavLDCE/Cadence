import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { resolveTagIds } from "@/lib/task-tags";

const ROLES = ["ADMIN", "MANAGER", "MEMBER", "CXO"] as const;
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
      tags: { select: { id: true, name: true } },
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
  const { userId, role, teamId, managerId, excludedFromInsights, tagIds, name, email, password } = body as {
    userId: string;
    role?: Role;
    teamId?: string | null;
    managerId?: string | null;
    excludedFromInsights?: boolean;
    tagIds?: string[];
    name?: string;
    email?: string;
    password?: string;
  };

  // A user can't report to themselves.
  if (managerId && managerId === userId) {
    return NextResponse.json({ error: "A user cannot be their own manager" }, { status: 400 });
  }

  // Admin editing identity/credentials. Validate each only when present so
  // unrelated PATCHes (role, tags…) skip these checks.
  const nextName = name !== undefined ? name.trim() : undefined;
  if (nextName !== undefined && !nextName) {
    return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
  }
  const nextEmail = email !== undefined ? email.trim().toLowerCase() : undefined;
  if (nextEmail !== undefined) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    const clash = await prisma.user.findUnique({ where: { email: nextEmail } });
    if (clash && clash.id !== userId) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }
  }
  if (password !== undefined && password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  const hashed = password !== undefined ? await bcrypt.hash(password, 12) : undefined;

  const tags = await resolveTagIds(prisma, tagIds);
  if (!tags.ok) return NextResponse.json({ error: "Unknown tag." }, { status: 400 });

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(role && { role }),
      ...(teamId !== undefined && { teamId }),
      ...(managerId !== undefined && { managerId }),
      ...(nextName !== undefined && { name: nextName }),
      ...(nextEmail !== undefined && { email: nextEmail }),
      ...(hashed !== undefined && { password: hashed }),
      // Admin-only: hide/show a user in the Insights team view.
      ...(typeof excludedFromInsights === "boolean" && { excludedFromInsights }),
      // null ids => tagIds absent => leave tags untouched; array => replace set.
      ...(tags.ids !== null && { tags: { set: tags.ids.map((id) => ({ id })) } }),
    },
    select: { id: true, name: true, email: true, role: true, teamId: true, managerId: true, excludedFromInsights: true, tags: { select: { id: true, name: true } } },
  });

  return NextResponse.json(updated);
}

// DELETE /api/users  { userId }  -> admin hard-deletes a user. Related tasks,
// plans, work logs, standups, etc. cascade; teams they manage have managerId
// set null. An admin can't delete their own account.
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (userId === session.user.id) {
    return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await prisma.user.delete({ where: { id: userId } });
  return NextResponse.json({ ok: true });
}
