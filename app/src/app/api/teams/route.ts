import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teams = await prisma.team.findMany({
    include: {
      manager: { select: { id: true, name: true, email: true } },
      members: { select: { id: true, name: true, email: true, image: true, role: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(teams);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { name, managerId } = body as { name: string; managerId?: string };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }

  const team = await prisma.team.create({
    data: { name: name.trim(), managerId },
    include: {
      manager: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json(team, { status: 201 });
}
