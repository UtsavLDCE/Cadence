import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";

function isManager(role: string) {
  return role === "MANAGER" || role === "ADMIN";
}

function parseDate(value: string | null): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  return todayDate();
}

function parseMinutes(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1440) return null;
  return n;
}

// GET /api/time-slots?date=YYYY-MM-DD — the caller's slots for a day.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManager(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const date = parseDate(req.nextUrl.searchParams.get("date"));
  const slots = await prisma.timeSlot.findMany({
    where: { userId: session.user.id, date },
    orderBy: { plannedStart: "asc" },
    include: { task: { select: { id: true, title: true, priority: true, status: true } } },
  });
  return NextResponse.json(slots);
}

// POST /api/time-slots  { taskId, date?, plannedStart, plannedEnd }
// Creates a slot. Overlaps are allowed (surfaced in the UI as a soft warning).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManager(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const start = parseMinutes(body.plannedStart);
  const end = parseMinutes(body.plannedEnd);
  if (start === null || end === null) {
    return NextResponse.json({ error: "Start/end must be minutes 0-1440." }, { status: 400 });
  }
  if (end <= start) {
    return NextResponse.json({ error: "End must be after start." }, { status: 400 });
  }
  if (typeof body.taskId !== "string" || !body.taskId) {
    return NextResponse.json({ error: "Pick a task." }, { status: 400 });
  }

  const task = await prisma.dailyTask.findUnique({
    where: { id: body.taskId },
    select: { id: true, userId: true, date: true },
  });
  if (!task || task.userId !== session.user.id) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const date = typeof body.date === "string" ? parseDate(body.date) : task.date;

  const slot = await prisma.timeSlot.create({
    data: {
      userId: session.user.id,
      date,
      taskId: task.id,
      plannedStart: start,
      plannedEnd: end,
    },
    include: { task: { select: { id: true, title: true, priority: true, status: true } } },
  });
  return NextResponse.json(slot);
}
