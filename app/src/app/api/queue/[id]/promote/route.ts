import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { TAGS_INCLUDE } from "@/lib/task-tags";

// POST /api/queue/:id/promote  -> moves a backlog item into today's plan.
// Creates a DailyTask dated today (carrying title/estimate/notes) and removes
// the queue item, atomically. Returns the created task.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const item = await prisma.queueItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (item.estimatedHours === null || item.estimatedHours <= 0) {
    return NextResponse.json(
      { error: "Add an effort estimate to this item before moving it into today." },
      { status: 400 }
    );
  }

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.dailyTask.create({
      data: {
        userId: item.userId,
        date: todayDate(),
        title: item.title,
        notes: item.notes,
        estimatedHours: item.estimatedHours,
        priority: item.priority,
      },
      include: TAGS_INCLUDE,
    });
    await tx.queueItem.delete({ where: { id: item.id } });
    return created;
  });

  return NextResponse.json(task, { status: 201 });
}
