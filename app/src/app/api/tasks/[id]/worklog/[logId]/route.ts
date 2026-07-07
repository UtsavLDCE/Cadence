import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recomputeActualHours } from "@/lib/worklog";

// DELETE /api/tasks/:id/worklog/:logId -> remove a work-log entry and re-sum
// actualHours. Owner-only. Removing the last entry clears actualHours back to null.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; logId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, logId } = await ctx.params;
  const entry = await prisma.workLog.findUnique({ where: { id: logId } });
  if (!entry || entry.taskId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (entry.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actualHours = await prisma.$transaction(async (tx) => {
    await tx.workLog.delete({ where: { id: logId } });
    return recomputeActualHours(tx, id);
  });

  return NextResponse.json({ ok: true, actualHours });
}
