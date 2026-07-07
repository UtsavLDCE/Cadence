import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePriority } from "@/lib/task-status";

// GET /api/queue  -> caller's personal backlog (future work), ordered by position
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await prisma.queueItem.findMany({
    where: { userId: session.user.id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(items);
}

// POST /api/queue  { title, estimatedHours?, notes? }  -> adds an item to the backlog
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const estimatedHours = parseHours(body.estimatedHours);
  if (estimatedHours === null || estimatedHours <= 0) {
    return NextResponse.json({ error: "An effort estimate (in hours) is required." }, { status: 400 });
  }

  // New items go to the bottom of the backlog.
  const last = await prisma.queueItem.findFirst({
    where: { userId: session.user.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const item = await prisma.queueItem.create({
    data: {
      userId: session.user.id,
      title,
      estimatedHours,
      notes: parseNotes(body.notes),
      priority: parsePriority(body.priority) ?? "MEDIUM",
      position: (last?.position ?? -1) + 1,
    },
  });
  return NextResponse.json(item, { status: 201 });
}

export function parseHours(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function parseNotes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 2000);
  return trimmed === "" ? null : trimmed;
}
