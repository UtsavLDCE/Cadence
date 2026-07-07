import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/manager/tasks/:id/reassign  { userId }
// Managers/admins move an existing, still-pending daily task to another member.
// The task keeps its date, estimate, priority, and notes — only the owner
// changes. This is a deliberate override: the target's day-plan lock does not
// block it, so a lead can rebalance pending work across the team at any time.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isManager = session.user.role === "MANAGER" || session.user.role === "ADMIN";
  if (!isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json();
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ error: "A target member is required." }, { status: 400 });

  const [task, target] = await Promise.all([
    prisma.dailyTask.findUnique({ where: { id } }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);

  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (!target) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  // A done task is a record of completed work — reassigning it would distort
  // both people's history. A deferred original is an audit row, not live work.
  if (task.status === "DONE") {
    return NextResponse.json({ error: "A completed task can't be reassigned." }, { status: 400 });
  }
  if (task.deferredToDate) {
    return NextResponse.json({ error: "This task was deferred — reassign its carried-forward copy instead." }, { status: 400 });
  }
  if (task.userId === userId) {
    return NextResponse.json({ error: "Task is already assigned to this member." }, { status: 400 });
  }

  const updated = await prisma.dailyTask.update({
    where: { id },
    data: { userId },
  });
  return NextResponse.json(updated);
}
