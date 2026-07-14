import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate, formatDate } from "@/lib/utils";
import { fmtHours, STATUS_META, PRIORITY_META, type TaskStatus, type Priority } from "@/lib/task-status";

// Daily Feed — visible to everyone. Scope is self + direct reports (anyone whose
// managerId is you); admin sees the whole org. One date, every in-scope user in
// one list: did they submit a plan / standup, what they planned, what they got
// done. A member with no reports just sees their own day.
//
// Date picker is a native form GET (submits ?date=) plus prev/next day links —
// no client JS. ponytail: server-only page; add a client picker only if the
// no-JS form ever feels clunky.

// Shift a YYYY-MM-DD string by n whole days (UTC basis, matching @db.Date).
function shiftDay(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const session = await auth();

  const sp = await searchParams;
  const raw = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  // Default today; only accept a real YYYY-MM-DD, else fall back.
  const targetDate =
    raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(new Date(`${raw}T00:00:00.000Z`).getTime())
      ? new Date(`${raw}T00:00:00.000Z`)
      : todayDate();
  const dateStr = targetDate.toISOString().slice(0, 10);
  const todayStr = todayDate().toISOString().slice(0, 10);

  // A manager sees only themselves + their direct reports. Admin sees the whole org.
  const userScope =
    session!.user.role === "ADMIN"
      ? {}
      : { OR: [{ id: session!.user.id }, { managerId: session!.user.id }] };

  const [users, tasks, dayPlans, standups] = await Promise.all([
    // Everyone in scope who can own work — so people with no plan/status still show up.
    prisma.user.findMany({
      where: userScope,
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ name: "asc" }],
    }),
    prisma.dailyTask.findMany({
      where: { date: targetDate },
      select: {
        id: true, userId: true, title: true, status: true, priority: true,
        estimatedHours: true, actualHours: true, unplanned: true, deferredToDate: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.dayPlan.findMany({
      where: { date: targetDate },
      select: { userId: true, goal: true, submittedAt: true },
    }),
    prisma.standup.findMany({
      where: { date: targetDate },
      select: { userId: true },
    }),
  ]);

  const planByUser = new Map(dayPlans.map((p) => [p.userId, p]));
  const standupUsers = new Set(standups.map((s) => s.userId));
  const tasksByUser = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const arr = tasksByUser.get(t.userId);
    if (arr) arr.push(t);
    else tasksByUser.set(t.userId, [t]);
  }

  // Show people with activity first (had tasks or submitted something), then the
  // rest so "who's missing" is visible at the bottom rather than buried.
  const rows = users
    .map((u) => {
      const uTasks = tasksByUser.get(u.id) ?? [];
      const plan = planByUser.get(u.id);
      return {
        user: u,
        planned: uTasks.filter((t) => !t.unplanned && !t.deferredToDate),
        deferred: uTasks.filter((t) => t.deferredToDate),
        unplanned: uTasks.filter((t) => t.unplanned),
        done: uTasks.filter((t) => t.status === "DONE"),
        plannedHours: uTasks
          .filter((t) => !t.unplanned && !t.deferredToDate)
          .reduce((s, t) => s + (t.estimatedHours ?? 0), 0),
        logged: uTasks.reduce((s, t) => s + (t.actualHours ?? 0), 0),
        submitted: Boolean(plan?.submittedAt),
        goal: plan?.goal ?? null,
        hasStandup: standupUsers.has(u.id),
        active: uTasks.length > 0 || Boolean(plan) || standupUsers.has(u.id),
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active));

  // "Who hasn't added for the day" = no plan submitted. Surface as one summary
  // strip instead of a red pill per card.
  const missing = rows.filter((r) => !r.submitted).map((r) => r.user.name || r.user.email || "Unknown");

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1c1a17]">Daily Feed</h1>
          <p className="text-sm text-[#9c968d] mt-0.5">
            {formatDate(targetDate)} — everyone&apos;s plan, status, and what got done.
          </p>
        </div>
        {/* Native form GET (no JS) + prev/next day. */}
        <div className="flex items-center gap-1.5">
          <a
            href={`/feed?date=${shiftDay(dateStr, -1)}`}
            className="px-2.5 py-1.5 rounded-lg border border-[#ece8e1] bg-white text-sm text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
            title="Previous day"
          >
            ←
          </a>
          <form method="GET" className="flex items-center gap-1.5">
            <input
              type="date"
              name="date"
              defaultValue={dateStr}
              max={todayStr}
              className="border border-[#ece8e1] rounded-lg px-2.5 py-1.5 text-sm text-[#2c2925] bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
            />
            <button
              type="submit"
              className="text-sm px-3 py-1.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
            >
              Go
            </button>
          </form>
          {dateStr < todayStr && (
            <a
              href={`/feed?date=${shiftDay(dateStr, 1)}`}
              className="px-2.5 py-1.5 rounded-lg border border-[#ece8e1] bg-white text-sm text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
              title="Next day"
            >
              →
            </a>
          )}
        </div>
      </div>

      {/* Who hasn't added a plan for the day — one strip, not a red pill per card. */}
      {missing.length > 0 ? (
        <div className="bg-[#f8ece9] border border-[#f0d9d2] rounded-xl px-5 py-3.5 mb-4">
          <p className="text-sm text-[#c0533a]">
            <span className="font-semibold">{missing.length} not added</span>
            <span className="text-[#a8695a]"> ({missing.length === rows.length ? "everyone" : `${rows.length - missing.length} of ${rows.length} added`}):</span>{" "}
            <span className="text-[#8a4a3d]">{missing.join(", ")}</span>
          </p>
        </div>
      ) : (
        <div className="bg-[#e9f4ec] border border-[#d3ecda] rounded-xl px-5 py-3.5 mb-4">
          <p className="text-sm text-[#3f8a5b] font-medium">Everyone added a plan for this day. ✓</p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <MemberCard key={r.user.id} row={r} />
        ))}
      </div>
    </div>
  );
}

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  estimatedHours: number | null;
  actualHours: number | null;
};

function MemberCard({
  row,
}: {
  row: {
    user: { id: string; name: string | null; email: string | null; role: string };
    planned: Task[];
    deferred: Task[];
    unplanned: Task[];
    done: Task[];
    plannedHours: number;
    logged: number;
    submitted: boolean;
    goal: string | null;
    hasStandup: boolean;
    active: boolean;
  };
}) {
  const { user, planned, deferred, unplanned, done, plannedHours, logged, submitted, goal, hasStandup, active } = row;
  const name = user.name || user.email || "Unknown";

  return (
    <div className="bg-white rounded-xl border border-[#ece8e1] p-5">
      {/* Header: name · role · plan/standup status pills */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-[#efe9e1] text-[#8a8378] flex items-center justify-center font-semibold text-sm">
            {name[0].toUpperCase()}
          </span>
          <div>
            <span className="text-sm font-semibold text-[#1c1a17]">{name}</span>
            <span className="ml-2 mono text-[10px] tracking-[0.08em] text-[#b0a99e]">{user.role}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {submitted && <Pill label="Plan submitted" />}
          {hasStandup && <Pill label="Standup ✓" />}
        </div>
      </div>

      {goal && <p className="text-sm text-[#6b665f] mt-3 italic">Goal: {goal}</p>}

      {!active ? (
        <p className="text-sm text-[#b0a99e] mt-3">Nothing logged for this day.</p>
      ) : (
        <>
          <p className="mono text-xs text-[#9c968d] mt-3">
            {done.length} of {planned.length} planned done · {fmtHours(plannedHours || null)} planned vs {fmtHours(logged || null)} actual
            {unplanned.length > 0 && ` · ${unplanned.length} unplanned`}
          </p>

          <div className="grid sm:grid-cols-2 gap-4 mt-3">
            <TaskGroup title="Planned" tasks={planned} showEst emptyHint="No planned tasks." />
            <TaskGroup title="Achieved (done)" tasks={done} emptyHint="Nothing marked done yet." />
          </div>

          {unplanned.length > 0 && (
            <div className="mt-3">
              <TaskGroup title="Came up unplanned ⚡" tasks={unplanned} />
            </div>
          )}
          {deferred.length > 0 && (
            <p className="text-xs text-[#c08a2d] mt-3">
              {deferred.length} task{deferred.length === 1 ? "" : "s"} deferred to a later day.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="text-[11px] font-medium rounded-full px-2.5 py-1 bg-[#e9f4ec] text-[#3f8a5b]">
      {label}
    </span>
  );
}

function TaskGroup({
  title,
  tasks,
  showEst,
  emptyHint,
}: {
  title: string;
  tasks: Task[];
  showEst?: boolean;
  emptyHint?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-[#6b665f] mb-1.5">
        {title} <span className="font-normal text-[#b0a99e]">· {tasks.length}</span>
      </p>
      {tasks.length === 0 ? (
        <p className="text-xs text-[#b0a99e]">{emptyHint}</p>
      ) : (
        <ul className="space-y-1">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_META[t.status].dot}`} />
              <span className="flex-1 truncate text-[#2c2925]">{t.title}</span>
              <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${PRIORITY_META[t.priority].badge}`}>
                {PRIORITY_META[t.priority].label}
              </span>
              <span className="mono text-[11px] text-[#b0a99e] shrink-0 w-16 text-right">
                {showEst
                  ? `est ${fmtHours(t.estimatedHours)}`
                  : t.actualHours != null
                    ? fmtHours(t.actualHours)
                    : STATUS_META[t.status].label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
