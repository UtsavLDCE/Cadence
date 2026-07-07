import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { parseHours, parseNotes } from "../route";
import { parsePriority } from "@/lib/task-status";

// PATCH /api/queue/:id  { title?, estimatedHours?, notes?, priority? }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const existing = await prisma.queueItem.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const data: Prisma.QueueItemUpdateInput = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if ("estimatedHours" in body) {
    const h = parseHours(body.estimatedHours);
    if (h === null || h <= 0) {
      return NextResponse.json({ error: "An effort estimate (in hours) is required." }, { status: 400 });
    }
    data.estimatedHours = h;
  }
  if ("notes" in body) data.notes = parseNotes(body.notes);
  if ("priority" in body) {
    const p = parsePriority(body.priority);
    if (p) data.priority = p;
  }

  const item = await prisma.queueItem.update({ where: { id }, data });
  return NextResponse.json(item);
}

// DELETE /api/queue/:id
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const existing = await prisma.queueItem.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.queueItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
