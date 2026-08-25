import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

function isManager(role: string) {
  return role === "MANAGER" || role === "ADMIN";
}

function parseMinutes(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1440) return null;
  return n;
}

// PATCH /api/time-slots/:id
//   { plannedStart?, plannedEnd? } — reshape the window.
//   { action: "start" | "stop" | "reset" } — timer control. `start` stamps
//   actualStart=now (only if not already running/finished); `stop` stamps
//   actualEnd=now (only if running); `reset` clears both.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManager(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const existing = await prisma.timeSlot.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const data: Prisma.TimeSlotUpdateInput = {};

  if ("plannedStart" in body || "plannedEnd" in body) {
    const start = "plannedStart" in body ? parseMinutes(body.plannedStart) : existing.plannedStart;
    const end = "plannedEnd" in body ? parseMinutes(body.plannedEnd) : existing.plannedEnd;
    if (start === null || end === null) {
      return NextResponse.json({ error: "Start/end must be minutes 0-1440." }, { status: 400 });
    }
    if (end <= start) {
      return NextResponse.json({ error: "End must be after start." }, { status: 400 });
    }
    data.plannedStart = start;
    data.plannedEnd = end;
  }

  if (body.action === "start") {
    if (existing.actualStart && !existing.actualEnd) {
      return NextResponse.json({ error: "Timer already running." }, { status: 400 });
    }
    data.actualStart = new Date();
    data.actualEnd = null;
  } else if (body.action === "stop") {
    if (!existing.actualStart) {
      return NextResponse.json({ error: "Timer hasn't started." }, { status: 400 });
    }
    data.actualEnd = new Date();
  } else if (body.action === "reset") {
    data.actualStart = null;
    data.actualEnd = null;
  }

  const slot = await prisma.timeSlot.update({
    where: { id },
    data,
    include: { task: { select: { id: true, title: true, priority: true, status: true } } },
  });
  return NextResponse.json(slot);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isManager(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const existing = await prisma.timeSlot.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.timeSlot.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
