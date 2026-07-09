import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { cutoffTime, timezone } = body as { cutoffTime?: string; timezone?: string };

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {
      ...(cutoffTime && { cutoffTime }),
      ...(timezone && { timezone }),
    },
    create: { id: "singleton" },
  });

  return NextResponse.json(settings);
}
