"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PRIORITY_META, type Priority, type TaskStatus } from "@/lib/task-status";

type TaskLite = { id: string; title: string; priority: Priority; status: TaskStatus };

type TimeSlot = {
  id: string;
  taskId: string;
  date: string;
  plannedStart: number;
  plannedEnd: number;
  actualStart: string | null;
  actualEnd: string | null;
  task: TaskLite;
};

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;
const HOUR_HEIGHT = 64;
const SNAP_MIN = 15;
const DEFAULT_DUR = 60;

export function TimeAuditClient({
  initialTasks,
  initialSlots,
}: {
  initialTasks: TaskLite[];
  initialSlots: TimeSlot[];
}) {
  const [tasks] = useState<TaskLite[]>(initialTasks);
  const [slots, setSlots] = useState<TimeSlot[]>(initialSlots);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [now, setNow] = useState(Date.now());
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const d = new Date();
    const min = d.getHours() * 60 + d.getMinutes();
    const y = ((min - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT - 120;
    gridRef.current?.scrollTo({ top: Math.max(0, y), behavior: "auto" });
  }, []);

  const scheduledIds = useMemo(() => new Set(slots.map((s) => s.taskId)), [slots]);
  const unscheduled = tasks.filter((t) => !scheduledIds.has(t.id));

  async function addSlot(taskId: string, plannedStart: number, plannedEnd: number) {
    setError(null);
    const res = await fetch("/api/time-slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, plannedStart, plannedEnd }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Couldn't add slot.");
      return;
    }
    const slot: TimeSlot = await res.json();
    setSlots((prev) => [...prev, slot].sort((a, b) => a.plannedStart - b.plannedStart));
    setSelectedTaskId("");
  }

  async function patchSlot(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/time-slots/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Couldn't update slot.");
      return;
    }
    const updated: TimeSlot = await res.json();
    setSlots((prev) => prev.map((s) => (s.id === id ? updated : s)).sort((a, b) => a.plannedStart - b.plannedStart));
  }

  async function removeSlot(id: string) {
    if (!confirm("Delete this slot?")) return;
    const res = await fetch(`/api/time-slots/${id}`, { method: "DELETE" });
    if (!res.ok) { setError("Couldn't delete slot."); return; }
    setSlots((prev) => prev.filter((s) => s.id !== id));
  }

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!selectedTaskId) {
      setError("Pick a task from the left first.");
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawMin = DAY_START_HOUR * 60 + (y / HOUR_HEIGHT) * 60;
    const snapped = Math.round(rawMin / SNAP_MIN) * SNAP_MIN;
    const start = Math.max(DAY_START_HOUR * 60, Math.min(snapped, DAY_END_HOUR * 60 - DEFAULT_DUR));
    const end = Math.min(start + DEFAULT_DUR, DAY_END_HOUR * 60);
    if (end <= start) return;
    addSlot(selectedTaskId, start, end);
  }

  const hasOverlap = (() => {
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[i].plannedStart < slots[j].plannedEnd && slots[j].plannedStart < slots[i].plannedEnd) return true;
      }
    }
    return false;
  })();

  const totalPlannedMin = slots.reduce((s, x) => s + (x.plannedEnd - x.plannedStart), 0);
  const totalActualMin = slots.reduce((s, x) => s + slotActualMinutes(x, now), 0);

  const nowDate = new Date(now);
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  const nowInRange = nowMin >= DAY_START_HOUR * 60 && nowMin <= DAY_END_HOUR * 60;
  const nowY = ((nowMin - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;

  const columns = layoutSlots(slots);
  const runningCount = slots.filter((s) => s.actualStart && !s.actualEnd).length;

  return (
    <div className="flex flex-col h-[calc(100vh-92px)]">
      <header className="flex items-center gap-3 pb-3 shrink-0">
        <h1 className="text-[22px] font-semibold text-[#1c1a17]">Time Audit</h1>
        <span className="text-[11px] text-[#b0a99e]">
          {nowDate.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" })} · manager only
        </span>
        <span className="ml-auto flex items-center gap-2">
          {runningCount > 0 && (
            <span className="text-[11px] font-semibold text-[#3a6ea5] bg-[#eef4fa] rounded-full px-2 py-0.5">
              ▶ {runningCount} running
            </span>
          )}
          {slots.length > 0 && (
            <>
              <span className="text-[12px] text-[#6b665f] tabular-nums">
                {fmtMinutes(totalPlannedMin)} planned · {fmtMinutes(totalActualMin)} actual
              </span>
              {hasOverlap && (
                <span className="text-[11px] font-semibold text-[#c08a2d] bg-[#f8f0dd] rounded-full px-2 py-0.5">overlaps</span>
              )}
            </>
          )}
        </span>
      </header>

      {error && (
        <div className="text-[13px] text-[#c0533a] bg-[#f8ece9] border border-[#f0d6cf] rounded-lg px-3 py-2 mb-3 shrink-0 flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-[#9c968d] hover:text-[#c0533a]">✕</button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex gap-4">
        <aside className="w-72 shrink-0 flex flex-col border border-[#ece8e1] rounded-2xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-[#ece8e1]">
            <h2 className="text-[13px] font-semibold text-[#1c1a17]">Today&apos;s tasks</h2>
            <p className="text-[11px] text-[#b0a99e] mt-0.5">
              Pick one, then click the calendar to place a 1h slot.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {tasks.length === 0 ? (
              <p className="text-xs text-[#b0a99e] p-3">No tasks on today. Add some in My Day first.</p>
            ) : (
              <>
                {unscheduled.length === 0 && scheduledIds.size > 0 && (
                  <p className="text-xs text-[#b0a99e] p-3">All today&apos;s tasks are scheduled.</p>
                )}
                {unscheduled.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTaskId(t.id === selectedTaskId ? "" : t.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg border flex items-center gap-2 transition-colors",
                      selectedTaskId === t.id
                        ? "border-primary bg-[#fdefec] ring-2 ring-[#e0533a55]"
                        : "border-[#ece8e1] bg-white hover:bg-[#faf8f4]",
                    )}
                  >
                    <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[t.priority].badge)}>
                      {PRIORITY_META[t.priority].label}
                    </span>
                    <span className="text-sm text-[#1c1a17] flex-1 min-w-0 truncate">{t.title}</span>
                  </button>
                ))}
                {scheduledIds.size > 0 && (
                  <div className="pt-2 mt-2 border-t border-[#ece8e1]">
                    <p className="text-[10px] font-semibold text-[#b0a99e] uppercase tracking-wide px-2 mb-1">Scheduled</p>
                    {tasks.filter((t) => scheduledIds.has(t.id)).map((t) => (
                      <div key={t.id} className="px-3 py-1.5 rounded-lg flex items-center gap-2 opacity-60">
                        <span className={cn("text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0", PRIORITY_META[t.priority].badge)}>
                          {PRIORITY_META[t.priority].label}
                        </span>
                        <span className="text-sm text-[#1c1a17] flex-1 min-w-0 truncate line-through">{t.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          {selectedTaskId && (
            <div className="px-4 py-2.5 border-t border-[#ece8e1] bg-[#fdefec] text-[11px] text-[#c0533a] font-medium">
              Click any hour on the calendar to place →
            </div>
          )}
        </aside>

        <div ref={gridRef} className="flex-1 overflow-y-auto border border-[#ece8e1] rounded-2xl bg-white">
          <div className="flex">
            <div className="w-14 shrink-0 border-r border-[#ece8e1]">
              {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => {
                const h = DAY_START_HOUR + i;
                return (
                  <div key={h} style={{ height: HOUR_HEIGHT }} className="text-[10px] text-[#b0a99e] tabular-nums text-right pr-2 pt-0.5">
                    {String(h).padStart(2, "0")}:00
                  </div>
                );
              })}
            </div>

            <div
              className={cn("flex-1 relative", selectedTaskId ? "cursor-crosshair" : "cursor-default")}
              style={{ height: (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT }}
              onClick={handleGridClick}
            >
              {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-[#f2efe9]"
                  style={{ top: i * HOUR_HEIGHT }}
                />
              ))}
              {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => (
                <div
                  key={`half-${i}`}
                  className="absolute left-0 right-0 border-t border-dashed border-[#f6f4ee]"
                  style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                />
              ))}

              {nowInRange && (
                <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowY }}>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-semibold text-white bg-[#c0533a] tabular-nums rounded-r px-1.5 py-0.5">
                      {minToTime(nowMin)}
                    </span>
                    <div className="flex-1 h-[2px] bg-[#c0533a]" />
                  </div>
                </div>
              )}

              {slots.map((s) => {
                const col = columns.get(s.id) ?? { col: 0, cols: 1 };
                const top = ((s.plannedStart - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
                const height = ((s.plannedEnd - s.plannedStart) / 60) * HOUR_HEIGHT;
                const widthPct = 100 / col.cols;
                return (
                  <div
                    key={s.id}
                    className="absolute"
                    style={{
                      top,
                      height: Math.max(28, height),
                      left: `calc(${col.col * widthPct}% + 4px)`,
                      width: `calc(${widthPct}% - 8px)`,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <SlotBlock slot={s} now={now} onPatch={patchSlot} onRemove={removeSlot} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SlotBlock({
  slot,
  now,
  onPatch,
  onRemove,
}: {
  slot: TimeSlot;
  now: number;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const running = Boolean(slot.actualStart && !slot.actualEnd);
  const done = Boolean(slot.actualStart && slot.actualEnd);
  const actualMin = slotActualMinutes(slot, now);
  const plannedMin = slot.plannedEnd - slot.plannedStart;
  const drift = actualMin - plannedMin;

  const tone = running
    ? "bg-[#eef4fa] border-[#a5c3e0]"
    : done
    ? drift > 0
      ? "bg-[#f8f0dd] border-[#e0c58a]"
      : "bg-[#eaf5ee] border-[#a5d0b5]"
    : "bg-[#faf8f4] border-[#ddd8d0]";

  const tall = plannedMin >= 45;

  return (
    <div className={cn("h-full w-full rounded-lg border-l-4 border shadow-sm overflow-hidden flex flex-col group hover:shadow-md transition-shadow", tone)}>
      <div className="px-2 py-1 flex items-start gap-1.5 flex-1 min-h-0">
        <span className={cn("text-[9px] font-semibold rounded px-1 py-0.5 shrink-0 mt-0.5", PRIORITY_META[slot.task.priority].badge)}>
          {PRIORITY_META[slot.task.priority].label}
        </span>
        <div className="flex-1 min-w-0">
          <p className={cn("text-[12px] font-medium leading-tight text-[#1c1a17]", tall ? "line-clamp-2" : "truncate")}>
            {slot.task.title}
          </p>
          <p className="text-[10px] text-[#6b665f] tabular-nums mt-0.5 truncate">
            {minToTime(slot.plannedStart)}–{minToTime(slot.plannedEnd)} · {fmtMinutes(plannedMin)}
            {(running || done) && (
              <span className={cn(
                "ml-1 font-semibold",
                running ? "text-[#3a6ea5]" : drift > 0 ? "text-[#c08a2d]" : "text-[#3f8a5b]",
              )}>
                {running ? " · ▶ " : " · "}{fmtMinutes(actualMin)}
                {done && drift !== 0 && ` (${drift > 0 ? "+" : ""}${fmtMinutes(Math.abs(drift))})`}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRemove(slot.id)}
          className="opacity-0 group-hover:opacity-100 text-[#9c968d] hover:text-[#c0533a] text-xs shrink-0 leading-none"
          title="Delete slot"
          aria-label="Delete slot"
        >
          ✕
        </button>
      </div>
      {tall && (
        <div className="px-2 pb-1.5 flex gap-1 shrink-0">
          {!running && !done && (
            <button
              type="button"
              onClick={() => onPatch(slot.id, { action: "start" })}
              className="border border-[#cfdff0] bg-white text-[#3a6ea5] hover:bg-[#eef4fa] font-medium text-[10px] px-2 py-0.5 rounded transition-colors"
            >
              ▶ Start
            </button>
          )}
          {running && (
            <button
              type="button"
              onClick={() => onPatch(slot.id, { action: "stop" })}
              className="border border-[#cfe6d4] bg-white text-[#3f8a5b] hover:bg-[#f0f8f2] font-medium text-[10px] px-2 py-0.5 rounded transition-colors"
            >
              ■ Stop
            </button>
          )}
          {done && (
            <button
              type="button"
              onClick={() => onPatch(slot.id, { action: "reset" })}
              className="text-[10px] text-[#9c968d] hover:text-[#c0533a] font-medium px-1"
            >
              reset
            </button>
          )}
        </div>
      )}
      {!tall && (
        <div className="absolute top-0.5 right-6 opacity-0 group-hover:opacity-100 flex gap-1">
          {!running && !done && (
            <button
              type="button"
              onClick={() => onPatch(slot.id, { action: "start" })}
              className="border border-[#cfdff0] bg-white text-[#3a6ea5] hover:bg-[#eef4fa] font-medium text-[9px] px-1.5 py-0.5 rounded"
            >
              ▶
            </button>
          )}
          {running && (
            <button
              type="button"
              onClick={() => onPatch(slot.id, { action: "stop" })}
              className="border border-[#cfe6d4] bg-white text-[#3f8a5b] hover:bg-[#f0f8f2] font-medium text-[9px] px-1.5 py-0.5 rounded"
            >
              ■
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function layoutSlots(slots: TimeSlot[]): Map<string, { col: number; cols: number }> {
  const out = new Map<string, { col: number; cols: number }>();
  const sorted = [...slots].sort((a, b) => a.plannedStart - b.plannedStart || a.plannedEnd - b.plannedEnd);
  const clusters: TimeSlot[][] = [];
  for (const s of sorted) {
    let placed = false;
    for (const c of clusters) {
      if (c.some((x) => s.plannedStart < x.plannedEnd && x.plannedStart < s.plannedEnd)) {
        c.push(s);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([s]);
  }
  for (const c of clusters) {
    const cols: TimeSlot[][] = [];
    for (const s of c) {
      let col = cols.findIndex((column) => {
        const last = column[column.length - 1];
        return last.plannedEnd <= s.plannedStart;
      });
      if (col === -1) { col = cols.length; cols.push([]); }
      cols[col].push(s);
    }
    const totalCols = cols.length;
    cols.forEach((column, idx) => {
      for (const s of column) out.set(s.id, { col: idx, cols: totalCols });
    });
  }
  return out;
}

function minToTime(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtMinutes(n: number): string {
  if (n <= 0) return "0m";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function slotActualMinutes(s: TimeSlot, now: number): number {
  if (!s.actualStart) return 0;
  const start = new Date(s.actualStart).getTime();
  const end = s.actualEnd ? new Date(s.actualEnd).getTime() : now;
  return Math.max(0, Math.round((end - start) / 60000));
}
