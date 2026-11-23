import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate, formatDate } from "@/lib/utils";
import { fmtHours, minPlanHours, STATUS_META, PRIORITY_META, type TaskStatus, type Priority } from "@/lib/task-status";
import { descendantUserIds } from "@/lib/org";
import { hourLimits } from "@/lib/limits";
import { FeedSearch } from "./feed-search";

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
  searchParams: Promise<{ date?: string | string[]; team?: string | string[] }>;
}) {
  const session = await auth();

  const sp = await searchParams;
  const raw = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const teamParam = Array.isArray(sp.team) ? sp.team[0] : sp.team; // team id, or "all"/undefined
  // Default today; only accept a real YYYY-MM-DD, else fall back.
  const targetDate =
    raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(new Date(`${raw}T00:00:00.000Z`).getTime())
      ? new Date(`${raw}T00:00:00.000Z`)
      : todayDate();
  const dateStr = targetDate.toISOString().slice(0, 10);
  const todayStr = todayDate().toISOString().slice(0, 10);

  // A manager sees themselves + their whole reporting subtree (reports, their
  // reports, … to the leaves). Admin — and CXO, an org-wide exec observer — see
  // the whole org. CXO users are themselves excluded as subjects (never listed
  // in the feed), regardless of who's viewing.
  const isOrgWide = session!.user.role === "ADMIN" || session!.user.role === "CXO";
  const reportIds = isOrgWide ? [] : await descendantUserIds(session!.user.id);
  const userScope = {
    ...(isOrgWide ? {} : { id: { in: [session!.user.id, ...reportIds] } }),
    role: { not: "CXO" as const },
  };

  // Configured day capacity → thresholds for coloring a member's planned load.
  const { workdayHours } = await hourLimits();
  const minPlan = minPlanHours(workdayHours);

  const [users, teams, tasks, dayPlans, standups] = await Promise.all([
    // Everyone in scope who can own work — so people with no plan/status still show up.
    prisma.user.findMany({
      where: userScope,
      select: { id: true, name: true, email: true, role: true, teamId: true },
      orderBy: [{ name: "asc" }],
    }),
    // Team tabs are derived from the teams the in-scope users belong to, so the
    // tab bar always matches real teams (Dev, QA, Devops, …) with no hardcoding.
    prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.dailyTask.findMany({
      where: { date: targetDate },
      select: {
        id: true, userId: true, title: true, status: true, priority: true,
        estimatedHours: true, actualHours: true, unplanned: true, deferredToDate: true,
        category: { select: { name: true } },
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

  // Only show tabs for teams that actually have an in-scope member. "ALL" first.
  const teamIdsInScope = new Set(users.map((u) => u.teamId).filter(Boolean));
  const teamTabs = teams.filter((t) => teamIdsInScope.has(t.id));
  const activeTeam = teamTabs.some((t) => t.id === teamParam) ? teamParam : "all";

  // Apply the team filter to the user list feeding the cards below.
  const scopedUsers = activeTeam === "all" ? users : users.filter((u) => u.teamId === activeTeam);

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
  const rows = scopedUsers
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
        plannedActual: uTasks
          .filter((t) => !t.unplanned && !t.deferredToDate)
          .reduce((s, t) => s + (t.actualHours ?? 0), 0),
        unplannedActual: uTasks
          .filter((t) => t.unplanned)
          .reduce((s, t) => s + (t.actualHours ?? 0), 0),
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

  // Team KPIs for the visible day: plan load vs capacity + where the team is
  // focusing (top categories by planned hrs, estimate fallback so unlogged plans
  // still count).
  const teamPlanned = rows.reduce((s, r) => s + r.plannedHours, 0);
  const teamCapacity = rows.length * workdayHours;
  const planLoadPct = teamCapacity > 0 ? Math.round((teamPlanned / teamCapacity) * 100) : null;
  const planLoadCls =
    planLoadPct == null ? "text-[#9c968d]"
    : planLoadPct < 60 ? "text-[#c0533a] font-semibold"
    : planLoadPct < 75 || planLoadPct > 110 ? "text-[#c08a2d] font-semibold"
    : "text-[#3f8a5b] font-semibold";
  const catHours = new Map<string, number>();
  for (const t of tasks) {
    if (t.unplanned || t.deferredToDate) continue;
    const name = t.category?.name ?? "Uncategorized";
    catHours.set(name, (catHours.get(name) ?? 0) + (t.estimatedHours ?? 0));
  }
  const allCatTotal = [...catHours.values()].reduce((s, h) => s + h, 0);
  const topCats = [...catHours.entries()]
    .filter(([, h]) => h > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, h]) => ({ name, hours: h, pct: allCatTotal > 0 ? Math.round((h / allCatTotal) * 100) : 0 }));

  // Preserve the active team when the date changes (and vice-versa).
  const teamQ = activeTeam === "all" ? "" : `&team=${activeTeam}`;

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
            href={`/feed?date=${shiftDay(dateStr, -1)}${teamQ}`}
            className="px-2.5 py-1.5 rounded-lg border border-[#ece8e1] bg-white text-sm text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
            title="Previous day"
          >
            ←
          </a>
          {/* Today/Yesterday quick jumps — labelled, so picking a day never relies
              on the native input's browser-locale format. */}
          {dateStr !== todayStr && (
            <a
              href={`/feed?date=${todayStr}${teamQ}`}
              className="px-2.5 py-1.5 rounded-lg border border-[#ece8e1] bg-white text-sm text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
            >
              Today
            </a>
          )}
          {dateStr !== shiftDay(todayStr, -1) && (
            <a
              href={`/feed?date=${shiftDay(todayStr, -1)}${teamQ}`}
              className="px-2.5 py-1.5 rounded-lg border border-[#ece8e1] bg-white text-sm text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
            >
              Yesterday
            </a>
          )}
          <form method="GET" className="flex items-center gap-1.5">
            {activeTeam !== "all" && <input type="hidden" name="team" value={activeTeam} />}
            <input
              type="date"
              name="date"
              defaultValue={dateStr}
              max={todayStr}
              title={`Selected: ${formatDate(targetDate)}`}
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
              href={`/feed?date=${shiftDay(dateStr, 1)}${teamQ}`}
              className="px-2.5 py-1.5 rounded-lg border border-[#ece8e1] bg-white text-sm text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
              title="Next day"
            >
              →
            </a>
          )}
        </div>
      </div>

      {/* Team tabs — ALL + one per team with in-scope members. Server-side filter
          via ?team=, keeps the selected date. Hidden when only one team exists. */}
      {teamTabs.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {[{ id: "all", name: "All" }, ...teamTabs].map((t) => {
            const isActive = activeTeam === t.id || (t.id === "all" && activeTeam === "all");
            const q = t.id === "all" ? `?date=${dateStr}` : `?date=${dateStr}&team=${t.id}`;
            return (
              <a
                key={t.id}
                href={`/feed${q}`}
                className={
                  isActive
                    ? "px-3 py-1.5 rounded-lg text-sm font-semibold bg-primary text-white"
                    : "px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-[#ece8e1] text-[#6b665f] hover:border-primary hover:text-primary transition-colors"
                }
              >
                {t.name}
              </a>
            );
          })}
        </div>
      )}

      {/* Team KPIs for the day: plan load vs capacity + top-focus categories. */}
      {rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div className="bg-white border border-[#ece8e1] rounded-xl px-5 py-3.5">
            <p className="text-[10px] tracking-[0.08em] uppercase text-[#b0a99e] font-medium">Plan load</p>
            <p className="mt-1">
              <span className={`mono text-2xl ${planLoadCls}`}>{planLoadPct != null ? `${planLoadPct}%` : "—"}</span>
              <span className="ml-2 text-xs text-[#9c968d]">
                {fmtHours(teamPlanned || null)} of {fmtHours(teamCapacity || null)} ({rows.length}×{workdayHours}h)
              </span>
            </p>
          </div>
          <div className="bg-white border border-[#ece8e1] rounded-xl px-5 py-3.5">
            <p className="text-[10px] tracking-[0.08em] uppercase text-[#b0a99e] font-medium">Team focus</p>
            {topCats.length === 0 ? (
              <p className="mt-1 text-sm text-[#b0a99e]">No planned work yet.</p>
            ) : (
              <p className="mt-1 text-sm text-[#2c2925]">
                {topCats.map((c, i) => (
                  <span key={c.name}>
                    {i > 0 && <span className="text-[#d5cec2]"> · </span>}
                    <span className="font-semibold">{c.name}</span>
                    <span className="mono text-xs text-[#9c968d]"> {c.pct}%</span>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}

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

      <div className="flex items-center gap-3 mb-3">
        <FeedSearch />
      </div>

      {/* Dense grid — one compact tile per person. Up to 4 across so ~12 fit on
          one screen without scrolling. Task detail hides in a <details>. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {rows.map((r) => (
          <MemberCard key={r.user.id} row={r} workday={workdayHours} minPlan={minPlan} />
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
  category?: { name: string } | null;
};

function MemberCard({
  row,
  workday,
  minPlan,
}: {
  row: {
    user: { id: string; name: string | null; email: string | null; role: string };
    planned: Task[];
    deferred: Task[];
    unplanned: Task[];
    done: Task[];
    plannedHours: number;
    plannedActual: number;
    unplannedActual: number;
    submitted: boolean;
    goal: string | null;
    hasStandup: boolean;
    active: boolean;
  };
  workday: number;
  minPlan: number;
}) {
  const { user, planned, deferred, unplanned, done, plannedHours, plannedActual, unplannedActual, submitted, goal, hasStandup, active } = row;
  const name = user.name || user.email || "Unknown";

  // Color the planned load only once the day is committed. Over the workday cap
  // reads amber (over-committed); under the 60% floor reads red (under-planned).
  const overplanned = submitted && plannedHours > workday;
  const underplanned = submitted && plannedHours < minPlan;
  const plannedCls = overplanned ? "text-[#c08a2d]" : underplanned ? "text-[#c0533a]" : "text-[#9c968d]";

  const total = planned.length;
  const pct = total > 0 ? Math.round((done.length / total) * 100) : 0;

  return (
    <div data-feed-name={name.toLowerCase()} className="bg-white rounded-xl border border-[#ece8e1] p-4 flex flex-col">
      {/* Header: avatar · name/role · status dots */}
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 shrink-0 rounded-full bg-[#efe9e1] text-[#8a8378] flex items-center justify-center font-semibold text-sm">
          {name[0].toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1c1a17] truncate">{name}</p>
          <p className="mono text-[10px] tracking-[0.08em] text-[#b0a99e]">{user.role}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {submitted && <Dot title="Plan submitted" />}
          {hasStandup && <Dot title="Standup done" />}
        </div>
      </div>

      {goal && <p className="text-xs text-[#6b665f] mt-2 italic truncate" title={goal}>Goal: {goal}</p>}

      {!active ? (
        <p className="text-xs text-[#b0a99e] mt-3">Nothing logged.</p>
      ) : (
        <>
          {/* Progress: done / planned + bar */}
          <div className="mt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-[#1c1a17]">
                {done.length}<span className="text-[#b0a99e] font-normal">/{total} done</span>
              </span>
              <span className="mono text-[11px] text-[#9c968d]">{pct}%</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-[#f0ece5] overflow-hidden">
              <div className="h-full rounded-full bg-[#3f8a5b]" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Compact stat line */}
          <p className="mono text-[11px] text-[#9c968d] mt-2">
            <span className={plannedCls}>{fmtHours(plannedHours || null)}</span> plan · {fmtHours(plannedActual || null)} act
            {unplanned.length > 0 && ` · ⚡${unplanned.length}`}
            {deferred.length > 0 && ` · ↪${deferred.length}`}
          </p>

          {/* Task detail hidden by default so the tile stays short. */}
          {planned.length + unplanned.length > 0 && (
            <details open className="mt-2 group">
              <summary className="text-[11px] text-[#9c968d] cursor-pointer select-none hover:text-primary list-none">
                <span className="group-open:hidden">▸ tasks</span>
                <span className="hidden group-open:inline">▾ tasks</span>
              </summary>
              <ul className="mt-1.5 space-y-0.5">
                {planned.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
                {unplanned.map((t) => (
                  <TaskRow key={t.id} task={t} unplanned />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Dot({ title }: { title: string }) {
  return <span title={title} className="w-2 h-2 rounded-full bg-[#3f8a5b]" />;
}

// One task line. Leading indicator is a green tick box when DONE, otherwise the
// status dot. Trailing hours show actual once logged, else the estimate.
function TaskRow({ task: t, unplanned }: { task: Task; unplanned?: boolean }) {
  const done = t.status === "DONE";
  return (
    <li className="flex items-center gap-2 text-sm py-0.5">
      {done ? (
        <span className="w-4 h-4 shrink-0 rounded-full bg-[#3f8a5b] text-white flex items-center justify-center text-[10px] font-bold leading-none">
          ✓
        </span>
      ) : (
        <span className="w-4 h-4 shrink-0 rounded-full border-[1.5px] border-[#d5cec2] flex items-center justify-center">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[t.status].dot}`} />
        </span>
      )}
      {unplanned && <span className="shrink-0 text-[11px]" title="Came up unplanned">⚡</span>}
      <span className={`flex-1 truncate ${done ? "text-[#9c968d] line-through decoration-[#d5cec2]" : "text-[#2c2925]"}`}>
        {t.title}
      </span>
      {t.category?.name && (
        <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 bg-indigo-100 text-indigo-700">
          {t.category.name}
        </span>
      )}
      <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${PRIORITY_META[t.priority].badge}`}>
        {PRIORITY_META[t.priority].label}
      </span>
      <span className="mono text-[11px] text-[#b0a99e] shrink-0 w-20 text-right whitespace-nowrap">
        {t.actualHours != null ? fmtHours(t.actualHours) : `est ${fmtHours(t.estimatedHours)}`}
      </span>
    </li>
  );
}
