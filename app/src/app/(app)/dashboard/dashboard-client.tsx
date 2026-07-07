"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { CategorySelect, useCategories, categoryName, type Category } from "@/components/category-select";
import { TagInput, TagBadges, useTags, type Tag } from "@/components/tag-input";
import {
  STATUS_META,
  TASK_STATUSES,
  fmtHours,
  WORKDAY_HOURS,
  DEFERRAL_CAUSE_META,
  PRIORITIES,
  PRIORITY_META,
  type TaskStatus,
  type DeferralCause,
  type Priority,
} from "@/lib/task-status";

type Task = {
  id: string;
  userId?: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: Priority;
  estimatedHours: number | null;
  actualHours: number | null;
  deferredToDate?: string | null;
  deferralCause?: DeferralCause | null;
  deferralNote?: string | null;
};

// A task marked DONE today. `planned` distinguishes today's-plan work from work
// carried over from an earlier day and cleared today (effort beyond the plan).
type DoneTask = {
  id: string;
  title: string;
  priority: Priority;
  estimatedHours: number | null;
  actualHours: number | null;
  planned: boolean;
};

// A still-pending task anywhere on the team, with its owner — the unit a manager
// can reassign. `date` is the planned day (UTC midnight @db.Date).
type PendingTask = {
  id: string;
  userId: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  estimatedHours: number | null;
  date: string;
};

// One row in the "Task List" page — every task on the team, any status, any day.
export type AllTask = {
  id: string;
  seq: number;
  userId: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: Priority;
  estimatedHours: number | null;
  actualHours: number | null;
  date: string;
  completedAt: string | null;
  deferredToDate: string | null;
  categoryId: string | null;
  tags: Tag[];
};

type Discipline = {
  score: number;
  daysPlanned: number;
  activeDays: number;
  completionPct: number;
  plannedToday: boolean;
  lastActiveIso: string | null;
};

type Member = {
  id: string;
  name: string | null;
  email: string | null;
  team: string | null;
  tasks: Task[];
  doneToday: DoneTask[];
  overdue: number;
  discipline: Discipline;
};

type Props = {
  isManager: boolean;
  todayIso: string;
  cutoffTime: string;
  myTasks: Task[];
  myOverdue: Task[];
  members: Member[];
  pendingTasks?: PendingTask[];
};

export function DashboardClient({ isManager, todayIso, cutoffTime, myTasks, myOverdue, members, pendingTasks = [] }: Props) {
  const todayLabel = formatDate(new Date(todayIso));

  if (!isManager) return <MemberView todayLabel={todayLabel} tasks={myTasks} overdue={myOverdue} />;

  return <ManagerView todayLabel={todayLabel} todayIso={todayIso} cutoffTime={cutoffTime} members={members} pendingTasks={pendingTasks} />;
}

/* ---------------- Member ---------------- */

function MemberView({ todayLabel, tasks, overdue }: { todayLabel: string; tasks: Task[]; overdue: Task[] }) {
  const counts = countByStatus(tasks);
  const done = counts.DONE;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const totalEstimate = tasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
  const overBy = totalEstimate - WORKDAY_HOURS;

  return (
    <div>
      <Header title="My Overview" subtitle={todayLabel} />

      {overBy > 0 && (
        <div className="flex items-start gap-3 mb-5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
          <span className="mt-0.5 text-base leading-none">⚠️</span>
          <div>
            <p className="font-semibold">You&apos;re overplanning.</p>
            <p className="text-amber-700">
              {fmtHours(totalEstimate)} planned vs. a ~{WORKDAY_HOURS}h day — {fmtHours(overBy)} over. <Link href="/standup" className="underline">Trim your plan →</Link>
            </p>
          </div>
        </div>
      )}

      {overdue.length > 0 && (
        <Link href="/profile" className="flex items-center gap-2 mb-5 bg-primary-soft border border-[#f6cabc] text-primary rounded-xl px-4 py-3 text-sm font-medium hover:opacity-90">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          {overdue.length} overdue {overdue.length === 1 ? "task" : "tasks"} waiting in your queue →
        </Link>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Planned today" value={String(tasks.length)} accent="#1f2433" />
        <StatCard label="Completed" value={`${done}/${tasks.length || 0}`} accent={STATUS_META.DONE.hex} />
        <StatCard label="In progress" value={String(counts.IN_PROGRESS)} accent={STATUS_META.IN_PROGRESS.hex} />
        <StatCard label="Overdue" value={String(overdue.length)} accent="#f4502e" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Today's status" className="lg:col-span-1">
          <Donut counts={counts} total={tasks.length} />
          <Legend counts={counts} />
        </Card>

        <Card title="Today's plan" className="lg:col-span-2">
          {tasks.length === 0 ? (
            <Empty text={<>No tasks planned. <Link href="/standup" className="text-primary hover:underline">Plan your day →</Link></>} />
          ) : (
            <div className="space-y-2">
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden mb-3">
                <div className="h-full bar-fill bg-emerald-500" style={{ width: `${progress}%` }} />
              </div>
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_META[t.status].dot)} />
                  <p className={cn("text-sm flex-1 break-words", t.status === "DONE" ? "line-through text-gray-400" : "text-gray-800")}>{t.title}</p>
                  <span className="text-xs text-gray-400 shrink-0">{fmtHours(t.estimatedHours)}</span>
                  <span className={cn("text-xs rounded px-2 py-0.5 shrink-0", STATUS_META[t.status].badge)}>{STATUS_META[t.status].label}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Manager ---------------- */

function ManagerView({ todayLabel, todayIso, cutoffTime, members, pendingTasks }: { todayLabel: string; todayIso: string; cutoffTime: string; members: Member[]; pendingTasks: PendingTask[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "list" | "done" | "pending">("board");

  const allTasks = members.flatMap((m) => m.tasks);
  const counts = countByStatus(allTasks);
  const totalOverdue = members.reduce((s, m) => s + m.overdue, 0);
  const noPlan = members.filter((m) => m.tasks.length === 0);
  const planned = members.length - noPlan.length;
  const teamDoneRate = allTasks.length ? Math.round((counts.DONE / allTasks.length) * 100) : 0;
  const totalDoneToday = members.reduce((s, m) => s + m.doneToday.length, 0);
  const totalPending = pendingTasks.length;
  const highPending = pendingTasks.filter((t) => t.priority === "HIGH").length;

  // Team capacity vs. what's actually planned for today (estimated hours). Over
  // 100% means the team is collectively over-committed for the day.
  const totalPlannedHours = members.reduce((s, m) => s + plannedHours(m), 0);
  const capacityHours = members.length * WORKDAY_HOURS;
  const loadPct = capacityHours ? Math.round((totalPlannedHours / capacityHours) * 100) : 0;
  const overloaded = members.filter((m) => plannedHours(m) > WORKDAY_HOURS).length;

  // Average trailing discipline score across the team — one-glance follow-through.
  const avgDiscipline = members.length
    ? Math.round(members.reduce((s, m) => s + m.discipline.score, 0) / members.length)
    : 0;
  const totalDeferred = members.reduce((s, m) => s + deferredCount(m), 0);

  // Top assignees by load (today's task count)
  const ranked = [...members].filter((m) => m.tasks.length > 0).sort((a, b) => b.tasks.length - a.tasks.length).slice(0, 6);
  const maxLoad = ranked.length ? ranked[0].tasks.length : 1;

  return (
    <div>
      <Header
        title="Team Overview"
        subtitle={`${todayLabel} · Cutoff ${cutoffTime}`}
        right={
          <div className="flex gap-2 text-sm">
            <Pill tone="ok">{planned}/{members.length} planned</Pill>
            {noPlan.length > 0 && <Pill tone="danger">{noPlan.length} no plan</Pill>}
            {totalOverdue > 0 && <Pill tone="danger">{totalOverdue} overdue</Pill>}
          </div>
        }
      />

      {/* Most important / actionable data first: risks (overdue, no-plan,
          backlog) lead, then throughput and load. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3 mb-6">
        <StatCard label="Overdue" value={String(totalOverdue)} accent="#f4502e" hint={totalOverdue ? "needs attention" : "all clear"} alert={totalOverdue > 0} />
        <StatCard label="No plan today" value={String(noPlan.length)} accent={noPlan.length ? "#f4502e" : "#2bb673"} hint={`${planned}/${members.length} planned`} alert={noPlan.length > 0} />
        <StatCard label="Backlog" value={String(totalPending)} accent="#1f2433" hint={highPending ? `${highPending} high priority` : "pending, all days"} alert={highPending > 0} />
        <StatCard label="Done today" value={String(totalDoneToday)} accent={STATUS_META.DONE.hex} hint={`${teamDoneRate}% of today's plan`} />
        <StatCard label="Tasks today" value={String(allTasks.length)} accent="#1f2433" hint={`${counts.DONE} done · ${counts.TODO} to do`} />
        <StatCard label="In progress" value={String(counts.IN_PROGRESS)} accent={STATUS_META.IN_PROGRESS.hex} hint={`${counts.HOLD} on hold · ${totalDeferred} deferred`} />
        <StatCard label="Team load" value={`${loadPct}%`} accent={loadPct > 100 ? "#f5a623" : "#1f2433"} hint={`${fmtHours(totalPlannedHours)} / ${capacityHours}h${overloaded ? ` · ${overloaded} over` : ""}`} alert={loadPct > 100} />
        <StatCard label="Discipline" value={String(avgDiscipline)} accent={avgDiscipline >= 75 ? "#2bb673" : avgDiscipline >= 60 ? "#f5a623" : "#f4502e"} hint="team avg · 14d" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card title="Status distribution" className="lg:col-span-1">
          <Donut counts={counts} total={allTasks.length} />
          <Legend counts={counts} />
        </Card>

        <Card title="Top assignees (today's load)" className="lg:col-span-2">
          {ranked.length === 0 ? (
            <Empty text="No tasks planned across the team yet." />
          ) : (
            <div className="space-y-3">
              {ranked.map((m) => {
                const done = countByStatus(m.tasks).DONE;
                return (
                  <div key={m.id} className="flex items-center gap-3">
                    <span className="w-32 truncate text-sm text-gray-700 shrink-0">{m.name || m.email}</span>
                    <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bar-fill bg-primary" style={{ width: `${(m.tasks.length / maxLoad) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-16 text-right shrink-0">{done}/{m.tasks.length} done</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <DisciplineWatch members={members} />

      {noPlan.length > 0 && (
        <div className="mb-6 bg-primary-soft border border-[#f6cabc] rounded-xl p-4">
          <h2 className="font-semibold text-primary mb-2 flex items-center gap-2">
            <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            No plan set today ({noPlan.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {noPlan.map((m) => (
              <div key={m.id} className="flex items-center gap-2 bg-white border border-[#f6cabc] rounded-lg px-3 py-1.5">
                <div className="w-6 h-6 bg-primary-soft rounded-full flex items-center justify-center text-xs font-medium text-primary">
                  {(m.name || m.email || "?")[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{m.name || m.email}</p>
                  {m.team && <p className="text-xs text-gray-500">{m.team}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Who's doing what */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="font-semibold text-gray-800">Who&apos;s doing what</h2>
          <div className="flex rounded-lg border border-gray-200 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setView("board")}
              className={cn("px-3 py-1 rounded-md font-medium transition-colors", view === "board" ? "bg-primary text-white" : "text-gray-500 hover:text-gray-800")}
            >
              Board
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn("px-3 py-1 rounded-md font-medium transition-colors", view === "list" ? "bg-primary text-white" : "text-gray-500 hover:text-gray-800")}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setView("done")}
              className={cn("px-3 py-1 rounded-md font-medium transition-colors", view === "done" ? "bg-primary text-white" : "text-gray-500 hover:text-gray-800")}
            >
              Done today{totalDoneToday > 0 ? ` (${totalDoneToday})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setView("pending")}
              className={cn("px-3 py-1 rounded-md font-medium transition-colors", view === "pending" ? "bg-primary text-white" : "text-gray-500 hover:text-gray-800")}
            >
              Pending{totalPending > 0 ? ` (${totalPending})` : ""}
            </button>
          </div>
        </div>

        {members.length === 0 ? (
          <Empty text="No team members yet." />
        ) : view === "pending" ? (
          <PendingView pendingTasks={pendingTasks} members={members} todayIso={todayIso} />
        ) : view === "done" ? (
          <DoneTodayView members={members} />
        ) : view === "board" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {members.map((m) => (
              <PersonCard key={m.id} m={m} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => {
            const c = countByStatus(m.tasks);
            const open = expanded === m.id;
            return (
              <div key={m.id} className="border border-gray-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : m.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-primary-soft rounded-full flex items-center justify-center text-sm font-semibold text-primary">
                      {(m.name || m.email || "?")[0].toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-gray-900">{m.name || m.email}</p>
                      <p className="text-xs text-gray-500">{m.team || "No team"} · {m.tasks.length} task{m.tasks.length === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.tasks.length === 0 && <span className="text-xs bg-primary-soft text-primary px-2 py-0.5 rounded font-medium">No plan</span>}
                    {c.DONE > 0 && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-medium">{c.DONE} done</span>}
                    {doneExtra(m) > 0 && <span title="Finished today but not on today's plan (carried over)" className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-medium">+{doneExtra(m)} beyond plan</span>}
                    {c.HOLD > 0 && <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-medium">{c.HOLD} hold</span>}
                    {deferredCount(m) > 0 && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-medium">{deferredCount(m)} deferred</span>}
                    {m.overdue > 0 && <span className="text-xs bg-primary-soft text-primary px-2 py-0.5 rounded font-medium">{m.overdue} overdue</span>}
                    {plannedHours(m) > WORKDAY_HOURS && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-medium">⚠ {fmtHours(plannedHours(m))} planned</span>}
                    <svg className={cn("w-4 h-4 text-gray-400 transition-transform", open && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-3 pt-1 border-t border-gray-50 space-y-3">
                    {m.tasks.length === 0 ? (
                      <p className="text-sm text-gray-400 py-2">No tasks planned today.</p>
                    ) : (
                      <div className="space-y-2 pt-2">
                        {m.tasks.map((t) => (
                          <div key={t.id}>
                            <div className="flex items-center gap-3">
                              <span className={cn("w-2 h-2 rounded-full shrink-0", t.deferredToDate ? "bg-amber-400" : STATUS_META[t.status].dot)} />
                              <p className={cn("text-sm flex-1 break-words", t.status === "DONE" ? "line-through text-gray-400" : t.deferredToDate ? "text-gray-500" : "text-gray-800")}>{t.title}</p>
                              <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[t.priority].badge)}>{PRIORITY_META[t.priority].label}</span>
                              <span className="text-xs text-gray-400 shrink-0">est {fmtHours(t.estimatedHours)} · act {fmtHours(t.actualHours)}</span>
                              {t.deferredToDate ? (
                                <span className="text-xs rounded px-2 py-0.5 shrink-0 bg-amber-100 text-amber-700 font-medium">
                                  Deferred → {fmtShortDate(t.deferredToDate)}
                                </span>
                              ) : (
                                <span className={cn("text-xs rounded px-2 py-0.5 shrink-0", STATUS_META[t.status].badge)}>{STATUS_META[t.status].label}</span>
                              )}
                            </div>
                            {t.deferredToDate && (
                              <p className="ml-5 mt-1 text-xs text-amber-700">
                                Reason: {t.deferralCause ? DEFERRAL_CAUSE_META[t.deferralCause].label : "—"}
                                {t.deferralNote ? ` · ${t.deferralNote}` : ""}
                              </p>
                            )}
                            {t.notes && (
                              <p className="ml-5 mt-1 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-md px-2.5 py-1.5 whitespace-pre-wrap break-words">
                                {t.notes}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <AssignTaskForm memberId={m.id} memberName={m.name || m.email || "this member"} />
                  </div>
                )}
              </div>
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Done today ---------------- */

// How many of today's completed tasks were beyond the defined plan (carried over
// from an earlier day and cleared today).
function doneExtra(m: Member): number {
  return m.doneToday.filter((t) => !t.planned).length;
}

// Team-wide roll-up of what each person actually finished today — including work
// that wasn't on their plan, so a manager sees effort beyond the defined tasks.
function DoneTodayView({ members }: { members: Member[] }) {
  const active = members.filter((m) => m.doneToday.length > 0);
  if (active.length === 0) {
    return <Empty text="Nothing marked done across the team yet today." />;
  }
  return (
    <div className="space-y-3">
      {active.map((m) => {
        const extra = doneExtra(m);
        return (
          <div key={m.id} className="border border-gray-100 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-emerald-50 rounded-full flex items-center justify-center text-sm font-semibold text-emerald-700 shrink-0">
                {(m.name || m.email || "?")[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 truncate">{m.name || m.email}</p>
                <p className="text-xs text-gray-500">{m.team || "No team"}</p>
              </div>
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-medium shrink-0">
                {m.doneToday.length} done
              </span>
              {extra > 0 && (
                <span title="Completed today but not on today's plan" className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-medium shrink-0">
                  +{extra} beyond plan
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {m.doneToday.map((t) => (
                <div key={t.id} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-emerald-500" />
                  <p className="text-sm flex-1 break-words text-gray-700">{t.title}</p>
                  <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[t.priority].badge)}>{PRIORITY_META[t.priority].label}</span>
                  <span className="text-xs text-gray-400 shrink-0">est {fmtHours(t.estimatedHours)} · act {fmtHours(t.actualHours)}</span>
                  {t.planned ? (
                    <span className="text-xs rounded px-2 py-0.5 shrink-0 bg-gray-100 text-gray-600 font-medium">Today&apos;s plan</span>
                  ) : (
                    <span title="Carried over from an earlier day" className="text-xs rounded px-2 py-0.5 shrink-0 bg-violet-100 text-violet-700 font-medium">Carried over</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Pending (reassignable) ---------------- */

// Team-wide list of every still-pending task, grouped by current owner, each with
// a control to reassign it to another member. Lets a manager rebalance load —
// move a stalled or misrouted task to whoever should actually own it.
function PendingView({
  pendingTasks,
  members,
  todayIso,
}: {
  pendingTasks: PendingTask[];
  members: Member[];
  todayIso: string;
}) {
  const [tasks, setTasks] = useState<PendingTask[]>(pendingTasks);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const todayMs = new Date(todayIso).getTime();
  const nameOf = (userId: string) => {
    const m = members.find((x) => x.id === userId);
    return m?.name || m?.email || "Unknown";
  };

  async function reassign(id: string, userId: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/manager/tasks/${id}/reassign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    setBusy(null);
    if (res.ok) {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, userId } : t)));
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to reassign task.");
    }
  }

  if (tasks.length === 0) {
    return <Empty text="No pending tasks across the team — everything's done or scheduled." />;
  }

  // Owner first, then earliest-day first, then highest priority.
  const ordered = [...tasks].sort(
    (a, b) =>
      nameOf(a.userId).localeCompare(nameOf(b.userId)) ||
      new Date(a.date).getTime() - new Date(b.date).getTime() ||
      PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank,
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400">
        Every unfinished task on the team. Reassign one to move it to another member — it keeps its date, estimate, and priority.
      </p>
      {error && <p className="text-sm text-primary">{error}</p>}
      {ordered.map((t) => {
        const overdue = new Date(t.date).getTime() < todayMs;
        return (
          <div key={t.id} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2.5 flex-wrap">
            <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_META[t.status].dot)} />
            <p className="text-sm text-gray-800 flex-1 min-w-[8rem] break-words">{t.title}</p>
            <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[t.priority].badge)}>{PRIORITY_META[t.priority].label}</span>
            <span className={cn("text-xs rounded px-2 py-0.5 shrink-0", STATUS_META[t.status].badge)}>{STATUS_META[t.status].label}</span>
            <span className="text-xs text-gray-400 shrink-0">est {fmtHours(t.estimatedHours)}</span>
            <span className={cn("text-xs rounded px-2 py-0.5 shrink-0", overdue ? "bg-primary-soft text-primary font-medium" : "text-gray-400")}>
              {overdue ? "overdue · " : ""}{fmtShortDate(t.date)}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-gray-400">→</span>
              <select
                value={t.userId}
                disabled={busy === t.id}
                onChange={(e) => reassign(t.id, e.target.value)}
                title="Reassign to another member"
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#f4502e55]"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.email}</option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- All tasks (filterable) ---------------- */

// Every task on the team in one filterable list. Defaults to hiding DONE so a
// manager sees live work first; filters narrow by owner, status, priority, and
// title text. Each row expands to show the full description and an inline editor
// (title, description, priority, status, estimate, actual).
export function AllTasksView({
  allTasks,
  members,
  todayIso,
}: {
  allTasks: AllTask[];
  members: { id: string; name: string | null; email: string | null }[];
  todayIso: string;
}) {
  const router = useRouter();
  const { categories, createCategory } = useCategories();
  const { tags, createTag } = useTags();
  const [owner, setOwner] = useState<string>("all");
  const [status, setStatus] = useState<"active" | "all" | TaskStatus>("active");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [category, setCategory] = useState<string>("all"); // "all" | "none" | categoryId
  const [tag, setTag] = useState<string>("all"); // "all" | "none" | tagId
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const todayMs = new Date(todayIso).getTime();
  const nameOf = (userId: string) => {
    const m = members.find((x) => x.id === userId);
    return m?.name || m?.email || "Unknown";
  };

  const q = query.trim().toLowerCase();
  const filtered = allTasks.filter((t) => {
    if (owner !== "all" && t.userId !== owner) return false;
    if (status === "active" ? t.status === "DONE" : status !== "all" && t.status !== status) return false;
    if (priority !== "all" && t.priority !== priority) return false;
    if (category === "none" ? t.categoryId !== null : category !== "all" && t.categoryId !== category) return false;
    if (tag === "none" ? t.tags.length > 0 : tag !== "all" && !t.tags.some((x) => x.id === tag)) return false;
    if (
      q &&
      !t.title.toLowerCase().includes(q) &&
      !(t.notes ?? "").toLowerCase().includes(q) &&
      !`task-${t.seq}`.includes(q)
    )
      return false;
    return true;
  });

  const selectCls = "text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#f4502e55]";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ID, title, or notes…"
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#f4502e55] flex-1 min-w-[10rem]"
        />
        <select value={owner} onChange={(e) => setOwner(e.target.value)} title="Filter by owner" className={selectCls}>
          <option value="all">All owners</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name || m.email}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} title="Filter by status" className={selectCls}>
          <option value="active">Not done</option>
          <option value="all">All statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} title="Filter by priority" className={selectCls}>
          <option value="all">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_META[p].label}</option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} title="Filter by category" className={selectCls}>
          <option value="all">All categories</option>
          <option value="none">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} title="Filter by tag" className={selectCls}>
          <option value="all">All tags</option>
          <option value="none">Untagged</option>
          {tags.map((x) => (
            <option key={x.id} value={x.id}>#{x.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="text-xs font-medium rounded-lg px-3 py-1.5 transition-colors shrink-0 bg-primary text-white hover:bg-primary-hover"
        >
          + Add task
        </button>
      </div>

      {showAdd && (
        <AddTaskPanel
          members={members}
          todayIso={todayIso}
          categories={categories}
          onCreateCategory={createCategory}
          tags={tags}
          onCreateTag={createTag}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            router.refresh();
          }}
        />
      )}

      <p className="text-xs text-gray-400">
        Showing {filtered.length} of {allTasks.length} task{allTasks.length === 1 ? "" : "s"}.
      </p>

      {filtered.length === 0 ? (
        <Empty text="No tasks match these filters." />
      ) : (
        <div className="space-y-1.5">
          {filtered.map((t) => (
            <TaskListRow
              key={t.id}
              t={t}
              ownerName={nameOf(t.userId)}
              todayMs={todayMs}
              categories={categories}
              onCreateCategory={createCategory}
              tags={tags}
              onCreateTag={createTag}
              onSaved={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One Task List row. Collapsed it's a compact summary; clicking it expands to
// reveal the full description and — for live tasks — an inline editor a manager
// can use to fix the title, flesh out the description, re-prioritise, adjust the
// estimate/actual, or change status. Edits PATCH /api/manager/tasks/:id and the
// parent refreshes the server list on success. Deferred originals are audit rows
// and stay read-only.
function TaskListRow({
  t,
  ownerName,
  todayMs,
  categories,
  onCreateCategory,
  tags,
  onCreateTag,
  onSaved,
}: {
  t: AllTask;
  ownerName: string;
  todayMs: number;
  categories: Category[];
  onCreateCategory: (name: string) => Promise<Category | null>;
  tags: Tag[];
  onCreateTag: (name: string) => Promise<Tag | null>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes ?? "");
  const [priority, setPriority] = useState<Priority>(t.priority);
  const [status, setStatus] = useState<TaskStatus>(t.status);
  const [estimate, setEstimate] = useState(t.estimatedHours?.toString() ?? "");
  const [actual, setActual] = useState(t.actualHours?.toString() ?? "");
  const [category, setCategory] = useState<string | null>(t.categoryId);
  const [selectedTags, setSelectedTags] = useState<Tag[]>(t.tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Inline title edit on the summary line — a quick rename without expanding the
  // full "Edit details" panel. Kept separate from the panel's `editing` state.
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(t.title);

  const overdue = t.status !== "DONE" && !t.deferredToDate && new Date(t.date).getTime() < todayMs;
  const editable = !t.deferredToDate; // deferred originals are immutable records
  const catName = categoryName(categories, t.categoryId);

  function startEdit() {
    setTitle(t.title);
    setNotes(t.notes ?? "");
    setPriority(t.priority);
    setStatus(t.status);
    setEstimate(t.estimatedHours?.toString() ?? "");
    setActual(t.actualHours?.toString() ?? "");
    setCategory(t.categoryId);
    setSelectedTags(t.tags);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const tt = title.trim();
    if (!tt) { setError("Title can't be empty."); return; }
    if (estimate !== "" && (!Number.isFinite(Number(estimate)) || Number(estimate) <= 0)) {
      setError("If you set an estimate, it must be a positive number of hours.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/manager/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: tt,
        notes: notes.trim(),
        priority,
        status,
        estimatedHours: estimate === "" ? null : Number(estimate),
        actualHours: actual === "" ? null : Number(actual),
        categoryId: category,
        tagIds: selectedTags.map((x) => x.id),
      }),
    });
    if (res.ok) {
      setEditing(false);
      setBusy(false);
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to save changes.");
      setBusy(false);
    }
  }

  // Quick rename from the summary line. Manager PATCH bypasses the day-lock, so
  // the only guard is the immutable deferred-original (excluded via `editable`).
  async function saveTitle() {
    const tt = titleDraft.trim();
    setTitleEditing(false);
    if (!tt || tt === t.title) { setTitleDraft(t.title); return; }
    const res = await fetch(`/api/manager/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: tt }),
    });
    if (res.ok) {
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to rename task.");
      setTitleDraft(t.title);
    }
  }

  function cancelTitle() {
    setTitleDraft(t.title);
    setTitleEditing(false);
  }

  // Delete the task outright. Managers/admins can remove any task (the API also
  // allows a task's own creator); the parent refreshes the list on success.
  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/tasks/${t.id}`, { method: "DELETE" });
    if (res.ok) {
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to delete task.");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  const inputCls = "border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f4502e55]";

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      {/* Summary line — click to expand/collapse. A div (not a button) so the
          inline title input/controls can nest without invalid button-in-button. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); }
        }}
        className="w-full text-left flex items-center gap-3 px-3 py-2.5 flex-wrap hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <span className={cn("w-2 h-2 rounded-full shrink-0", t.deferredToDate ? "bg-amber-400" : STATUS_META[t.status].dot)} />
        <span className="text-[11px] font-mono text-gray-400 shrink-0 tabular-nums" title="Task ID">Task-{t.seq}</span>
        {titleEditing ? (
          <span className="flex items-center gap-1 flex-1 min-w-[8rem]" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); saveTitle(); }
                if (e.key === "Escape") { e.preventDefault(); cancelTitle(); }
              }}
              aria-label="Edit task title"
              className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#f4502e55]"
            />
            <button type="button" onClick={(e) => { e.stopPropagation(); saveTitle(); }} title="Save title" className="text-xs font-medium text-primary hover:opacity-80 shrink-0">Save</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); cancelTitle(); }} title="Cancel" className="text-xs text-gray-400 hover:text-gray-600 shrink-0">Cancel</button>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 flex-1 min-w-[8rem]">
            <span className={cn("text-sm break-words", t.status === "DONE" ? "line-through text-gray-400" : "text-gray-800")}>{t.title}</span>
            {/* Pencil — quick rename; hidden for deferred originals (immutable). */}
            {editable && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setTitleDraft(t.title); setTitleEditing(true); }}
                title="Edit title"
                aria-label="Edit task title"
                className="text-gray-300 hover:text-primary shrink-0 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </span>
        )}
        <span className="text-xs text-gray-500 shrink-0">{ownerName}</span>
        <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[t.priority].badge)}>{PRIORITY_META[t.priority].label}</span>
        {catName && <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 bg-indigo-100 text-indigo-700">{catName}</span>}
        {t.tags.length > 0 && <TagBadges tags={t.tags} className="shrink-0" />}
        {t.deferredToDate ? (
          <span className="text-xs rounded px-2 py-0.5 shrink-0 bg-amber-100 text-amber-700 font-medium">Deferred → {fmtShortDate(t.deferredToDate)}</span>
        ) : (
          <span className={cn("text-xs rounded px-2 py-0.5 shrink-0", STATUS_META[t.status].badge)}>{STATUS_META[t.status].label}</span>
        )}
        <span className="text-xs text-gray-400 shrink-0">est {fmtHours(t.estimatedHours)} · act {fmtHours(t.actualHours)}</span>
        <span className={cn("text-xs rounded px-2 py-0.5 shrink-0", overdue ? "bg-primary-soft text-primary font-medium" : "text-gray-400")}>
          {overdue ? "overdue · " : ""}{fmtShortDate(t.date)}
        </span>
        <svg className={cn("w-4 h-4 text-gray-400 transition-transform shrink-0", open && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Detail / edit panel */}
      {open && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3 space-y-3">
          {!editing ? (
            <>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Description</p>
                {t.notes ? (
                  <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{t.notes}</p>
                ) : (
                  <p className="text-sm text-gray-400 italic">No description yet.</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {editable && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="text-xs font-medium bg-white border border-gray-200 hover:border-primary hover:text-primary rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Edit details
                  </button>
                )}
                {confirmingDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Delete Task-{t.seq}?</span>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="text-xs font-medium bg-primary hover:bg-primary-hover disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
                    >
                      {deleting ? "Deleting…" : "Yes, delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={deleting}
                      className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="text-xs font-medium bg-white border border-gray-200 text-gray-500 hover:border-primary hover:text-primary rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Delete task
                  </button>
                )}
              </div>
              {error && <p className="text-sm text-primary">{error}</p>}
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={cn(inputCls, "w-full")} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Description</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="Add context, acceptance criteria, links…"
                  className={cn(inputCls, "w-full resize-y")}
                />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={cn(inputCls, "bg-white")}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{PRIORITY_META[p].label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={cn(inputCls, "bg-white")}>
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_META[s].label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Category</label>
                  <CategorySelect
                    categories={categories}
                    value={category}
                    onChange={setCategory}
                    onCreate={onCreateCategory}
                    className="w-44"
                  />
                </div>
                <div className="min-w-[12rem] flex-1">
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Tags</label>
                  <TagInput
                    value={selectedTags}
                    onChange={setSelectedTags}
                    suggestions={tags}
                    onCreate={onCreateTag}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Estimate (h)</label>
                  <input type="number" min="0.5" step="0.5" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="—" className={cn(inputCls, "w-24")} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Actual (h)</label>
                  <input type="number" min="0" step="0.5" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="—" className={cn(inputCls, "w-24")} />
                </div>
              </div>
              {error && <p className="text-sm text-primary">{error}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || !title.trim()}
                  className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium text-sm px-5 py-2 rounded-lg transition-colors"
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setError(null); }}
                  className="text-sm text-gray-500 hover:text-gray-800 px-3 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Manager affordance on the Task List: drop a task straight onto a member's day.
// A deliberate override — it bypasses the member's day-plan lock (same posture as
// reassign), so a lead can assign work to any day. Estimate is optional; the
// member can fill it in. On success the parent refreshes the server list.
// Manager/admin "Add task" — a modal dialog that assigns a task straight to a
// member's day. Mirrors the My Day "Log unplanned work" modal (pop-up over a
// dimmed backdrop, Esc / click-outside / Cancel to close, body scroll lock,
// labeled roomy fields, multi-line notes) so both add-task surfaces feel the same.
function AddTaskPanel({
  members,
  todayIso,
  categories,
  onCreateCategory,
  tags,
  onCreateTag,
  onClose,
  onCreated,
}: {
  members: { id: string; name: string | null; email: string | null }[];
  todayIso: string;
  categories: Category[];
  onCreateCategory: (name: string) => Promise<Category | null>;
  tags: Tag[];
  onCreateTag: (name: string) => Promise<Tag | null>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const todayInput = todayIso.slice(0, 10); // YYYY-MM-DD (todayIso is UTC midnight)
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [estimate, setEstimate] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [date, setDate] = useState(todayInput);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape, and lock body scroll while open so the page behind doesn't
  // move under the overlay. Skip closing mid-save to avoid dropping an in-flight
  // request.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [busy, onClose]);

  const fieldCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f4502e55]";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!userId) { setError("Pick a member to assign this to."); return; }
    if (!t) { setError("Give the task a title."); return; }
    if (estimate !== "" && (!Number.isFinite(Number(estimate)) || Number(estimate) <= 0)) {
      setError("If you set an estimate, it must be a positive number of hours.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/manager/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        title: t,
        priority,
        estimatedHours: estimate === "" ? undefined : Number(estimate),
        categoryId: category,
        tagIds: selectedTags.map((x) => x.id),
        date,
        notes: notes.trim() || undefined,
      }),
    });
    if (res.ok) {
      onCreated();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to create the task.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Add a task"
        className="w-full max-w-lg my-8 bg-white rounded-2xl border border-gray-200 shadow-xl p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add a task</h2>
            <p className="text-xs text-gray-400 mt-1">
              Assigns straight to a member&apos;s day — pick who it lands on and the day it belongs to.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none px-1"
          >
            ×
          </button>
        </div>

        <div>
          <label className={labelCls}>What needs doing?</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Draft the Q3 launch checklist"
            autoFocus
            className={fieldCls}
          />
        </div>

        <div>
          <label className={labelCls}>Assign to</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={cn(fieldCls, "bg-white")}>
            <option value="">Pick a member…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.email}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Notes / context (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Add any context — background, links, acceptance criteria…"
            className={cn(fieldCls, "resize-y min-h-[5rem]")}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={cn(fieldCls, "bg-white")}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_META[p].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Estimate (optional)</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                placeholder="Hours"
                className={cn(fieldCls, "flex-1")}
              />
              <span className="text-sm text-gray-400">h</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Category</label>
            <CategorySelect
              categories={categories}
              value={category}
              onChange={setCategory}
              onCreate={onCreateCategory}
              className="w-full"
            />
          </div>
          <div>
            <label className={labelCls}>Day this task lands on</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={fieldCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Tags (optional)</label>
          <TagInput
            value={selectedTags}
            onChange={setSelectedTags}
            suggestions={tags}
            onCreate={onCreateTag}
            className="w-full"
          />
        </div>

        {error && <p className="text-sm text-primary">{error}</p>}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !userId || !title.trim()}
            className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium text-sm px-5 py-2 rounded-lg transition-colors"
          >
            {busy ? "Adding…" : "Add task"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Discipline ---------------- */

// 0–100 consistency score → tone + label. Reflects "did they plan + follow
// through", not raw output. Purpose is nudging, not micromanagement.
function disciplineTone(score: number): { label: string; text: string; bg: string; dot: string } {
  if (score >= 80) return { label: "Strong", text: "text-emerald-700", bg: "bg-emerald-100", dot: "bg-emerald-500" };
  if (score >= 60) return { label: "Steady", text: "text-blue-700", bg: "bg-blue-100", dot: "bg-blue-500" };
  if (score >= 40) return { label: "Patchy", text: "text-amber-700", bg: "bg-amber-100", dot: "bg-amber-500" };
  return { label: "Slipping", text: "text-primary", bg: "bg-primary-soft", dot: "bg-primary" };
}

function lastActiveLabel(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function DisciplineWatch({ members }: { members: Member[] }) {
  // Surface people who aren't keeping their plan updated: no plan today, or a
  // low trailing score. Sort worst-first so laggards are obvious.
  const flagged = members
    .filter((m) => !m.discipline.plannedToday || m.discipline.score < 60)
    .sort((a, b) => a.discipline.score - b.discipline.score);

  return (
    <Card title="Discipline watch" className="mb-6">
      <p className="text-xs text-gray-400 -mt-2 mb-4">
        Planning consistency &amp; follow-through over the last 2 weeks. Higher means they set a plan most days and finish what they start.
      </p>
      {flagged.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-4 py-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          Everyone planned today and is keeping a steady cadence. Nice.
        </div>
      ) : (
        <div className="space-y-2">
          {flagged.map((m) => {
            const t = disciplineTone(m.discipline.score);
            return (
              <div key={m.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-semibold text-gray-600 shrink-0">
                  {(m.name || m.email || "?")[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{m.name || m.email}</p>
                  <p className="text-xs text-gray-400">
                    planned {m.discipline.daysPlanned}/{m.discipline.activeDays} days · {m.discipline.completionPct}% done · active {lastActiveLabel(m.discipline.lastActiveIso)}
                  </p>
                </div>
                {!m.discipline.plannedToday && (
                  <span className="text-xs bg-primary-soft text-primary px-2 py-0.5 rounded font-medium shrink-0">No plan today</span>
                )}
                <div className="flex items-center gap-1.5 shrink-0 w-24 justify-end">
                  <span className={cn("w-2 h-2 rounded-full", t.dot)} />
                  <span className={cn("text-xs font-semibold px-2 py-0.5 rounded", t.bg, t.text)}>{m.discipline.score} · {t.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ---------------- Person board card ---------------- */

// One small card per person showing what they're doing right now. Deferred
// originals are excluded — they're a record of what slipped, not live work.
function currentActivity(m: Member): { text: string; tone: "active" | "idle" | "done" | "none" } {
  const live = m.tasks.filter((t) => !t.deferredToDate);
  if (live.length === 0) return { text: "No plan set today", tone: "none" };
  const inProgress = live.find((t) => t.status === "IN_PROGRESS");
  if (inProgress) return { text: inProgress.title, tone: "active" };
  const hold = live.find((t) => t.status === "HOLD");
  if (hold) return { text: `On hold: ${hold.title}`, tone: "idle" };
  if (live.every((t) => t.status === "DONE")) return { text: "Wrapped up everything", tone: "done" };
  const todo = live.find((t) => t.status === "TODO");
  if (todo) return { text: `Next: ${todo.title}`, tone: "idle" };
  return { text: live[0].title, tone: "idle" };
}

function plannedHours(m: Member): number {
  return m.tasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0);
}

function deferredCount(m: Member): number {
  return m.tasks.filter((t) => t.deferredToDate).length;
}

// Short date label for a deferral target, e.g. "Jun 27". The value is a `@db.Date`
// (UTC midnight), so format in UTC to render the stored calendar day everywhere.
function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

const CARD_NOTES_LIMIT = 5;

function PersonCard({ m }: { m: Member }) {
  const [showAllNotes, setShowAllNotes] = useState(false);
  const c = countByStatus(m.tasks);
  const act = currentActivity(m);
  const dt = disciplineTone(m.discipline.score);
  const doneOf = `${c.DONE}/${m.tasks.length}`;
  const noted = m.tasks.filter((t) => t.notes);
  const visibleNotes = showAllNotes ? noted : noted.slice(0, CARD_NOTES_LIMIT);
  const hiddenNotes = noted.length - visibleNotes.length;
  const planned = plannedHours(m);
  const overplanned = planned > WORKDAY_HOURS;
  const activityColor =
    act.tone === "active" ? "text-amber-700 bg-amber-50" :
    act.tone === "done" ? "text-emerald-700 bg-emerald-50" :
    act.tone === "none" ? "text-primary bg-primary-soft" :
    "text-gray-600 bg-gray-50";

  return (
    <div className="border border-gray-200 rounded-xl p-3.5 flex flex-col gap-2.5 hover:border-gray-300 transition-colors">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 bg-primary-soft rounded-full flex items-center justify-center text-sm font-semibold text-primary shrink-0">
          {(m.name || m.email || "?")[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{m.name || m.email}</p>
          <p className="text-xs text-gray-400 truncate">{m.team || "No team"}</p>
        </div>
        <span title={`Discipline ${m.discipline.score}/100 · ${dt.label}`} className={cn("text-xs font-semibold px-1.5 py-0.5 rounded shrink-0", dt.bg, dt.text)}>
          {m.discipline.score}
        </span>
      </div>

      <div className={cn("text-xs rounded-lg px-2.5 py-2 leading-snug line-clamp-2", activityColor)}>
        {act.tone === "active" && <span className="font-semibold">Now: </span>}
        {act.text}
      </div>

      {noted.length > 0 && (
        <div className="space-y-1">
          {visibleNotes.map((t) => (
            <p key={t.id} className="text-xs text-gray-500 leading-snug line-clamp-2">
              <span className="text-gray-400">📝 {t.title}: </span>
              {t.notes}
            </p>
          ))}
          {hiddenNotes > 0 && (
            <button
              type="button"
              onClick={() => setShowAllNotes(true)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Read more ({hiddenNotes} more)
            </button>
          )}
          {showAllNotes && noted.length > CARD_NOTES_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllNotes(false)}
              className="text-xs font-medium text-gray-400 hover:underline"
            >
              Show less
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {TASK_STATUSES.map((s) =>
          c[s] > 0 ? (
            <span key={s} className="inline-flex items-center gap-1 text-xs text-gray-500">
              <span className={cn("w-2 h-2 rounded-full", STATUS_META[s].dot)} />
              {c[s]}
            </span>
          ) : null
        )}
        {m.tasks.length > 0 && <span className="text-xs text-gray-400 ml-auto">{doneOf} done</span>}
        {doneExtra(m) > 0 && <span title="Finished today but not on today's plan (carried over)" className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">+{doneExtra(m)} beyond plan</span>}
        {deferredCount(m) > 0 && <span title="Committed tasks deferred to a later day" className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">{deferredCount(m)} deferred</span>}
        {m.overdue > 0 && <span className="text-xs bg-primary-soft text-primary px-1.5 py-0.5 rounded font-medium">{m.overdue} overdue</span>}
        {overplanned && (
          <span title={`Planned ${fmtHours(planned)} — over the ~${WORKDAY_HOURS}h day`} className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
            ⚠ {fmtHours(planned)}
          </span>
        )}
      </div>

      <AssignTaskForm memberId={m.id} memberName={m.name || m.email || "this member"} />
    </div>
  );
}

/* ---------------- Assign task to a member ---------------- */

// Lets a manager/admin drop a task into a member's personal queue with a
// priority. The item lands in their backlog (stamped "Assigned"); they promote
// it into a day when ready, and the priority carries through so they can plan
// around it. Collapsed by default to keep the cards compact.
function AssignTaskForm({ memberId, memberName }: { memberId: string; memberName: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [estimate, setEstimate] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    // Estimate is optional here. If given, it must be positive; otherwise the
    // member supplies one before pulling the task into their day's goal.
    let estimatedHours: number | null = null;
    if (estimate !== "") {
      const est = Number(estimate);
      if (!Number.isFinite(est) || est <= 0) {
        setError("If you set an estimate, it must be a positive number of hours.");
        return;
      }
      estimatedHours = est;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/manager/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: memberId, title: t, estimatedHours, priority }),
    });
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setEstimate("");
      setPriority("MEDIUM");
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to assign task.");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs font-medium text-primary hover:underline"
      >
        + Assign task
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 bg-gray-50 border border-gray-100 rounded-lg p-2.5">
      <p className="text-xs text-gray-500">Assign to {memberName}&apos;s queue</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#f4502e55]"
      />
      <div className="flex items-center gap-2">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          title="Priority"
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#f4502e55]"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_META[p].label}</option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="Est."
            title="Effort estimate (optional — the member can set this before starting)"
            className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#f4502e55]"
          />
          <span className="text-xs text-gray-400">h</span>
        </div>
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-medium text-xs px-3 py-1.5 rounded-lg transition-colors"
        >
          {busy ? "Assigning…" : "Assign"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Close
        </button>
      </div>
      {error && <p className="text-xs text-primary">{error}</p>}
      {done && <p className="text-xs text-emerald-600">Added to their queue.</p>}
    </form>
  );
}

/* ---------------- Shared primitives ---------------- */

function countByStatus(tasks: Task[]): Record<TaskStatus, number> {
  const c: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, HOLD: 0, DONE: 0 };
  for (const t of tasks) c[t.status]++;
  return c;
}

function Header({ title, subtitle, right }: { title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="text-gray-500">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

function StatCard({ label, value, accent, hint, alert }: { label: string; value: string; accent: string; hint?: string; alert?: boolean }) {
  return (
    <div className={cn("bg-white rounded-xl border p-4", alert ? "border-[#f6cabc]" : "border-gray-200")}>
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <p className="text-2xl font-bold mt-1 leading-tight" style={{ color: accent }}>{value}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-white rounded-xl border border-gray-200 p-5", className)}>
      <h2 className="font-semibold text-gray-800 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Pill({ tone, children }: { tone: "ok" | "danger"; children: React.ReactNode }) {
  return (
    <span className={cn("px-3 py-1.5 rounded-lg font-medium", tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-primary-soft text-primary")}>
      {children}
    </span>
  );
}

function Empty({ text }: { text: React.ReactNode }) {
  return <div className="text-center py-8 text-sm text-gray-400">{text}</div>;
}

function Donut({ counts, total }: { counts: Record<TaskStatus, number>; total: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const segments = TASK_STATUSES.map((s) => {
    const frac = total ? counts[s] / total : 0;
    const seg = { color: STATUS_META[s].hex, dash: frac * c, offset };
    offset += frac * c;
    return seg;
  });

  return (
    <div className="flex justify-center py-2">
      <div className="relative w-40 h-40">
        <svg viewBox="0 0 140 140" className="w-40 h-40 -rotate-90">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#f1f2f4" strokeWidth="16" />
          {total > 0 &&
            segments.map((seg, i) => (
              <circle
                key={i}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth="16"
                strokeDasharray={`${seg.dash} ${c - seg.dash}`}
                strokeDashoffset={-seg.offset}
              />
            ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-gray-900">{total}</span>
          <span className="text-xs text-gray-400">tasks</span>
        </div>
      </div>
    </div>
  );
}

function Legend({ counts }: { counts: Record<TaskStatus, number> }) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-4">
      {TASK_STATUSES.map((s) => (
        <div key={s} className="flex items-center gap-2 text-sm">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_META[s].hex }} />
          <span className="text-gray-600">{STATUS_META[s].label}</span>
          <span className="text-gray-400 ml-auto">{counts[s]}</span>
        </div>
      ))}
    </div>
  );
}
