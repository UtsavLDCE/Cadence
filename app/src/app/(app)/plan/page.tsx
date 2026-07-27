import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { todayDate, formatDate } from "@/lib/utils";
import { TAGS_INCLUDE } from "@/lib/task-tags";
import { PlanForMemberClient } from "./plan-client";

// Plan a member's day — manager/admin only. A lead picks one of the people they
// manage ("followed members" = direct reports; admin sees every member), a day
// (default today), sets that day's goal, and drops tasks straight onto it. This
// is the composing surface for "the manager provides work"; the tasks land on the
// member's My Day exactly like a self-added task, stamped as assigned by the lead.
//
// Member + date are chosen with a no-JS GET form (?member=&date=), matching the
// Daily Feed pattern. The server does every read; the client island only mutates
// (save goal, add task, delete task) and calls router.refresh().

function shiftDay(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string | string[]; date?: string | string[] }>;
}) {
  const session = await auth();
  const isManager = session!.user.role === "MANAGER" || session!.user.role === "ADMIN";
  if (!isManager) redirect("/dashboard");

  const sp = await searchParams;
  const memberId = (Array.isArray(sp.member) ? sp.member[0] : sp.member) || "";
  const rawDate = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const targetDate =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(new Date(`${rawDate}T00:00:00.000Z`).getTime())
      ? new Date(`${rawDate}T00:00:00.000Z`)
      : todayDate();
  const dateStr = targetDate.toISOString().slice(0, 10);

  // Admin plans for anyone; a manager plans for their whole reporting line
  // (User.managerId == me), same scope as Daily Feed / Insights. No role gate —
  // a report who is themselves a MANAGER must still show.
  // ponytail: adding a task to a non-MEMBER 400s at /api/manager/tasks (Task List
  // shows MEMBER tasks only); goal-setting works for anyone. Widen that gate if
  // leads need to assign work up the line.
  const members = await prisma.user.findMany({
    where:
      session!.user.role === "ADMIN"
        ? { id: { not: session!.user.id } }
        : { managerId: session!.user.id },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }],
  });

  const selected = memberId ? members.find((m) => m.id === memberId) ?? null : null;

  // Roster status for the chosen day: for every member the lead can plan for,
  // where does their day stand — not planned, planned (open), or submitted, and
  // how many of their tasks are done. Gives the lead at-a-glance visibility of
  // who still needs attention. Two batched reads (plans + task counts), joined
  // in memory keyed by userId.
  const memberIds = members.map((m) => m.id);
  const [dayPlans, taskGroups] = memberIds.length
    ? await Promise.all([
        prisma.dayPlan.findMany({
          where: { userId: { in: memberIds }, date: targetDate },
          select: { userId: true, submittedAt: true, goal: true },
        }),
        prisma.dailyTask.groupBy({
          by: ["userId", "status"],
          where: { userId: { in: memberIds }, date: targetDate },
          _count: { _all: true },
          _sum: { estimatedHours: true, actualHours: true },
        }),
      ])
    : [[], []];

  const planByUser = new Map(dayPlans.map((p) => [p.userId, p]));
  const counts = new Map<string, { total: number; done: number; planned: number; actual: number }>();
  for (const g of taskGroups) {
    const c = counts.get(g.userId) ?? { total: 0, done: 0, planned: 0, actual: 0 };
    c.total += g._count._all;
    if (g.status === "DONE") c.done += g._count._all;
    c.planned += g._sum.estimatedHours ?? 0;
    c.actual += g._sum.actualHours ?? 0;
    counts.set(g.userId, c);
  }
  const roster = members.map((m) => {
    const p = planByUser.get(m.id);
    const c = counts.get(m.id) ?? { total: 0, done: 0, planned: 0, actual: 0 };
    const status: "submitted" | "planned" | "empty" = p?.submittedAt
      ? "submitted"
      : c.total > 0 || (p?.goal && p.goal.trim())
        ? "planned"
        : "empty";
    return { ...m, status, total: c.total, done: c.done, planned: c.planned, actual: c.actual };
  });
  const STATUS = {
    submitted: { label: "Submitted", cls: "bg-green-50 text-green-700 border-green-200" },
    planned: { label: "Planned", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    empty: { label: "Not planned", cls: "bg-gray-50 text-gray-500 border-gray-200" },
  } as const;
  // Trim trailing .0 so "3h" not "3.0h" but "3.5h" stays.
  const fmtH = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // Load the selected member's plan goal + tasks for the chosen day.
  const [plan, tasks] = selected
    ? await Promise.all([
        prisma.dayPlan.findUnique({
          where: { userId_date: { userId: selected.id, date: targetDate } },
          select: { goal: true, submittedAt: true },
        }),
        prisma.dailyTask.findMany({
          where: { userId: selected.id, date: targetDate },
          orderBy: { createdAt: "asc" },
          select: {
            id: true, title: true, notes: true, status: true, priority: true,
            estimatedHours: true, assignedById: true,
            assignedBy: { select: { id: true, name: true, email: true } },
            ...TAGS_INCLUDE,
          },
        }),
      ])
    : [null, []];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1c1a17]">Plan a member&apos;s day</h1>
        <p className="text-sm text-[#9c968d] mt-0.5">
          Pick who you manage and the day, set their goal, and hand them the work. Tasks land on their My Day.
        </p>
      </div>

      {/* Member + date selector — native GET, no client JS. */}
      <form method="GET" className="flex items-end gap-2 flex-wrap mb-6 bg-white rounded-xl border border-[#ece8e1] p-4">
        <div>
          <label className="block text-xs font-medium text-[#6b665f] mb-1">Member</label>
          <select
            name="member"
            defaultValue={memberId}
            className="border border-[#ece8e1] rounded-lg px-2.5 py-1.5 text-sm text-[#2c2925] bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
          >
            <option value="">Pick a member…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.email}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b665f] mb-1">Day</label>
          <div className="flex items-center gap-1.5">
            <a
              href={`/plan?member=${memberId}&date=${shiftDay(dateStr, -1)}`}
              className="px-2.5 py-1.5 rounded-lg border border-[#ece8e1] bg-white text-sm text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
              title="Previous day"
            >
              ←
            </a>
            <input
              type="date"
              name="date"
              defaultValue={dateStr}
              className="border border-[#ece8e1] rounded-lg px-2.5 py-1.5 text-sm text-[#2c2925] bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
            />
            <a
              href={`/plan?member=${memberId}&date=${shiftDay(dateStr, 1)}`}
              className="px-2.5 py-1.5 rounded-lg border border-[#ece8e1] bg-white text-sm text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
              title="Next day"
            >
              →
            </a>
          </div>
        </div>
        <button
          type="submit"
          className="text-sm px-3 py-1.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
        >
          Open
        </button>
      </form>

      {/* Roster status for the day — who's planned, who's still pending. Each
          card links to that member's planning panel for the same day. */}
      {roster.length > 0 && (
        <div className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-semibold text-[#6b665f]">Team — {formatDate(targetDate)}</h2>
            <span className="text-xs text-[#9c968d]">
              {roster.filter((r) => r.status === "empty").length} not planned ·{" "}
              {roster.filter((r) => r.status === "planned").length} planned ·{" "}
              {roster.filter((r) => r.status === "submitted").length} submitted
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {roster.map((m) => (
              <a
                key={m.id}
                href={`/plan?member=${m.id}&date=${dateStr}`}
                className={`block rounded-xl border p-3 transition-colors hover:border-primary ${
                  m.id === memberId ? "border-primary bg-primary/5" : "border-[#ece8e1] bg-white"
                }`}
              >
                <p className="text-sm font-medium text-[#2c2925] truncate">{m.name || m.email}</p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS[m.status].cls}`}>
                    {STATUS[m.status].label}
                  </span>
                  {m.total > 0 && (
                    <span className="text-xs text-[#9c968d]">{m.done}/{m.total} done</span>
                  )}
                </div>
                {m.total > 0 && (
                  <>
                    {/* Progress = done/total tasks. */}
                    <div className="mt-2 h-1.5 rounded-full bg-[#ece8e1] overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.round((m.done / m.total) * 100)}%` }}
                      />
                    </div>
                    {/* Planned (estimate) vs actual hours logged. */}
                    <p className="mt-1.5 text-[11px] text-[#9c968d]">
                      <span className="text-[#6b665f] font-medium">{fmtH(m.planned)}h</span> planned ·{" "}
                      <span className="text-[#6b665f] font-medium">{fmtH(m.actual)}h</span> actual
                    </p>
                  </>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {!selected ? (
        <div className="bg-white rounded-xl border border-[#ece8e1] p-8 text-center text-sm text-[#9c968d]">
          {members.length === 0
            ? "No members report to you yet. An admin sets who you manage under Admin → Users → Manager."
            : "Pick a member and a day to start planning their work."}
        </div>
      ) : (
        <PlanForMemberClient
          member={selected}
          date={dateStr}
          dateLabel={formatDate(targetDate)}
          initialGoal={plan?.goal ?? ""}
          submitted={Boolean(plan?.submittedAt)}
          initialTasks={JSON.parse(JSON.stringify(tasks))}
        />
      )}
    </div>
  );
}
