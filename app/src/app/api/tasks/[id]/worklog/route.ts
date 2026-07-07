import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { recomputeActualHours, parseLogHours } from "@/lib/worklog";

// GET /api/tasks/:id/worklog -> the task's work-log entries, newest-worked first.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const task = await prisma.dailyTask.findUnique({ where: { id }, select: { userId: true } });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (task.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const entries = await prisma.workLog.findMany({
    where: { taskId: id },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(entries);
}

// POST /api/tasks/:id/worklog  { hours, note?, date? }
//   -> append a dated time-entry to the task and re-sum actualHours.
//
// Logging effort is time-tracking, not plan-changing, so it's allowed even after
// the day's plan is locked (unlike adding/removing tasks). `date` is the day the
// work happened; it defaults to today and may be backdated to any day up to today
// (you can't log future work), letting a multi-day task accrue hours per day.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const task = await prisma.dailyTask.findUnique({ where: { id }, select: { userId: true } });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (task.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();

  const hours = parseLogHours(body.hours);
  if (hours === null) {
    return NextResponse.json(
      { error: "Enter the hours worked (a positive number up to 24)." },
      { status: 400 },
    );
  }

  const rawNote = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const note = rawNote === "" ? null : rawNote;

  // Date the work happened. Defaults to today; a backdated entry must be a valid
  // calendar day no later than today. Stored at UTC midnight to match @db.Date.
  const today = todayDate();
  let date = today;
  if (body.date !== undefined && body.date !== null && body.date !== "") {
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "Date must be in YYYY-MM-DD format." }, { status: 400 });
    }
    const parsed = new Date(`${body.date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "That date isn't valid." }, { status: 400 });
    }
    if (parsed.getTime() > today.getTime()) {
      return NextResponse.json({ error: "You can't log work for a future day." }, { status: 400 });
    }
    date = parsed;
  }

  const { entry, actualHours } = await prisma.$transaction(async (tx) => {
    const entry = await tx.workLog.create({
      data: { taskId: id, userId: session.user.id, date, hours, note },
    });
    const actualHours = await recomputeActualHours(tx, id);
    return { entry, actualHours };
  });

  return NextResponse.json({ entry, actualHours }, { status: 201 });
}
