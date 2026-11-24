"use client";

import { useEffect, useState } from "react";
import { fmtHours, STATUS_META, PRIORITY_META, type TaskStatus, type Priority } from "@/lib/task-status";

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  estimatedHours: number | null;
  actualHours: number | null;
  category?: { name: string } | null;
};

export type FeedRow = {
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

// Compact tile grid. A tile is a single summary (no inline task list) — clicking
// it opens a drawer with that person's full day. Keeps ~12 people on one screen.
export function FeedGrid({ rows, workday, minPlan, date }: { rows: FeedRow[]; workday: number; minPlan: number; date: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = rows.find((r) => r.user.id === openId) ?? null;

  // Close on Escape; lock body scroll while the drawer is open.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [selected]);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {rows.map((r) => (
          <Tile key={r.user.id} row={r} workday={workday} minPlan={minPlan} onOpen={() => setOpenId(r.user.id)} />
        ))}
      </div>

      {selected && <Drawer row={selected} date={date} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Tile({ row, workday, minPlan, onOpen }: { row: FeedRow; workday: number; minPlan: number; onOpen: () => void }) {
  const { user, planned, unplanned, deferred, done, plannedHours, plannedActual, submitted, goal, hasStandup, active } = row;
  const name = user.name || user.email || "Unknown";

  const overplanned = submitted && plannedHours > workday;
  const underplanned = submitted && plannedHours < minPlan;
  const plannedCls = overplanned ? "text-[#c08a2d]" : underplanned ? "text-[#c0533a]" : "text-[#9c968d]";

  const total = planned.length;
  const pct = total > 0 ? Math.round((done.length / total) * 100) : 0;

  return (
    <button
      type="button"
      data-feed-name={name.toLowerCase()}
      onClick={onOpen}
      className="text-left bg-white rounded-xl border border-[#ece8e1] p-4 flex flex-col hover:border-primary hover:shadow-sm transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
    >
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
          <div className="mt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-[#1c1a17]">
                {done.length}
                <span className="text-[#b0a99e] font-normal">/{total} done</span>
              </span>
              <span className="mono text-[11px] text-[#9c968d]">{pct}%</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-[#f0ece5] overflow-hidden">
              <div className="h-full rounded-full bg-[#3f8a5b]" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <p className="mono text-[11px] text-[#9c968d] mt-2">
            <span className={plannedCls}>{fmtHours(plannedHours || null)}</span> plan · {fmtHours(plannedActual || null)} act
            {unplanned.length > 0 && ` · ⚡${unplanned.length}`}
            {deferred.length > 0 && ` · ↪${deferred.length}`}
          </p>

          {/* Inline task list — titles clamp to 2 lines (full text on hover). */}
          {planned.length + unplanned.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {planned.map((t) => (
                <InlineTaskRow key={t.id} task={t} />
              ))}
              {unplanned.map((t) => (
                <InlineTaskRow key={t.id} task={t} unplanned />
              ))}
            </ul>
          )}

          <span className="text-[11px] text-primary mt-2 font-medium">View day →</span>
        </>
      )}
    </button>
  );
}

// Inline tile row: title clamps to 2 lines with the full subject on hover.
function InlineTaskRow({ task: t, unplanned }: { task: Task; unplanned?: boolean }) {
  const done = t.status === "DONE";
  return (
    <li className="flex items-start gap-2 text-sm py-0.5">
      {done ? (
        <span className="w-4 h-4 mt-0.5 shrink-0 rounded-full bg-[#3f8a5b] text-white flex items-center justify-center text-[10px] font-bold leading-none">
          ✓
        </span>
      ) : (
        <span className="w-4 h-4 mt-0.5 shrink-0 rounded-full border-[1.5px] border-[#d5cec2] flex items-center justify-center">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[t.status].dot}`} />
        </span>
      )}
      {unplanned && <span className="shrink-0 mt-0.5 text-[11px]" title="Came up unplanned">⚡</span>}
      <span
        title={t.title}
        className={`flex-1 min-w-0 break-words line-clamp-2 leading-snug ${done ? "text-[#9c968d] line-through decoration-[#d5cec2]" : "text-[#2c2925]"}`}
      >
        {t.title}
      </span>
      <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${PRIORITY_META[t.priority].badge}`}>
        {PRIORITY_META[t.priority].label}
      </span>
      <span className="mono text-[11px] text-[#b0a99e] shrink-0 w-16 text-right whitespace-nowrap">
        {t.actualHours != null ? fmtHours(t.actualHours) : `est ${fmtHours(t.estimatedHours)}`}
      </span>
    </li>
  );
}

type HistoryTask = Task & { date: string; unplanned: boolean; deferredToDate: string | null; deferredFromDate: string | null };
type HistoryDay = { date: string; submitted: boolean; goal: string | null; tasks: HistoryTask[] };

// Right-side slide-in drawer: one person's whole day. Overlay closes on click.
function Drawer({ row, date, onClose }: { row: FeedRow; date: string; onClose: () => void }) {
  const { user, planned, unplanned, deferred, done, plannedHours, plannedActual, unplannedActual, submitted, goal, hasStandup } = row;
  const name = user.name || user.email || "Unknown";

  // Last 7 days loaded lazily — only for the person actually opened.
  const [history, setHistory] = useState<HistoryDay[] | null>(null);
  const [histError, setHistError] = useState(false);
  useEffect(() => {
    let alive = true;
    setHistory(null);
    setHistError(false);
    fetch(`/api/feed/history?userId=${encodeURIComponent(user.id)}&date=${encodeURIComponent(date)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setHistory(d.days))
      .catch(() => alive && setHistError(true));
    return () => {
      alive = false;
    };
  }, [user.id, date]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name}'s day`}
        className="relative w-full sm:w-2/5 bg-[#faf8f5] h-full overflow-y-auto shadow-xl animate-[slideIn_0.18s_ease-out]"
      >
        <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>

        {/* Header */}
        <div className="sticky top-0 bg-[#faf8f5] border-b border-[#ece8e1] px-5 py-4 flex items-start gap-3">
          <span className="w-10 h-10 shrink-0 rounded-full bg-[#efe9e1] text-[#8a8378] flex items-center justify-center font-semibold">
            {name[0].toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-[#1c1a17] truncate">{name}</p>
            <p className="mono text-[10px] tracking-[0.08em] text-[#b0a99e]">{user.role}</p>
            <div className="flex items-center gap-2 mt-1.5">
              {submitted && <Pill label="Plan submitted" />}
              {hasStandup && <Pill label="Standup ✓" />}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-8 h-8 rounded-lg text-[#6b665f] hover:bg-[#ece8e1] flex items-center justify-center text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          {goal && <p className="text-sm text-[#6b665f] italic mb-3">Goal: {goal}</p>}

          <p className="mono text-xs text-[#9c968d] mb-4">
            {done.length} of {planned.length} planned done · {fmtHours(plannedHours || null)} planned vs {fmtHours(plannedActual || null)} actual
            {unplanned.length > 0 && ` · ${unplanned.length} unplanned (${fmtHours(unplannedActual || null)})`}
          </p>

          <Section title="Planned" tasks={planned} empty="No planned tasks." />
          {unplanned.length > 0 && <Section title="Came up unplanned ⚡" tasks={unplanned} />}
          {deferred.length > 0 && <Section title="Deferred to a later day ↪" tasks={deferred} />}

          <HistoryTimeline days={history} error={histError} selectedDate={date} />
        </div>
      </div>
    </div>
  );
}

function Section({ title, tasks, empty }: { title: string; tasks: Task[]; empty?: string }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-[#6b665f] mb-1.5 uppercase tracking-[0.04em]">
        {title} <span className="font-normal text-[#b0a99e]">· {tasks.length}</span>
      </p>
      {tasks.length === 0 ? (
        <p className="text-xs text-[#b0a99e]">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskRow({ task: t }: { task: Task }) {
  const done = t.status === "DONE";
  return (
    <li className="flex items-start gap-2 text-sm py-1 border-b border-[#f0ece5] last:border-0">
      {done ? (
        <span className="w-4 h-4 mt-0.5 shrink-0 rounded-full bg-[#3f8a5b] text-white flex items-center justify-center text-[10px] font-bold leading-none">
          ✓
        </span>
      ) : (
        <span className="w-4 h-4 mt-0.5 shrink-0 rounded-full border-[1.5px] border-[#d5cec2] flex items-center justify-center">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[t.status].dot}`} />
        </span>
      )}
      <span className={`flex-1 min-w-0 break-words leading-snug ${done ? "text-[#9c968d] line-through decoration-[#d5cec2]" : "text-[#2c2925]"}`}>
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
      <span className="mono text-[11px] text-[#b0a99e] shrink-0 w-16 text-right whitespace-nowrap">
        {t.actualHours != null ? fmtHours(t.actualHours) : `est ${fmtHours(t.estimatedHours)}`}
      </span>
    </li>
  );
}

// Last-7-days history timeline for the open person. Loaded lazily by the drawer.
function HistoryTimeline({ days, error, selectedDate }: { days: HistoryDay[] | null; error: boolean; selectedDate: string }) {
  return (
    <div className="mt-5 pt-4 border-t border-[#ece8e1]">
      <p className="text-xs font-semibold text-[#6b665f] mb-2 uppercase tracking-[0.04em]">Last 7 days</p>

      {error ? (
        <p className="text-xs text-[#c0533a]">Couldn&apos;t load history.</p>
      ) : days === null ? (
        <p className="text-xs text-[#b0a99e]">Loading…</p>
      ) : (
        <div className="space-y-3">
          {days.map((d) => {
            const dt = new Date(`${d.date}T00:00:00.000Z`);
            const label = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
            const plannedTasks = d.tasks.filter((t) => !t.unplanned && !t.deferredToDate);
            const doneCount = d.tasks.filter((t) => t.status === "DONE").length;
            return (
              <div key={d.date} className={d.date === selectedDate ? "rounded-lg bg-[#f4efe8] -mx-2 px-2 py-1.5" : ""}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#2c2925]">{label}</span>
                  {d.date === selectedDate && <span className="text-[10px] text-[#9c968d]">· viewing</span>}
                  {d.submitted ? (
                    <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-[#e9f4ec] text-[#3f8a5b]">submitted</span>
                  ) : d.tasks.length > 0 ? (
                    <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-[#f8f0dd] text-[#c08a2d]">not submitted</span>
                  ) : (
                    <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-[#f0ece5] text-[#9c968d]">no plan</span>
                  )}
                  {d.tasks.length > 0 && (
                    <span className="mono text-[10px] text-[#9c968d] ml-auto">{doneCount}/{plannedTasks.length} done</span>
                  )}
                </div>
                {d.goal && <p className="text-[11px] text-[#6b665f] italic mt-0.5 line-clamp-1" title={d.goal}>{d.goal}</p>}
                {d.tasks.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {d.tasks.map((t) => (
                      <HistoryTaskRow key={t.id} task={t} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HistoryTaskRow({ task: t }: { task: HistoryTask }) {
  const done = t.status === "DONE";
  const deferredAway = Boolean(t.deferredToDate);
  return (
    <li className="flex items-center gap-1.5 text-xs">
      <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${done ? "bg-[#3f8a5b]" : STATUS_META[t.status].dot}`} />
      {t.unplanned && <span className="shrink-0 text-[10px]" title="Came up unplanned">⚡</span>}
      {t.deferredFromDate && (
        <span className="shrink-0 text-[9px] font-semibold text-[#c08a2d]" title={`Carried from ${t.deferredFromDate.slice(0, 10)}`}>↻</span>
      )}
      <span
        title={t.title}
        className={`flex-1 min-w-0 truncate ${done ? "text-[#9c968d] line-through decoration-[#d5cec2]" : deferredAway ? "text-[#b0a99e]" : "text-[#2c2925]"}`}
      >
        {t.title}
      </span>
      <span className="mono text-[10px] text-[#b0a99e] shrink-0">{STATUS_META[t.status].label}</span>
    </li>
  );
}

function Dot({ title }: { title: string }) {
  return <span title={title} className="w-2 h-2 rounded-full bg-[#3f8a5b]" />;
}

function Pill({ label }: { label: string }) {
  return <span className="text-[11px] font-medium rounded-full px-2.5 py-1 bg-[#e9f4ec] text-[#3f8a5b]">{label}</span>;
}
