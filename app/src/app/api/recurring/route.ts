import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePriority } from "@/lib/task-status";
import { hourLimits } from "@/lib/limits";

function parseHours(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// GET /api/recurring — list caller's recurring task templates
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await prisma.recurringTask.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    include: { category: { select: { id: true, name: true } } },
  });
  return NextResponse.json(items);
}

// POST /api/recurring — create a recurring task template
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const estimatedHours = parseHours(body.estimatedHours);
  if (estimatedHours === null || estimatedHours <= 0) {
    return NextResponse.json({ error: "Estimate is required" }, { status: 400 });
  }
  const { maxTaskHours } = await hourLimits();
  if (estimatedHours > maxTaskHours) {
    return NextResponse.json({ error: `Max ${maxTaskHours}h per task` }, { status: 400 });
  }

  const daysOfWeek = typeof body.daysOfWeek === "number" && body.daysOfWeek >= 0 && body.daysOfWeek <= 127
    ? body.daysOfWeek
    : 62;

  const item = await prisma.recurringTask.create({
    data: {
      userId: session.user.id,
      title,
      estimatedHours,
      priority: parsePriority(body.priority) ?? "MEDIUM",
      categoryId: typeof body.categoryId === "string" ? body.categoryId : null,
      daysOfWeek,
    },
    include: { category: { select: { id: true, name: true } } },
  });
  return NextResponse.json(item, { status: 201 });
}
