import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import {
  authorizeTeamsRequest,
  getTeamsConfig,
  parseMorningTasks,
  parseEodUpdates,
} from "@/lib/integrations/teams";
import type { Prisma } from "@prisma/client";
import { recordStatusChange } from "@/lib/task-events";

// POST /api/integrations/teams/ingest
// Power Automate forwards a member's Adaptive Card reply here (Bearer
// TEAMS_SHARED_SECRET). The member is matched to a portal user by email.
//   morning -> sets the day's goal, creates the planned tasks with estimates,
//              and submits/locks the plan (same effect as "Submit plan" in-app).
//   eod     -> applies status / actual-hours / notes to today's tasks.
// Both stamp the matching TeamsPrompt.respondedAt and are idempotent on retry.
export async function POST(req: NextRequest) {
  const cfg = await getTeamsConfig();
  if (!authorizeTeamsRequest(req, cfg.sharedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const phaseRaw = body.phase;
  const phase = phaseRaw === "morning" ? "MORNING" : phaseRaw === "eod" ? "EOD" : null;
  if (!phase) {
    return NextResponse.json({ error: "phase must be 'morning' or 'eod'" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ error: `No portal user for ${email}` }, { status: 404 });
  }

  const today = todayDate();
  const userId = user.id;

  // Reuse an existing prompt row (the cron created one when it sent the card) or
  // make one — a member may reply even if dispatch didn't record it.
  const prompt = await prisma.teamsPrompt.upsert({
    where: { userId_date_phase: { userId, date: today, phase } },
    update: {},
    create: { userId, date: today, phase },
  });

  if (phase === "MORNING") {
    // Idempotent: a second submission of the morning card is ignored rather than
    // duplicating tasks or re-locking.
    if (prompt.respondedAt) {
      return NextResponse.json({ ok: true, idempotent: true, phase: "morning" });
    }

    const rawGoal = typeof body.goal === "string" ? body.goal.trim().slice(0, 500) : "";
    const goal = rawGoal === "" ? null : rawGoal;
    const tasks = parseMorningTasks(body);

    await prisma.$transaction([
      prisma.dayPlan.upsert({
        where: { userId_date: { userId, date: today } },
        update: { goal, submittedAt: new Date() },
        create: { userId, date: today, goal, submittedAt: new Date() },
      }),
      ...tasks.map((t) =>
        prisma.dailyTask.create({
          data: {
            userId,
            date: today,
            title: t.title,
            estimatedHours: t.estimatedHours,
          },
        }),
      ),
      prisma.teamsPrompt.update({
        where: { id: prompt.id },
        data: { respondedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ ok: true, phase: "morning", goalSet: goal != null, tasksCreated: tasks.length });
  }

  // EOD: apply status / actual hours / notes to the member's own tasks for today.
  const updates = parseEodUpdates(body);
  const owned = await prisma.dailyTask.findMany({
    where: { userId, date: today },
    select: { id: true, status: true },
  });
  const ownedById = new Map(owned.map((t) => [t.id, t]));

  let applied = 0;
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const u of updates) {
    const current = ownedById.get(u.taskId);
    if (!current) continue; // ignore ids that aren't this user's today-tasks
    const data: Prisma.DailyTaskUpdateInput = {};
    if (u.status) {
      data.status = u.status;
      data.completedAt = u.status === "DONE" ? new Date() : null;
    }
    if (u.actualHours !== undefined) data.actualHours = u.actualHours;
    if (u.notes !== undefined) data.notes = u.notes;
    if (Object.keys(data).length === 0) continue;
    ops.push(prisma.dailyTask.update({ where: { id: u.taskId }, data }));
    if (u.status) {
      const ev = recordStatusChange(prisma, u.taskId, userId, current.status, u.status);
      if (ev) ops.push(ev as Prisma.PrismaPromise<unknown>);
    }
    applied++;
  }
  ops.push(
    prisma.teamsPrompt.update({ where: { id: prompt.id }, data: { respondedAt: new Date() } }),
  );
  await prisma.$transaction(ops);

  return NextResponse.json({ ok: true, phase: "eod", tasksUpdated: applied });
}
