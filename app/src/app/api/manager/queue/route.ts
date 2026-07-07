import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePriority } from "@/lib/task-status";
import { parseHours, parseNotes } from "../../queue/route";

// POST /api/manager/queue  { userId, title, estimatedHours?, priority?, notes? }
// Managers/admins assign a task into a member's personal queue. It lands at the
// bottom of that member's backlog, stamped with the assigner's id so the member
// can see it came from a lead. The member promotes it into a day when ready;
// priority carries through to the day task so they can plan around it.
//
// The estimate is OPTIONAL here — a lead may not know the effort. The member
// must supply one before the item can be promoted into today's goal (enforced
// in /api/queue/:id/promote), so every task in a day's plan still has an estimate.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isManager = session.user.role === "MANAGER" || session.user.role === "ADMIN";
  if (!isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();

  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ error: "A member is required." }, { status: 400 });

  const member = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  // Estimate is optional on assignment, but if one is given it must be positive.
  let estimatedHours: number | null = null;
  if (body.estimatedHours !== undefined && body.estimatedHours !== null && body.estimatedHours !== "") {
    const h = parseHours(body.estimatedHours);
    if (h === null || h <= 0) {
      return NextResponse.json({ error: "If you set an estimate, it must be a positive number of hours." }, { status: 400 });
    }
    estimatedHours = h;
  }

  // New items go to the bottom of the member's backlog.
  const last = await prisma.queueItem.findFirst({
    where: { userId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const item = await prisma.queueItem.create({
    data: {
      userId,
      title,
      estimatedHours,
      notes: parseNotes(body.notes),
      priority: parsePriority(body.priority) ?? "MEDIUM",
      assignedById: session.user.id,
      position: (last?.position ?? -1) + 1,
    },
  });

  return NextResponse.json(item, { status: 201 });
}
