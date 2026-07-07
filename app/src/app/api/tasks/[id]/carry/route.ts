import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { TAGS_INCLUDE, tagsConnectInput } from "@/lib/task-tags";

// POST /api/tasks/:id/carry  -> bring an overdue task into today's plan.
//
// The task must be overdue: owned by the caller, dated before today, not done,
// and not already deferred forward. It can't be added once today's plan is
// locked (submitted).
//
// If the task's original day was locked (submitted), bringing it forward is a
// deferral: the original row stays on its planned day marked deferred → today
// (preserving that day's planned-vs-achieved record) and a fresh copy lands on
// today. If the original day was never locked, the task simply moves to today.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const today = todayDate();

  const existing = await prisma.dailyTask.findUnique({
    where: { id },
    include: { tags: { select: { id: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Must be a genuine overdue task.
  if (
    existing.status === "DONE" ||
    existing.deferredToDate !== null ||
    existing.date.getTime() >= today.getTime()
  ) {
    return NextResponse.json(
      { error: "Only an unfinished task from an earlier day can be brought forward." },
      { status: 400 },
    );
  }

  // Can't add to today once today's plan is locked.
  const todayPlan = await prisma.dayPlan.findUnique({
    where: { userId_date: { userId: session.user.id, date: today } },
  });
  if (todayPlan?.submittedAt) {
    return NextResponse.json(
      { error: "Today's goal is already submitted and locked — you can't add more tasks." },
      { status: 400 },
    );
  }

  // Was the task's original day locked? If so, preserve its record and copy forward.
  const originPlan = await prisma.dayPlan.findUnique({
    where: { userId_date: { userId: session.user.id, date: existing.date } },
  });

  if (originPlan?.submittedAt) {
    const [, created] = await prisma.$transaction([
      prisma.dailyTask.update({
        where: { id },
        data: { deferredToDate: today, deferralCause: "DEPRIORITIZED", deferralNote: "Carried forward to today." },
      }),
      prisma.dailyTask.create({
        data: {
          userId: existing.userId,
          date: today,
          title: existing.title,
          notes: existing.notes,
          estimatedHours: existing.estimatedHours,
          workType: existing.workType,
          priority: existing.priority,
          categoryId: existing.categoryId,
          deferredFromDate: existing.date,
          tags: tagsConnectInput(existing.tags.map((t) => t.id)),
        },
        include: TAGS_INCLUDE,
      }),
    ]);
    return NextResponse.json(created, { status: 201 });
  }

  // Original day was never locked — just move it onto today.
  const moved = await prisma.dailyTask.update({
    where: { id },
    data: { date: today },
    include: TAGS_INCLUDE,
  });
  return NextResponse.json(moved, { status: 200 });
}
