import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePriority } from "@/lib/task-status";
import { resolveCategoryId } from "@/lib/task-categories";

// GET /api/invites — pending shared-work offers addressed to the caller.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invites = await prisma.taskInvite.findMany({
    where: { toUserId: session.user.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { fromUser: { select: { id: true, name: true, email: true } } },
  });
  return NextResponse.json(invites);
}

// POST /api/invites  { toUserIds: string[], title, notes?, estimatedHours?,
//   actualHours?, priority?, categoryId?, wasDone?, sourceTaskId? }
//   -> creates one PENDING invite per recipient. The receiver accepts to get a
//   copy on their own day; declines to drop it. Fields are snapshotted so the
//   offer stays stable if the sender later edits their source task.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const rawIds: unknown = body.toUserIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: "Pick at least one person to share with." }, { status: 400 });
  }
  // Dedupe, drop non-strings and self (you can't invite yourself).
  const wanted = [...new Set(rawIds.filter((x): x is string => typeof x === "string" && x !== ""))]
    .filter((id) => id !== session.user.id);
  if (wanted.length === 0) {
    return NextResponse.json({ error: "Pick at least one person to share with." }, { status: 400 });
  }

  // Only invite users that actually exist — silently drop unknown ids.
  const existing = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true } });
  const toUserIds = existing.map((u) => u.id);
  if (toUserIds.length === 0) {
    return NextResponse.json({ error: "None of the selected people were found." }, { status: 400 });
  }

  const category = await resolveCategoryId(prisma, body.categoryId);
  if (!category.ok) return NextResponse.json({ error: "Unknown category." }, { status: 400 });

  const priority = parsePriority(body.priority) ?? "MEDIUM";
  const wasDone = body.wasDone === true;
  const sourceTaskId = typeof body.sourceTaskId === "string" && body.sourceTaskId ? body.sourceTaskId : null;

  await prisma.taskInvite.createMany({
    data: toUserIds.map((toUserId) => ({
      fromUserId: session.user.id,
      toUserId,
      sourceTaskId,
      title,
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
      estimatedHours: parseHours(body.estimatedHours),
      actualHours: parseHours(body.actualHours),
      priority,
      categoryId: category.id,
      wasDone,
    })),
  });

  return NextResponse.json({ created: toUserIds.length }, { status: 201 });
}

function parseHours(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
