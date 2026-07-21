import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import type { Prisma, TaskStatus, DeferralCause } from "@prisma/client";
import { parsePriority } from "@/lib/task-status";
import { recordStatusChange } from "@/lib/task-events";
import { resolveCategoryId } from "@/lib/task-categories";
import { resolveTagIds, tagsSetInput, TAGS_INCLUDE } from "@/lib/task-tags";

const STATUSES = ["TODO", "IN_PROGRESS", "HOLD", "DONE"] as const;
const DEFERRAL_CAUSES = ["INTERRUPTED", "UNDERESTIMATED", "BLOCKED", "DEPRIORITIZED", "OTHER"] as const;

function parseCause(value: unknown): DeferralCause | null {
  return typeof value === "string" && (DEFERRAL_CAUSES as readonly string[]).includes(value)
    ? (value as DeferralCause)
    : null;
}

// Parse a YYYY-MM-DD string into a UTC-midnight Date, matching todayDate() so
// move/defer destinations compare and store on the same calendar basis.
function parseLocalDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

// PATCH /api/tasks/:id  { title?, status?, estimatedHours?, actualHours?, workType?, notes?, date? }
// `date` moves the task to another (future) day. Once the task's day is submitted,
// the plan is locked: only status/notes/actualHours and moving the task are allowed.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const existing = await prisma.dailyTask.findUnique({ where: { id }, include: TAGS_INCLUDE });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();

  // Retroactive close-out: mark a past/overdue task DONE as of a specific day,
  // recording the effort spent. Distinct from the forward move/defer path below
  // (which only accepts future dates) — here the task is re-dated to the day it
  // was actually finished. Allowed on a locked day, since completing and logging
  // effort aren't plan-changing. Bounded to [planned day, today] so a task can't
  // be completed before it existed or in the future.
  if (body.status === "DONE" && body.completedDate !== undefined) {
    const done = parseLocalDate(body.completedDate);
    if (!done) {
      return NextResponse.json({ error: "Provide a valid completion date (YYYY-MM-DD)." }, { status: 400 });
    }
    if (done.getTime() > todayDate().getTime()) {
      return NextResponse.json({ error: "You can't complete a task on a future day." }, { status: 400 });
    }
    if (done.getTime() < existing.date.getTime()) {
      return NextResponse.json({ error: "The completion date can't be before the task's planned day." }, { status: 400 });
    }
    const updated = await prisma.dailyTask.update({
      where: { id },
      data: { status: "DONE", completedAt: done, date: done, actualHours: parseHours(body.actualHours) },
      include: TAGS_INCLUDE,
    });
    await recordStatusChange(prisma, id, existing.userId, existing.status, "DONE");
    return NextResponse.json(updated);
  }

  // Is the task's current day locked? (plan submitted)
  const plan = await prisma.dayPlan.findUnique({
    where: { userId_date: { userId: session.user.id, date: existing.date } },
  });
  const locked = Boolean(plan?.submittedAt);

  // When locked, only status/notes/actualHours and moving (date) are allowed.
  if (locked && ("title" in body || "estimatedHours" in body || "workType" in body)) {
    return NextResponse.json(
      { error: "This day's plan is locked. You can only update status, notes, or effort, or move the task to another day." },
      { status: 403 },
    );
  }

  const data: Prisma.DailyTaskUpdateInput = {};

  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if ("notes" in body) {
    const n = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";
    data.notes = n === "" ? null : n;
  }
  if (body.workType === "FOCUS" || body.workType === "INTERRUPTION") data.workType = body.workType;
  if ("estimatedHours" in body) {
    const h = parseHours(body.estimatedHours);
    if (h === null || h <= 0) {
      return NextResponse.json({ error: "An effort estimate (in hours) is required." }, { status: 400 });
    }
    data.estimatedHours = h;
  }
  if ("actualHours" in body) data.actualHours = parseHours(body.actualHours);
  if ("priority" in body) {
    const p = parsePriority(body.priority);
    if (p) data.priority = p;
  }
  // Category is metadata (like notes/status), so it can be set even on a locked day.
  if ("categoryId" in body) {
    const category = await resolveCategoryId(prisma, body.categoryId);
    if (!category.ok) return NextResponse.json({ error: "Unknown category." }, { status: 400 });
    data.category = category.id ? { connect: { id: category.id } } : { disconnect: true };
  }
  // Tags are metadata too — editable on a locked day. `set` replaces the full list.
  if ("tagIds" in body) {
    const tags = await resolveTagIds(prisma, body.tagIds);
    if (!tags.ok) return NextResponse.json({ error: "Unknown tag." }, { status: 400 });
    data.tags = tagsSetInput(tags.ids);
  }

  if (body.status && STATUSES.includes(body.status)) {
    data.status = body.status as TaskStatus;
    data.completedAt = body.status === "DONE" ? new Date() : null;
  }

  // Move to another day — future dates only.
  if ("date" in body) {
    const dest = parseLocalDate(body.date);
    if (!dest) {
      return NextResponse.json({ error: "Provide a valid date (YYYY-MM-DD)." }, { status: 400 });
    }
    if (dest.getTime() <= todayDate().getTime()) {
      return NextResponse.json({ error: "Pick a future date to move this task to." }, { status: 400 });
    }

    // After the plan is submitted, moving an unfinished task is a *deferral*: it
    // must carry a justification, the original row stays on its planned day
    // marked deferred (preserving the planned-vs-achieved record), and a fresh
    // copy carries to the target day.
    if (locked) {
      if (existing.status === "DONE") {
        return NextResponse.json(
          { error: "This task is already done — it can't be deferred." },
          { status: 400 },
        );
      }
      const cause = parseCause(body.deferralCause);
      if (!cause) {
        return NextResponse.json(
          { error: "Pick a reason for deferring this task to another day." },
          { status: 400 },
        );
      }
      const rawNote = typeof body.deferralNote === "string" ? body.deferralNote.trim().slice(0, 500) : "";
      const note = rawNote === "" ? null : rawNote;

      const [original, created] = await prisma.$transaction([
        prisma.dailyTask.update({
          where: { id },
          data: { deferredToDate: dest, deferralCause: cause, deferralNote: note },
          include: TAGS_INCLUDE,
        }),
        prisma.dailyTask.create({
          data: {
            userId: existing.userId,
            date: dest,
            title: existing.title,
            notes: existing.notes,
            estimatedHours: existing.estimatedHours,
            workType: existing.workType,
            priority: existing.priority,
            categoryId: existing.categoryId,
            // Carry the same tags onto the deferred copy so labels survive the move.
            tags: existing.tags.length ? { connect: existing.tags.map((t) => ({ id: t.id })) } : undefined,
            deferredFromDate: existing.date,
          },
          include: TAGS_INCLUDE,
        }),
      ]);
      // The carry-forward copy starts fresh at its default status.
      await recordStatusChange(prisma, created.id, created.userId, null, created.status);
      return NextResponse.json({ original, created });
    }

    data.date = dest;
  }

  const task = await prisma.dailyTask.update({ where: { id }, data, include: TAGS_INCLUDE });
  if (data.status !== undefined) {
    await recordStatusChange(prisma, task.id, existing.userId, existing.status, task.status, {
      note: body.holdReason,
      blockedOn: body.blockedOn,
    });
  }
  return NextResponse.json(task);
}

// DELETE /api/tasks/:id
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const existing = await prisma.dailyTask.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete is allowed for the task's owner (its creator) or any manager/admin.
  const isManager = session.user.role === "MANAGER" || session.user.role === "ADMIN";
  const isOwner = existing.userId === session.user.id;
  if (!isOwner && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The day-plan lock stops a member from pruning their own committed plan — they
  // must defer instead. Managers/admins bypass it (same override posture as
  // reassign and manager-side task creation), so a lead can always remove a task.
  if (!isManager) {
    const plan = await prisma.dayPlan.findUnique({
      where: { userId_date: { userId: existing.userId, date: existing.date } },
    });
    if (plan?.submittedAt) {
      return NextResponse.json(
        { error: "This day's plan is locked. Tasks can no longer be removed." },
        { status: 403 },
      );
    }
  }

  await prisma.dailyTask.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

function parseHours(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
