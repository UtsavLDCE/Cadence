"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { CategorySelect, useCategories, categoryName, type Category } from "@/components/category-select";
import { ScopeToggle, type Scope } from "@/components/scope-toggle";
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
  scope?: Scope;
  todayIso: string;
  cutoffTime: string;
  myTasks: Task[];
  myOverdue: Task[];
  members: Member[];
  pendingTasks?: PendingTask[];
};

export function DashboardClient({ isManager, scope = "org", todayIso, cutoffTime, myTasks, myOverdue, members, pendingTasks = [] }: Props) {
  const todayLabel = formatDate(new Date(todayIso));

  if (!isManager) return <MemberView todayLabel={todayLabel} tasks={myTasks} overdue={myOverdue} />;

  return <ManagerView todayLabel={todayLabel} todayIso={todayIso} cutoffTime={cutoffTime} members={members} pendingTasks={pendingTasks} scope={scope} />;
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
        <div className="flex items-start gap-3 mb-5 bg-[#fdf7ec] border border-[#f0e2c4] text-[#a8791f] rounded-xl px-4 py-3 text-sm">
          <span className="mt-0.5 text-base leading-none">⚠️</span>
          <div>
            <p className="font-semibold">You&apos;re overplanning.</p>
            <p className="text-[#c08a2d]">
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
        <StatCard label="Overdue" value={String(overdue.length)} accent="#e0533a" />
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
              <div className="h-2 rounded-full bg-[#f2eee7] overflow-hidden mb-3">
                <div className="h-full bar-fill bg-[#3f8a5b]" style={{ width: `${progress}%` }} />
              </div>
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-1.5 border-b border-[#f6f4f1] last:border-0">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_META[t.status].dot)} />
                  <p className={cn("text-sm flex-1 break-words", t.status === "DONE" ? "line-through text-[#b0a99e]" : "text-[#2c2925]")}>{t.title}</p>
                  <span className="text-xs text-[#b0a99e] shrink-0">{fmtHours(t.estimatedHours)}</span>
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

function ManagerView({ todayLabel, todayIso, cutoffTime, members, pendingTasks, scope }: { todayLabel: string; todayIso: string; cutoffTime: string; members: Member[]; pendingTasks: PendingTask[]; scope: Scope }) {
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

  // Load bars use planned hours per member (the "Today's load by member" panel).
  const loadRanked = [...members].sort((a, b) => plannedHours(b) - plannedHours(a));
  const maxPlanned = loadRanked.reduce((mx, m) => Math.max(mx, plannedHours(m)), 0) || 1;

  // Donut conic-gradient segments (cumulative %), matching the Legend order.
  const donutTotal = allTasks.length || 1;
  let acc = 0;
  const donutStops = TASK_STATUSES.map((s) => {
    const start = (acc / donutTotal) * 100;
    acc += counts[s];
    const end = (acc / donutTotal) * 100;
    return `${STATUS_META[s].hex} ${start}% ${end}%`;
  }).join(",");

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-[22px] gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1c1a17] m-0">{scope === "team" ? "My team" : "Organization"}</h1>
          <div className="mono text-xs tracking-[0.06em] text-[#b0a99e] mt-1 uppercase">{todayLabel} · Cutoff {cutoffTime}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ScopeToggle current={scope} />
          <span className="text-xs font-semibold text-[#3f8a5b] bg-[#e9f4ec] px-3 py-1.5 rounded-lg">{planned}/{members.length} planned</span>
          {noPlan.length > 0 && <span className="text-xs font-semibold text-[#c08a2d] bg-[#f8f0dd] px-3 py-1.5 rounded-lg">{noPlan.length} no plan</span>}
          {totalOverdue > 0 && <span className="text-xs font-semibold text-primary bg-primary-soft px-3 py-1.5 rounded-lg">{totalOverdue} overdue</span>}
        </div>
      </div>

      {/* stat cards — risks first, then throughput and load */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-[22px]">
        <MiniStat label="Tasks today" value={String(allTasks.length)} sub={`${counts.DONE} done · ${counts.TODO} to do`} />
        <MiniStat label="In progress" value={String(counts.IN_PROGRESS)} color={STATUS_META.IN_PROGRESS.hex} sub={`${counts.HOLD} on hold · ${totalDeferred} deferred`} />
        <MiniStat label="Done today" value={String(totalDoneToday)} color={STATUS_META.DONE.hex} sub={`${teamDoneRate}% of today's plan`} />
        <MiniStat label="Overdue" value={String(totalOverdue)} color={totalOverdue ? "#c0392b" : undefined} sub={totalOverdue ? "needs attention" : "all clear"} />
        <MiniStat label="No plan today" value={String(noPlan.length)} color={noPlan.length ? "#c08a2d" : undefined} sub={`${planned}/${members.length} planned`} />
        <MiniStat label="Backlog" value={String(totalPending)} sub={highPending ? `${highPending} high priority` : "pending, all days"} />
        <MiniStat label="Team load" value={`${loadPct}%`} color={loadPct > 100 ? "#c08a2d" : undefined} sub={`${fmtHours(totalPlannedHours)} / ${capacityHours}h${overloaded ? ` · ${overloaded} over` : ""}`} />
        <MiniStat label="Discipline" value={String(avgDiscipline)} color={avgDiscipline >= 75 ? "#3f8a5b" : avgDiscipline >= 60 ? "#c08a2d" : "#c0392b"} sub="team avg · 14d" />
      </div>

      {/* distribution + load by member */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-[22px] mb-[22px]">
        <div className="bg-white border border-[#ece8e1] rounded-2xl p-[22px]">
          <div className="text-sm font-semibold mb-4">Status distribution</div>
          <div className="flex items-center gap-[22px]">
            <div className="relative w-[132px] h-[132px] shrink-0">
              <div className="w-[132px] h-[132px] rounded-full" style={{ background: allTasks.length ? `conic-gradient(${donutStops})` : "#f0ece5" }} />
              <div className="absolute inset-[22px] rounded-full bg-white flex flex-col items-center justify-center">
                <span className="mono text-[26px] font-semibold leading-none">{allTasks.length}</span>
                <span className="text-[11px] text-[#b0a99e]">tasks</span>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-x-5 gap-y-3">
              {TASK_STATUSES.map((s) => (
                <div key={s} className="flex items-center gap-2 text-[13px]">
                  <span className="w-[9px] h-[9px] rounded-[2px]" style={{ background: STATUS_META[s].hex }} />
                  {STATUS_META[s].label}
                  <span className="mono ml-auto text-[#6b665f]">{counts[s]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#ece8e1] rounded-2xl p-[22px]">
          <div className="text-sm font-semibold mb-4">Today&apos;s load by member</div>
          {members.length === 0 ? (
            <Empty text="No team members yet." />
          ) : (
            <div className="flex flex-col gap-[13px]">
              {loadRanked.map((m) => {
                const ph = plannedHours(m);
                const noplan = m.tasks.length === 0;
                return (
                  <div key={m.id} className="flex items-center gap-3">
                    <span className={cn("w-[120px] text-[13px] shrink-0 truncate", noplan ? "text-[#b0a99e]" : "text-[#6b665f]")}>{m.name || m.email}</span>
                    <div className="flex-1 h-2.5 rounded-[5px] bg-[#f0ece5] overflow-hidden">
                      <div className="h-full bar-fill bg-primary" style={{ width: `${(ph / maxPlanned) * 100}%` }} />
                    </div>
                    <span className={cn("mono w-11 text-right text-xs", noplan ? "text-[#c08a2d]" : "text-[#6b665f]")}>{noplan ? "no plan" : fmtHours(ph)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
                  <p className="text-sm font-medium text-[#1c1a17]">{m.name || m.email}</p>
                  {m.team && <p className="text-xs text-[#9c968d]">{m.team}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Who's doing what */}
      <div className="bg-white rounded-2xl border border-[#ece8e1] p-[22px]">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <span className="text-sm font-semibold text-[#1c1a17]">Who&apos;s doing what · right now</span>
          <div className="flex gap-0.5 bg-[#f6f4f1] border border-[#ece8e1] rounded-[9px] p-[3px]">
            <ViewTab active={view === "board"} onClick={() => setView("board")}>Board</ViewTab>
            <ViewTab active={view === "list"} onClick={() => setView("list")}>List</ViewTab>
            <ViewTab active={view === "done"} onClick={() => setView("done")}>Done today{totalDoneToday > 0 ? ` (${totalDoneToday})` : ""}</ViewTab>
            <ViewTab active={view === "pending"} onClick={() => setView("pending")}>Pending{totalPending > 0 ? ` (${totalPending})` : ""}</ViewTab>
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
              <div key={m.id} className="border border-[#f2eee7] rounded-lg">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : m.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#f6f4f1] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-primary-soft rounded-full flex items-center justify-center text-sm font-semibold text-primary">
                      {(m.name || m.email || "?")[0].toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-[#1c1a17]">{m.name || m.email}</p>
                      <p className="text-xs text-[#9c968d]">{m.team || "No team"} · {m.tasks.length} task{m.tasks.length === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.tasks.length === 0 && <span className="text-xs bg-primary-soft text-primary px-2 py-0.5 rounded font-medium">No plan</span>}
                    {c.DONE > 0 && <span className="text-xs bg-[#d6ecdd] text-[#357a4f] px-2 py-0.5 rounded font-medium">{c.DONE} done</span>}
                    {doneExtra(m) > 0 && <span title="Finished today but not on today's plan (carried over)" className="text-xs bg-[#eae6fb] text-[#6a5acd] px-2 py-0.5 rounded font-medium">+{doneExtra(m)} beyond plan</span>}
                    {c.HOLD > 0 && <span className="text-xs bg-[#eae6fb] text-[#6a5acd] px-2 py-0.5 rounded font-medium">{c.HOLD} hold</span>}
                    {deferredCount(m) > 0 && <span className="text-xs bg-[#f8f0dd] text-[#c08a2d] px-2 py-0.5 rounded font-medium">{deferredCount(m)} deferred</span>}
                    {m.overdue > 0 && <span className="text-xs bg-primary-soft text-primary px-2 py-0.5 rounded font-medium">{m.overdue} overdue</span>}
                    {plannedHours(m) > WORKDAY_HOURS && <span className="text-xs bg-[#f8f0dd] text-[#c08a2d] px-2 py-0.5 rounded font-medium">⚠ {fmtHours(plannedHours(m))} planned</span>}
                    <svg className={cn("w-4 h-4 text-[#b0a99e] transition-transform", open && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-3 pt-1 border-t border-[#f6f4f1] space-y-3">
                    {m.tasks.length === 0 ? (
                      <p className="text-sm text-[#b0a99e] py-2">No tasks planned today.</p>
                    ) : (
                      <div className="space-y-2 pt-2">
                        {m.tasks.map((t) => (
                          <div key={t.id}>
                            <div className="flex items-center gap-3">
                              <span className={cn("w-2 h-2 rounded-full shrink-0", t.deferredToDate ? "bg-amber-400" : STATUS_META[t.status].dot)} />
                              <p className={cn("text-sm flex-1 break-words", t.status === "DONE" ? "line-through text-[#b0a99e]" : t.deferredToDate ? "text-[#9c968d]" : "text-[#2c2925]")}>{t.title}</p>
                              <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[t.priority].badge)}>{PRIORITY_META[t.priority].label}</span>
                              <span className="text-xs text-[#b0a99e] shrink-0">est {fmtHours(t.estimatedHours)} · act {fmtHours(t.actualHours)}</span>
                              {t.deferredToDate ? (
                                <span className="text-xs rounded px-2 py-0.5 shrink-0 bg-[#f8f0dd] text-[#c08a2d] font-medium">
                                  Deferred → {fmtShortDate(t.deferredToDate)}
                                </span>
                              ) : (
                                <span className={cn("text-xs rounded px-2 py-0.5 shrink-0", STATUS_META[t.status].badge)}>{STATUS_META[t.status].label}</span>
                              )}
                            </div>
                            {t.deferredToDate && (
                              <p className="ml-5 mt-1 text-xs text-[#c08a2d]">
                                Reason: {t.deferralCause ? DEFERRAL_CAUSE_META[t.deferralCause].label : "—"}
                                {t.deferralNote ? ` · ${t.deferralNote}` : ""}
                              </p>
                            )}
                            {t.notes && (
                              <p className="ml-5 mt-1 text-xs text-[#9c968d] bg-[#f6f4f1] border border-[#f2eee7] rounded-md px-2.5 py-1.5 whitespace-pre-wrap break-words">
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
          <div key={m.id} className="border border-[#f2eee7] rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-[#e9f4ec] rounded-full flex items-center justify-center text-sm font-semibold text-[#357a4f] shrink-0">
                {(m.name || m.email || "?")[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[#1c1a17] truncate">{m.name || m.email}</p>
                <p className="text-xs text-[#9c968d]">{m.team || "No team"}</p>
              </div>
              <span className="text-xs bg-[#d6ecdd] text-[#357a4f] px-2 py-0.5 rounded font-medium shrink-0">
                {m.doneToday.length} done
              </span>
              {extra > 0 && (
                <span title="Completed today but not on today's plan" className="text-xs bg-[#eae6fb] text-[#6a5acd] px-2 py-0.5 rounded font-medium shrink-0">
                  +{extra} beyond plan
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {m.doneToday.map((t) => (
                <div key={t.id} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-[#3f8a5b]" />
                  <p className="text-sm flex-1 break-words text-[#4a453e]">{t.title}</p>
                  <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[t.priority].badge)}>{PRIORITY_META[t.priority].label}</span>
                  <span className="text-xs text-[#b0a99e] shrink-0">est {fmtHours(t.estimatedHours)} · act {fmtHours(t.actualHours)}</span>
                  {t.planned ? (
                    <span className="text-xs rounded px-2 py-0.5 shrink-0 bg-[#f2eee7] text-[#6b665f] font-medium">Today&apos;s plan</span>
                  ) : (
                    <span title="Carried over from an earlier day" className="text-xs rounded px-2 py-0.5 shrink-0 bg-[#eae6fb] text-[#6a5acd] font-medium">Carried over</span>
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
      <p className="text-xs text-[#b0a99e]">
        Every unfinished task on the team. Reassign one to move it to another member — it keeps its date, estimate, and priority.
      </p>
      {error && <p className="text-sm text-primary">{error}</p>}
      {ordered.map((t) => {
        const overdue = new Date(t.date).getTime() < todayMs;
        return (
          <div key={t.id} className="flex items-center gap-3 border border-[#f2eee7] rounded-lg px-3 py-2.5 flex-wrap">
            <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_META[t.status].dot)} />
            <p className="text-sm text-[#2c2925] flex-1 min-w-[8rem] break-words">{t.title}</p>
            <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[t.priority].badge)}>{PRIORITY_META[t.priority].label}</span>
            <span className={cn("text-xs rounded px-2 py-0.5 shrink-0", STATUS_META[t.status].badge)}>{STATUS_META[t.status].label}</span>
            <span className="text-xs text-[#b0a99e] shrink-0">est {fmtHours(t.estimatedHours)}</span>
            <span className={cn("text-xs rounded px-2 py-0.5 shrink-0", overdue ? "bg-primary-soft text-primary font-medium" : "text-[#b0a99e]")}>
              {overdue ? "overdue · " : ""}{fmtShortDate(t.date)}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-[#b0a99e]">→</span>
              <select
                value={t.userId}
                disabled={busy === t.id}
                onChange={(e) => reassign(t.id, e.target.value)}
                title="Reassign to another member"
                className="text-xs border border-[#ece8e1] rounded-lg px-2 py-1.5 bg-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
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

  const selectCls = "h-[38px] text-[13px] border border-[#e7e3dd] rounded-[10px] px-2.5 bg-white text-[#6b665f] focus:outline-none focus:ring-2 focus:ring-[#e0533a55]";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5 mb-2">
        <div className="flex-1 min-w-[12rem] flex items-center gap-2 bg-[#f6f4f1] border border-[#ece8e1] rounded-[10px] px-3 h-[38px]">
          <span className="text-[#c7c0b6] text-[13px]">⌕</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ID, title, or notes…"
            className="flex-1 min-w-0 border-none outline-none bg-transparent text-[13px]"
          />
        </div>
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
          className="h-[38px] text-[13px] font-semibold rounded-[10px] px-4 transition-colors shrink-0 bg-primary text-white hover:bg-primary-hover"
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

      <p className="text-xs text-[#b0a99e] px-1 py-2">
        Showing {filtered.length} of {allTasks.length} task{allTasks.length === 1 ? "" : "s"}.
      </p>

      {filtered.length === 0 ? (
        <Empty text="No tasks match these filters." />
      ) : (
        <div>
          {/* column header */}
          <div className={cn(TASK_ROW_GRID, "px-1 py-2 border-b border-[#ece8e1]")}>
            <span />
            <span className="mono text-[10px] tracking-[0.08em] text-[#b0a99e]">ID</span>
            <span className="text-[10px] tracking-[0.08em] text-[#b0a99e] uppercase">Task</span>
            <span className="text-[10px] tracking-[0.08em] text-[#b0a99e] uppercase">Owner</span>
            <span className="text-[10px] tracking-[0.08em] text-[#b0a99e] uppercase">Priority</span>
            <span className="text-[10px] tracking-[0.08em] text-[#b0a99e] uppercase">Status</span>
            <span className="mono text-[10px] tracking-[0.08em] text-[#b0a99e] text-right">EST · ACT</span>
            <span className="text-[10px] tracking-[0.08em] text-[#b0a99e] uppercase text-right">Date</span>
          </div>
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

// Shared grid template for the Task List header + data rows.
const TASK_ROW_GRID = "grid grid-cols-[26px_60px_minmax(0,1fr)_64px_78px_120px_132px_60px] items-center gap-3";

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

  const inputCls = "border border-[#ece8e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e0533a55]";

  return (
    <div className={cn(open && "bg-[#f6f4f1]/40 rounded-lg")}>
      {/* Summary line — dense grid; click to expand/collapse. A div (not a button)
          so the inline title input/controls can nest without invalid button-in-button. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); }
        }}
        className={cn(TASK_ROW_GRID, "w-full text-left px-1 py-3 border-b border-[#f2eee7] hover:bg-[#f6f4f1] transition-colors cursor-pointer")}
      >
        <span className={cn("w-2 h-2 rounded-full justify-self-center", t.deferredToDate ? "bg-amber-400" : STATUS_META[t.status].dot)} />
        <span className="mono text-[11px] text-[#b0a99e]" title="Task ID">Task-{t.seq}</span>
        {titleEditing ? (
          <span className="flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
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
              className="flex-1 min-w-0 text-sm border border-[#ece8e1] rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
            />
            <button type="button" onClick={(e) => { e.stopPropagation(); saveTitle(); }} title="Save title" className="text-xs font-medium text-primary hover:opacity-80 shrink-0">Save</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); cancelTitle(); }} title="Cancel" className="text-xs text-[#b0a99e] hover:text-[#6b665f] shrink-0">Cancel</button>
          </span>
        ) : (
          <span className="flex items-center gap-2 min-w-0">
            <span className={cn("text-sm truncate", t.status === "DONE" ? "line-through text-[#b0a99e]" : "text-[#1c1a17]")}>{t.title}</span>
            {catName && <span className="text-[10px] font-semibold rounded-[5px] px-[7px] py-0.5 shrink-0 bg-[#eae6fb] text-[#6a5acd]">{catName}</span>}
            {t.tags.length > 0 && <TagBadges tags={t.tags} className="shrink-0" />}
            {/* Pencil — quick rename; hidden for deferred originals (immutable). */}
            {editable && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setTitleDraft(t.title); setTitleEditing(true); }}
                title="Edit title"
                aria-label="Edit task title"
                className="text-[#ddd8d0] hover:text-primary shrink-0 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </span>
        )}
        <span className="text-xs text-[#9c968d] truncate">{ownerName}</span>
        <span className={cn("text-[10px] font-semibold rounded-md px-2 py-[3px] justify-self-start", PRIORITY_META[t.priority].badge)}>{PRIORITY_META[t.priority].label}</span>
        {t.deferredToDate ? (
          <span className="text-[10px] rounded-md px-2 py-[3px] justify-self-start bg-[#f8f0dd] text-[#c08a2d] font-semibold whitespace-nowrap">Deferred→{fmtShortDate(t.deferredToDate)}</span>
        ) : (
          <span className={cn("text-[10px] font-semibold rounded-md px-2 py-[3px] justify-self-start", STATUS_META[t.status].badge)}>{STATUS_META[t.status].label}</span>
        )}
        <span className="mono text-[11px] text-[#9c968d] text-right">{fmtHours(t.estimatedHours)} · {fmtHours(t.actualHours)}</span>
        <span className={cn("mono text-[11px] text-right leading-tight", overdue ? "text-[#c0392b]" : "text-[#9c968d]")}>
          {overdue && <>overdue<br /></>}{fmtShortDate(t.date)}
        </span>
      </div>

      {/* Detail / edit panel */}
      {open && (
        <div className="border-t border-[#f2eee7] bg-[#f6f4f1]/60 px-4 py-3 space-y-3">
          {!editing ? (
            <>
              <div>
                <p className="text-xs font-semibold text-[#9c968d] mb-1">Description</p>
                {t.notes ? (
                  <p className="text-sm text-[#4a453e] whitespace-pre-wrap break-words">{t.notes}</p>
                ) : (
                  <p className="text-sm text-[#b0a99e] italic">No description yet.</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {editable && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="text-xs font-medium bg-white border border-[#ece8e1] hover:border-primary hover:text-primary rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Edit details
                  </button>
                )}
                {confirmingDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#9c968d]">Delete Task-{t.seq}?</span>
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
                      className="text-xs text-[#9c968d] hover:text-[#2c2925] px-2 py-1.5"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="text-xs font-medium bg-white border border-[#ece8e1] text-[#9c968d] hover:border-primary hover:text-primary rounded-lg px-3 py-1.5 transition-colors"
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
                <label className="text-xs font-semibold text-[#9c968d] mb-1 block">Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={cn(inputCls, "w-full")} />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#9c968d] mb-1 block">Description</label>
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
                  <label className="text-xs font-semibold text-[#9c968d] mb-1 block">Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={cn(inputCls, "bg-white")}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{PRIORITY_META[p].label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#9c968d] mb-1 block">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={cn(inputCls, "bg-white")}>
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_META[s].label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#9c968d] mb-1 block">Category</label>
                  <CategorySelect
                    categories={categories}
                    value={category}
                    onChange={setCategory}
                    onCreate={onCreateCategory}
                    className="w-44"
                  />
                </div>
                <div className="min-w-[12rem] flex-1">
                  <label className="text-xs font-semibold text-[#9c968d] mb-1 block">Tags</label>
                  <TagInput
                    value={selectedTags}
                    onChange={setSelectedTags}
                    suggestions={tags}
                    onCreate={onCreateTag}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#9c968d] mb-1 block">Estimate (h)</label>
                  <input type="number" min="0.5" step="0.5" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="—" className={cn(inputCls, "w-24")} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#9c968d] mb-1 block">Actual (h)</label>
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
                  className="text-sm text-[#9c968d] hover:text-[#2c2925] px-3 py-2"
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

  const fieldCls = "w-full border border-[#ece8e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e0533a55]";
  const labelCls = "block text-xs font-medium text-[#6b665f] mb-1";

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
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-[#1c1a17]/40 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Add a task"
        className="w-full max-w-lg my-8 bg-white rounded-2xl border border-[#ece8e1] shadow-xl p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[#1c1a17]">Add a task</h2>
            <p className="text-xs text-[#b0a99e] mt-1">
              Assigns straight to a member&apos;s day — pick who it lands on and the day it belongs to.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-[#b0a99e] hover:text-[#6b665f] text-xl leading-none px-1"
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
              <span className="text-sm text-[#b0a99e]">h</span>
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
            className="text-sm text-[#9c968d] hover:text-[#4a453e] px-3 py-2"
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
function disciplineTone(score: number): { label: string; text: string; bg: string; dot: string; hex: string } {
  if (score >= 80) return { label: "Strong", text: "text-[#357a4f]", bg: "bg-[#d6ecdd]", dot: "bg-[#3f8a5b]", hex: "#3f8a5b" };
  if (score >= 60) return { label: "Steady", text: "text-blue-700", bg: "bg-blue-100", dot: "bg-blue-500", hex: "#3a6ea5" };
  if (score >= 40) return { label: "Patchy", text: "text-[#c08a2d]", bg: "bg-[#f8f0dd]", dot: "bg-[#c08a2d]", hex: "#c08a2d" };
  return { label: "Slipping", text: "text-primary", bg: "bg-primary-soft", dot: "bg-primary", hex: "#c0392b" };
}

// Badge colors for a discipline verdict, matching the mockup's status palette.
function verdictBadge(score: number): string {
  if (score >= 80) return "text-[#3f8a5b] bg-[#e9f4ec]";
  if (score >= 60) return "text-[#3f8a5b] bg-[#e9f4ec]";
  if (score >= 40) return "text-[#c08a2d] bg-[#f8f0dd]";
  return "text-[#c0392b] bg-[#fbe4de]";
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
    <div className="bg-white border border-[#ece8e1] rounded-2xl p-[22px] mb-[22px]">
      <div className="flex items-baseline justify-between mb-1 gap-3 flex-wrap">
        <span className="text-sm font-semibold text-[#1c1a17]">Discipline watch</span>
        <span className="text-xs text-[#b0a99e]">planning consistency &amp; follow-through · last 2 weeks</span>
      </div>
      <p className="text-xs text-[#9c968d] mt-0.5 mb-3.5">
        Higher means they set a plan most days and finish what they start. Signals, not scores.
      </p>
      {flagged.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-[#357a4f] bg-[#e9f4ec] rounded-lg px-4 py-3">
          <span className="w-2 h-2 rounded-full bg-[#3f8a5b]" />
          Everyone planned today and is keeping a steady cadence. Nice.
        </div>
      ) : (
        <div className="flex flex-col">
          {flagged.map((m) => {
            const t = disciplineTone(m.discipline.score);
            return (
              <div key={m.id} className="grid grid-cols-[1.4fr_1fr_100px_90px] items-center gap-3 py-3 border-t border-[#f2eee7]">
                <div className="flex items-center gap-[11px] min-w-0">
                  <span className="w-[30px] h-[30px] rounded-full bg-[#efe9e1] inline-flex items-center justify-center font-semibold text-[#8a8378] text-xs shrink-0">
                    {(m.name || m.email || "?")[0].toUpperCase()}
                  </span>
                  <span className="text-sm font-medium text-[#1c1a17] truncate">{m.name || m.email}</span>
                </div>
                <div className="mono text-xs text-[#9c968d]">
                  planned {m.discipline.daysPlanned}/{m.discipline.activeDays} days · {m.discipline.completionPct}% done · {m.discipline.plannedToday ? "active now" : `active ${lastActiveLabel(m.discipline.lastActiveIso)}`}
                </div>
                <div className="h-[7px] rounded-[4px] bg-[#f0ece5] overflow-hidden">
                  <div className="h-full bar-fill" style={{ width: `${Math.min(100, m.discipline.score)}%`, background: t.hex }} />
                </div>
                <span className={cn("text-[11px] font-semibold px-[9px] py-1 rounded-md text-center", verdictBadge(m.discipline.score))}>{t.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
    act.tone === "active" ? "text-[#c08a2d] bg-[#fdf7ec]" :
    act.tone === "done" ? "text-[#357a4f] bg-[#e9f4ec]" :
    act.tone === "none" ? "text-primary bg-primary-soft" :
    "text-[#6b665f] bg-[#f6f4f1]";

  return (
    <div className="border border-[#ece8e1] rounded-xl p-3.5 flex flex-col gap-2.5 hover:border-[#ddd8d0] transition-colors">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 bg-primary-soft rounded-full flex items-center justify-center text-sm font-semibold text-primary shrink-0">
          {(m.name || m.email || "?")[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[#1c1a17] truncate">{m.name || m.email}</p>
          <p className="text-xs text-[#b0a99e] truncate">{m.team || "No team"}</p>
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
            <p key={t.id} className="text-xs text-[#9c968d] leading-snug line-clamp-2">
              <span className="text-[#b0a99e]">📝 {t.title}: </span>
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
              className="text-xs font-medium text-[#b0a99e] hover:underline"
            >
              Show less
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {TASK_STATUSES.map((s) =>
          c[s] > 0 ? (
            <span key={s} className="inline-flex items-center gap-1 text-xs text-[#9c968d]">
              <span className={cn("w-2 h-2 rounded-full", STATUS_META[s].dot)} />
              {c[s]}
            </span>
          ) : null
        )}
        {m.tasks.length > 0 && <span className="text-xs text-[#b0a99e] ml-auto">{doneOf} done</span>}
        {doneExtra(m) > 0 && <span title="Finished today but not on today's plan (carried over)" className="text-xs bg-[#eae6fb] text-[#6a5acd] px-1.5 py-0.5 rounded font-medium">+{doneExtra(m)} beyond plan</span>}
        {deferredCount(m) > 0 && <span title="Committed tasks deferred to a later day" className="text-xs bg-[#f8f0dd] text-[#c08a2d] px-1.5 py-0.5 rounded font-medium">{deferredCount(m)} deferred</span>}
        {m.overdue > 0 && <span className="text-xs bg-primary-soft text-primary px-1.5 py-0.5 rounded font-medium">{m.overdue} overdue</span>}
        {overplanned && (
          <span title={`Planned ${fmtHours(planned)} — over the ~${WORKDAY_HOURS}h day`} className="text-xs bg-[#f8f0dd] text-[#c08a2d] px-1.5 py-0.5 rounded font-medium">
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
    <form onSubmit={submit} className="flex flex-col gap-2 bg-[#f6f4f1] border border-[#f2eee7] rounded-lg p-2.5">
      <p className="text-xs text-[#9c968d]">Assign to {memberName}&apos;s queue</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        className="border border-[#ece8e1] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
      />
      <div className="flex items-center gap-2">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          title="Priority"
          className="border border-[#ece8e1] rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
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
            className="w-16 border border-[#ece8e1] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
          />
          <span className="text-xs text-[#b0a99e]">h</span>
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
          className="text-xs text-[#b0a99e] hover:text-[#6b665f]"
        >
          Close
        </button>
      </div>
      {error && <p className="text-xs text-primary">{error}</p>}
      {done && <p className="text-xs text-[#3f8a5b]">Added to their queue.</p>}
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
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1c1a17]">{title}</h1>
        <p className="text-[#9c968d]">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

function StatCard({ label, value, accent, hint, alert }: { label: string; value: string; accent: string; hint?: string; alert?: boolean }) {
  return (
    <div className={cn("bg-white rounded-xl border p-4", alert ? "border-[#f6cabc]" : "border-[#ece8e1]")}>
      <p className="text-xs text-[#9c968d] truncate">{label}</p>
      <p className="text-2xl font-bold mt-1 leading-tight" style={{ color: accent }}>{value}</p>
      {hint && <p className="text-[11px] text-[#b0a99e] mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

// Compact team stat card (mockup style): muted label, big mono number, sub line.
function MiniStat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-[#ece8e1] rounded-2xl px-[17px] py-[15px]">
      <div className="text-xs text-[#9c968d]">{label}</div>
      <div className="mono text-[26px] font-semibold mt-1 leading-none" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-[#b0a99e] mt-0.5">{sub}</div>}
    </div>
  );
}

// Segmented view toggle pill used by "Who's doing what".
function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-xs px-3 py-[5px] rounded-md font-semibold transition-colors",
        active ? "text-primary bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]" : "text-[#9c968d] hover:text-[#2c2925]",
      )}
    >
      {children}
    </button>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-white rounded-xl border border-[#ece8e1] p-5", className)}>
      <h2 className="font-semibold text-[#2c2925] mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ text }: { text: React.ReactNode }) {
  return <div className="text-center py-8 text-sm text-[#b0a99e]">{text}</div>;
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
          <span className="text-3xl font-bold text-[#1c1a17]">{total}</span>
          <span className="text-xs text-[#b0a99e]">tasks</span>
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
          <span className="text-[#6b665f]">{STATUS_META[s].label}</span>
          <span className="text-[#b0a99e] ml-auto">{counts[s]}</span>
        </div>
      ))}
    </div>
  );
}
