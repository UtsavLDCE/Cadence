import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { descendantUserIds } from "@/lib/org";

// GET /api/feed/history?userId=<id>&date=<YYYY-MM-DD>
// The target user's last 7 days (ending at `date`, default today) of tasks,
// grouped per day with that day's plan state. Backs the feed drawer's history
// timeline. Scope mirrors the feed page: you may read yourself, anyone in your
// reporting subtree, or — as ADMIN/CXO — the whole org. CXO users are never a
// valid subject (they own no work), matching the feed.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const isOrgWide = session.user.role === "ADMIN" || session.user.role === "CXO";
  if (!isOrgWide && userId !== session.user.id) {
    const reports = await descendantUserIds(session.user.id);
    if (!reports.includes(userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const rawDate = req.nextUrl.searchParams.get("date");
  const end =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(new Date(`${rawDate}T00:00:00.000Z`).getTime())
      ? new Date(`${rawDate}T00:00:00.000Z`)
      : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6); // 7 days inclusive

  const [tasks, plans] = await Promise.all([
    prisma.dailyTask.findMany({
      where: { userId, date: { gte: start, lte: end } },
      select: {
        id: true, title: true, status: true, priority: true, date: true,
        estimatedHours: true, actualHours: true, unplanned: true,
        deferredToDate: true, deferredFromDate: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.dayPlan.findMany({
      where: { userId, date: { gte: start, lte: end } },
      select: { date: true, goal: true, submittedAt: true },
    }),
  ]);

  const planByDay = new Map(plans.map((p) => [p.date.toISOString().slice(0, 10), p]));
  const tasksByDay = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const key = t.date.toISOString().slice(0, 10);
    const arr = tasksByDay.get(key);
    if (arr) arr.push(t);
    else tasksByDay.set(key, [t]);
  }

  // Emit all 7 slots newest-first so a day with no plan still shows as a gap.
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const plan = planByDay.get(key);
    days.push({
      date: key,
      submitted: Boolean(plan?.submittedAt),
      goal: plan?.goal ?? null,
      tasks: tasksByDay.get(key) ?? [],
    });
  }

  return NextResponse.json({ days });
}
