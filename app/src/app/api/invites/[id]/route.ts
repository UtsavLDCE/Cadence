import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { recordStatusChange } from "@/lib/task-events";
import { TAGS_INCLUDE } from "@/lib/task-tags";

// PATCH /api/invites/:id  { action: "accept" | "decline" }
//   accept  -> creates a DailyTask on the caller's today mirroring the offer, and
//              marks the invite ACCEPTED. Accepted work is always flagged unplanned:
//              it wasn't on the receiver's own plan, so it's honest off-plan work
//              and bypasses the day-lock (same as the ⚡ unplanned path).
//   decline -> marks the invite DECLINED; nothing is created.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const action = body.action;
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ error: "action must be 'accept' or 'decline'." }, { status: 400 });
  }

  const invite = await prisma.taskInvite.findUnique({ where: { id } });
  if (!invite) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invite.toUserId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (invite.status !== "PENDING") {
    return NextResponse.json({ error: "This invite has already been handled." }, { status: 409 });
  }

  if (action === "decline") {
    await prisma.taskInvite.update({ where: { id }, data: { status: "DECLINED" } });
    return NextResponse.json({ status: "DECLINED" });
  }

  // Accept — create the task on today and link it back on the invite.
  const today = todayDate();
  const task = await prisma.dailyTask.create({
    data: {
      userId: session.user.id,
      date: today,
      title: invite.title,
      notes: invite.notes,
      estimatedHours: invite.estimatedHours,
      actualHours: invite.wasDone ? invite.actualHours : null,
      status: invite.wasDone ? "DONE" : "TODO",
      completedAt: invite.wasDone ? new Date() : null,
      unplanned: true,
      priority: invite.priority,
      categoryId: invite.categoryId,
    },
    include: TAGS_INCLUDE,
  });
  await recordStatusChange(prisma, task.id, task.userId, null, task.status);
  await prisma.taskInvite.update({
    where: { id },
    data: { status: "ACCEPTED", acceptedTaskId: task.id },
  });

  return NextResponse.json(task, { status: 201 });
}
