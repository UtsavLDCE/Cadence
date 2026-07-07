import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate, formatDate } from "@/lib/utils";
import {
  authorizeTeamsRequest,
  getTeamsConfig,
  postToFlow,
  buildMorningCard,
  buildEodCard,
  type EodCardTask,
} from "@/lib/integrations/teams";
import type { PromptPhase } from "@prisma/client";

// POST /api/integrations/teams/dispatch?phase=morning|eod
// Pushes the day's Teams prompt to every member. Called by the weekday cron
// (Bearer TEAMS_SHARED_SECRET) or manually by an ADMIN from the portal. Idempotent
// per (user, day, phase): a member already prompted for this phase today is
// skipped, so re-running the cron — or clicking "Send now" twice — won't double-post.
export async function POST(req: NextRequest) {
  const phaseParam = new URL(req.url).searchParams.get("phase");
  const phase = phaseParam === "morning" ? "MORNING" : phaseParam === "eod" ? "EOD" : null;
  if (!phase) {
    return NextResponse.json({ error: "phase must be 'morning' or 'eod'" }, { status: 400 });
  }

  const cfg = await getTeamsConfig();

  // Auth: either the shared-secret bearer (cron / automation) or an ADMIN session
  // (the "Send now" button in the admin panel, which never sees the secret).
  const viaSecret = authorizeTeamsRequest(req, cfg.sharedSecret);
  if (!viaSecret) {
    const session = await auth();
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (!cfg.enabled) {
    return NextResponse.json(
      { error: "Teams integration is disabled. Enable it in Admin → Integrations." },
      { status: 503 },
    );
  }
  if (!cfg.flowUrl) {
    return NextResponse.json(
      { error: "Teams integration is not configured (flow URL is unset)." },
      { status: 503 },
    );
  }

  const today = todayDate();
  const dateLabel = formatDate(today);
  const isoDate = today.toISOString().slice(0, 10);

  const members = await prisma.user.findMany({
    where: { role: "MEMBER", email: { not: null } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  // Who has already been prompted for this phase today.
  const alreadySent = await prisma.teamsPrompt.findMany({
    where: { date: today, phase: phase as PromptPhase },
    select: { userId: true },
  });
  const sentIds = new Set(alreadySent.map((p) => p.userId));

  // For EOD we need each member's tasks to build the status card.
  const tasksByUser = new Map<string, EodCardTask[]>();
  if (phase === "EOD") {
    const tasks = await prisma.dailyTask.findMany({
      where: { date: today, userId: { in: members.map((m) => m.id) }, deferredToDate: null },
      select: { id: true, userId: true, title: true, status: true, estimatedHours: true },
      orderBy: { createdAt: "asc" },
    });
    for (const t of tasks) {
      const list = tasksByUser.get(t.userId) ?? [];
      list.push({ id: t.id, title: t.title, status: t.status, estimatedHours: t.estimatedHours });
      tasksByUser.set(t.userId, list);
    }
  }

  const results: { email: string; status: "sent" | "skipped" | "failed"; detail?: string }[] = [];

  for (const m of members) {
    const email = m.email!;
    if (sentIds.has(m.id)) {
      results.push({ email, status: "skipped", detail: "already prompted today" });
      continue;
    }

    const card =
      phase === "MORNING"
        ? buildMorningCard({ name: m.name, dateLabel })
        : buildEodCard({ name: m.name, dateLabel, tasks: tasksByUser.get(m.id) ?? [] });

    const sent = await postToFlow(
      {
        phase: phase === "MORNING" ? "morning" : "eod",
        email,
        name: m.name,
        date: isoDate,
        card,
      },
      cfg,
    );

    if (!sent.ok) {
      results.push({ email, status: "failed", detail: sent.error ?? `HTTP ${sent.status}` });
      continue;
    }

    await prisma.teamsPrompt.create({
      data: { userId: m.id, date: today, phase: phase as PromptPhase },
    });
    results.push({ email, status: "sent" });
  }

  const summary = {
    phase: phase === "MORNING" ? "morning" : "eod",
    date: isoDate,
    sent: results.filter((r) => r.status === "sent").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
  return NextResponse.json(summary);
}
