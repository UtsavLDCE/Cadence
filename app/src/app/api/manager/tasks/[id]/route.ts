import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma, TaskStatus } from "@prisma/client";
import { parsePriority } from "@/lib/task-status";
import { recordStatusChange } from "@/lib/task-events";
import { resolveCategoryId } from "@/lib/task-categories";
import { resolveTagIds, tagsSetInput, TAGS_INCLUDE } from "@/lib/task-tags";

const STATUSES = ["TODO", "IN_PROGRESS", "HOLD", "DONE"] as const;

function parseHours(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// PATCH /api/manager/tasks/:id  { title?, notes?, priority?, estimatedHours?, actualHours?, status? }
// Managers/admins edit the details of any member's task from the Task List. This
// is a deliberate override: it bypasses the member's day-plan lock (same posture
// as create/reassign), so a lead can correct a title, flesh out the description,
// re-prioritise, or fix an estimate at any time. Owner changes go through the
// reassign endpoint; day moves/deferrals stay on the member's own page.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isManager = session.user.role === "MANAGER" || session.user.role === "ADMIN";
  if (!isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const existing = await prisma.dailyTask.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, deferredToDate: true, user: { select: { role: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  // The Task List only shows MEMBER-owned tasks; refuse to edit anything else so
  // the surface stays consistent with what a manager can actually see.
  if (existing.user.role !== "MEMBER") {
    return NextResponse.json({ error: "Only team members' tasks can be edited here." }, { status: 400 });
  }
  // A deferred original is an immutable audit row — its carried-forward copy is
  // the live task to edit.
  if (existing.deferredToDate) {
    return NextResponse.json({ error: "This task was deferred — edit its carried-forward copy instead." }, { status: 400 });
  }

  const body = await req.json();
  const data: Prisma.DailyTaskUpdateInput = {};

  if ("title" in body) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (!t) return NextResponse.json({ error: "Title can't be empty." }, { status: 400 });
    data.title = t;
  }
  if ("notes" in body) {
    const n = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";
    data.notes = n === "" ? null : n;
  }
  if ("priority" in body) {
    const p = parsePriority(body.priority);
    if (!p) return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
    data.priority = p;
  }
  if ("estimatedHours" in body) {
    const h = parseHours(body.estimatedHours);
    if (body.estimatedHours !== null && body.estimatedHours !== "" && (h === null || h <= 0)) {
      return NextResponse.json({ error: "If you set an estimate, it must be a positive number of hours." }, { status: 400 });
    }
    data.estimatedHours = h;
  }
  if ("actualHours" in body) {
    data.actualHours = parseHours(body.actualHours);
  }
  if ("categoryId" in body) {
    const category = await resolveCategoryId(prisma, body.categoryId);
    if (!category.ok) return NextResponse.json({ error: "Unknown category." }, { status: 400 });
    data.category = category.id ? { connect: { id: category.id } } : { disconnect: true };
  }
  if ("tagIds" in body) {
    const tags = await resolveTagIds(prisma, body.tagIds);
    if (!tags.ok) return NextResponse.json({ error: "Unknown tag." }, { status: 400 });
    data.tags = tagsSetInput(tags.ids);
  }
  if ("status" in body) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    data.status = body.status as TaskStatus;
    data.completedAt = body.status === "DONE" ? new Date() : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const task = await prisma.dailyTask.update({ where: { id }, data, include: TAGS_INCLUDE });
  if ("status" in body) {
    await recordStatusChange(prisma, task.id, existing.userId, existing.status, task.status, {
      note: body.holdReason,
      blockedOn: body.blockedOn,
    });
  }
  return NextResponse.json(task);
}
