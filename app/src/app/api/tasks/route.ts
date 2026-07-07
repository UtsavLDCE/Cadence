import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { parsePriority } from "@/lib/task-status";
import { recordStatusChange } from "@/lib/task-events";
import { resolveCategoryId } from "@/lib/task-categories";
import { resolveTagIds, tagsConnectInput, TAGS_INCLUDE } from "@/lib/task-tags";
import { parseNotes } from "../queue/route";

// GET /api/tasks?date=YYYY-MM-DD&userId=...&scope=overdue
// - default: caller's tasks for the given date (today if omitted)
// - scope=overdue: caller's non-DONE tasks dated before today
// - managers/admins may pass userId to read another user's tasks
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const userIdParam = searchParams.get("userId");
  const scope = searchParams.get("scope");
  const isManagerView = session.user.role === "MANAGER" || session.user.role === "ADMIN";

  if (userIdParam && userIdParam !== session.user.id && !isManagerView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = userIdParam || session.user.id;

  if (scope === "overdue") {
    // Exclude tasks already deferred forward — they live on as a copy on their
    // new day, so counting the marked original too would double-count.
    const tasks = await prisma.dailyTask.findMany({
      where: { userId, status: { not: "DONE" }, date: { lt: todayDate() }, deferredToDate: null },
      orderBy: { date: "asc" },
      include: TAGS_INCLUDE,
    });
    return NextResponse.json(tasks);
  }

  const date = dateParam ? new Date(dateParam) : todayDate();
  const tasks = await prisma.dailyTask.findMany({
    where: { userId, date },
    orderBy: { createdAt: "asc" },
    include: TAGS_INCLUDE,
  });
  return NextResponse.json(tasks);
}

// POST /api/tasks  { title, estimatedHours?, actualHours?, status?, workType?, date? }
//   -> creates a task for today (or a past day when logging done work).
// Two modes:
//   - Planning a task (default): an effort estimate is required, the day's plan
//     must still be open, and it always lands on today.
//   - Logging unplanned work that already happened (status:"DONE"): no estimate
//     required, allowed even after the plan is locked, and it may be backdated to
//     a past day via `date` — this is how an interruption that came up mid-day,
//     or unplanned work missed on an earlier day, gets onto the record.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const asDone = body.status === "DONE";

  const estimatedHours = parseHours(body.estimatedHours);
  // A planned task must be scoped up front; unplanned done work needn't be.
  if (!asDone && (estimatedHours === null || estimatedHours <= 0)) {
    return NextResponse.json({ error: "An effort estimate (in hours) is required." }, { status: 400 });
  }
  const workType = body.workType === "INTERRUPTION" ? "INTERRUPTION" : "FOCUS";
  // Explicit unplanned marker (set by the ⚡ log-unplanned-work path). This is
  // the honest firefighting signal — independent of workType.
  const unplanned = body.unplanned === true;

  const category = await resolveCategoryId(prisma, body.categoryId);
  if (!category.ok) return NextResponse.json({ error: "Unknown category." }, { status: 400 });

  const tags = await resolveTagIds(prisma, body.tagIds);
  if (!tags.ok) return NextResponse.json({ error: "Unknown tag." }, { status: 400 });

  const today = todayDate();

  // Optional backdating: logging work that already happened on an earlier day.
  // Only allowed for already-done work — you can't pre-plan the past, and planned
  // tasks stay bound to today so the day-lock semantics hold. The date must be a
  // real calendar day, today or earlier (no future work). Stored at UTC midnight
  // to match the @db.Date column.
  let date = today;
  let completedAt: Date | null = asDone ? new Date() : null;
  if (body.date !== undefined && body.date !== null && body.date !== "") {
    if (!asDone) {
      return NextResponse.json({ error: "Only completed work can be logged to a past day." }, { status: 400 });
    }
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "Date must be in YYYY-MM-DD format." }, { status: 400 });
    }
    const parsed = new Date(`${body.date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "That date isn't valid." }, { status: 400 });
    }
    if (parsed.getTime() > today.getTime()) {
      return NextResponse.json({ error: "You can't log work for a future day." }, { status: 400 });
    }
    date = parsed;
    // Stamp completion on the day it actually happened, not now, so completion
    // timing lands on the correct day.
    if (parsed.getTime() !== today.getTime()) completedAt = parsed;
  }

  // Once the day's plan is submitted it's locked — no new *planned* tasks. But
  // unplanned work that's already done can still be logged, so the day's record
  // reflects what actually happened.
  const plan = await prisma.dayPlan.findUnique({
    where: { userId_date: { userId: session.user.id, date: today } },
  });
  if (plan?.submittedAt && !asDone) {
    return NextResponse.json(
      { error: "Today's plan is submitted. You can't add new tasks." },
      { status: 403 },
    );
  }

  const task = await prisma.dailyTask.create({
    data: {
      userId: session.user.id,
      date,
      title,
      notes: parseNotes(body.notes),
      estimatedHours,
      actualHours: asDone ? parseHours(body.actualHours) : null,
      status: asDone ? "DONE" : "TODO",
      completedAt,
      workType,
      unplanned,
      priority: parsePriority(body.priority) ?? "MEDIUM",
      categoryId: category.id,
      tags: tagsConnectInput(tags.ids),
    },
    include: TAGS_INCLUDE,
  });
  await recordStatusChange(prisma, task.id, task.userId, null, task.status);
  return NextResponse.json(task, { status: 201 });
}

function parseHours(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
