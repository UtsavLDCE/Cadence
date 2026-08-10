import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePriority } from "@/lib/task-status";
import { hourLimits } from "@/lib/limits";

function parseHours(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// PATCH /api/recurring/:id — update a recurring task template
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.recurringTask.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if ("estimatedHours" in body) {
    const h = parseHours(body.estimatedHours);
    if (h === null || h <= 0) return NextResponse.json({ error: "Estimate must be > 0" }, { status: 400 });
    const { maxTaskHours } = await hourLimits();
    if (h > maxTaskHours) return NextResponse.json({ error: `Max ${maxTaskHours}h per task` }, { status: 400 });
    data.estimatedHours = h;
  }
  if ("priority" in body) {
    const p = parsePriority(body.priority);
    if (p) data.priority = p;
  }
  if ("categoryId" in body) data.categoryId = typeof body.categoryId === "string" ? body.categoryId : null;
  if ("active" in body) data.active = Boolean(body.active);
  if ("daysOfWeek" in body && typeof body.daysOfWeek === "number" && body.daysOfWeek >= 0 && body.daysOfWeek <= 127) {
    data.daysOfWeek = body.daysOfWeek;
  }

  const updated = await prisma.recurringTask.update({
    where: { id },
    data,
    include: { category: { select: { id: true, name: true } } },
  });
  return NextResponse.json(updated);
}

// DELETE /api/recurring/:id — remove a recurring task template
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.recurringTask.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.recurringTask.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
