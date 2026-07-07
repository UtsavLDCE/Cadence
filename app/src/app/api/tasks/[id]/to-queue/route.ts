import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/tasks/:id/to-queue  -> move an unstarted today task into the backlog queue.
//
// Used at plan-submit time: any task the user unchecks from "today's goal" is
// pushed to their personal queue instead of being committed to the day. The
// DailyTask is deleted and a QueueItem is created from it (title/notes/estimate/
// priority carried), atomically. Only the owner can do this, and only while the
// day's plan is still unlocked — once submitted, the list is frozen and a task
// must be deferred, not silently pulled out.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const existing = await prisma.dailyTask.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The day-plan lock freezes the list — a committed task can only be deferred.
  const plan = await prisma.dayPlan.findUnique({
    where: { userId_date: { userId: existing.userId, date: existing.date } },
  });
  if (plan?.submittedAt) {
    return NextResponse.json(
      { error: "This day's plan is locked. Defer the task instead of moving it to the queue." },
      { status: 403 },
    );
  }

  // New queue items go to the bottom of the backlog.
  const last = await prisma.queueItem.findFirst({
    where: { userId: existing.userId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const [item] = await prisma.$transaction([
    prisma.queueItem.create({
      data: {
        userId: existing.userId,
        title: existing.title,
        notes: existing.notes,
        estimatedHours: existing.estimatedHours,
        priority: existing.priority,
        position: (last?.position ?? -1) + 1,
      },
    }),
    prisma.dailyTask.delete({ where: { id } }),
  ]);

  return NextResponse.json(item, { status: 201 });
}
