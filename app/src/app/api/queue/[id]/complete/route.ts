import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { recordStatusChange } from "@/lib/task-events";
import { TAGS_INCLUDE } from "@/lib/task-tags";
import { parseHours } from "../../route";

// POST /api/queue/:id/complete  { completedDate?, actualHours? }
// Mark a backlog item done without planning it into a day first: create a DONE
// DailyTask dated the day it was actually finished (default today, any past day
// up to today), carrying the item's title/estimate/priority plus the effort
// spent, then remove the queue item — atomically. The queue counterpart to the
// overdue "complete as of a date" close-out (PATCH /api/tasks/:id completedDate).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const item = await prisma.queueItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // Day the work was finished. Defaults to today; a backdated value must be a
  // valid calendar day no later than today. Stored at UTC midnight to match @db.Date.
  const today = todayDate();
  let date = today;
  if (body.completedDate !== undefined && body.completedDate !== null && body.completedDate !== "") {
    if (typeof body.completedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.completedDate)) {
      return NextResponse.json({ error: "Date must be in YYYY-MM-DD format." }, { status: 400 });
    }
    const parsed = new Date(`${body.completedDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "That date isn't valid." }, { status: 400 });
    }
    if (parsed.getTime() > today.getTime()) {
      return NextResponse.json({ error: "You can't complete work for a future day." }, { status: 400 });
    }
    date = parsed;
  }

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.dailyTask.create({
      data: {
        userId: item.userId,
        date,
        title: item.title,
        notes: item.notes,
        estimatedHours: item.estimatedHours,
        priority: item.priority,
        status: "DONE",
        completedAt: date,
        actualHours: parseHours(body.actualHours),
      },
      include: TAGS_INCLUDE,
    });
    await recordStatusChange(tx, created.id, created.userId, null, "DONE");
    await tx.queueItem.delete({ where: { id: item.id } });
    return created;
  });

  return NextResponse.json(task, { status: 201 });
}
