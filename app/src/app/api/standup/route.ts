import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const userId = searchParams.get("userId");
  const isManagerView = session.user.role === "MANAGER" || session.user.role === "ADMIN";

  const targetDate = date ? new Date(date) : todayDate();

  if (userId && !isManagerView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const whereClause = userId
    ? { userId, date: targetDate }
    : isManagerView
    ? { date: targetDate }
    : { userId: session.user.id, date: targetDate };

  const standups = await prisma.standup.findMany({
    where: whereClause,
    include: {
      items: { orderBy: { createdAt: "asc" } },
      user: { select: { id: true, name: true, email: true, image: true, teamId: true, team: { select: { name: true } } } },
    },
    orderBy: { submittedAt: "asc" },
  });

  return NextResponse.json(standups);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { items } = body as {
    items: { type: "YESTERDAY" | "TODAY" | "BLOCKER"; workType: "FOCUS" | "INTERRUPTION"; text: string }[];
  };

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Items are required" }, { status: 400 });
  }

  const today = todayDate();

  const standup = await prisma.standup.upsert({
    where: { userId_date: { userId: session.user.id, date: today } },
    update: {
      submittedAt: new Date(),
      items: {
        deleteMany: {},
        create: items,
      },
    },
    create: {
      userId: session.user.id,
      date: today,
      items: { create: items },
    },
    include: { items: true },
  });

  return NextResponse.json(standup);
}
