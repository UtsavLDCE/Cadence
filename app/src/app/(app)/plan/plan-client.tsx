"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  STATUS_META, PRIORITY_META, PRIORITIES, fmtHours,
  type Priority, type TaskStatus,
} from "@/lib/task-status";

type Member = { id: string; name: string | null; email: string | null };
type Tag = { id: string; name: string };
type PlanTask = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: Priority;
  estimatedHours: number | null;
  assignedById: string | null;
  assignedBy: { id: string; name: string | null; email: string | null } | null;
  tags: Tag[];
};

const fieldCls =
  "w-full border border-[#ece8e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e0533a55]";
const labelCls = "block text-xs font-medium text-[#6b665f] mb-1";

// The manager's day-planning workspace for one member + one day. Reads come from
// the server (page.tsx); this island only mutates and refreshes.
export function PlanForMemberClient({
  member,
  date,
  dateLabel,
  initialGoal,
  submitted,
  initialTasks,
}: {
  member: Member;
  date: string;
  dateLabel: string;
  initialGoal: string;
  submitted: boolean;
  initialTasks: PlanTask[];
}) {
  const router = useRouter();
  const memberName = member.name || member.email || "this member";

  const plannedHours = initialTasks.reduce((s, t) => s + (t.estimatedHours ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-[#ece8e1] p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-[#1c1a17]">{memberName}</p>
            <p className="text-xs text-[#9c968d]">
              {dateLabel} · {initialTasks.length} task{initialTasks.length === 1 ? "" : "s"} · {fmtHours(plannedHours || null)} planned
            </p>
          </div>
          {submitted && (
            <span className="text-[11px] font-medium rounded-full px-2.5 py-1 bg-[#e9f4ec] text-[#3f8a5b]" title="The member has submitted this day. You can still add or remove work as their lead.">
              Member submitted
            </span>
          )}
        </div>

        <GoalEditor userId={member.id} date={date} initialGoal={initialGoal} onSaved={() => router.refresh()} />
      </div>

      <div className="bg-white rounded-xl border border-[#ece8e1] p-5">
        <h2 className="text-sm font-semibold text-[#1c1a17] mb-3">Tasks for this day</h2>
        {initialTasks.length === 0 ? (
          <p className="text-sm text-[#b0a99e] mb-4">No tasks yet. Add the first one below.</p>
        ) : (
          <ul className="divide-y divide-[#f2efe9] mb-4">
            {initialTasks.map((t) => (
              <TaskRow key={t.id} task={t} onDeleted={() => router.refresh()} />
            ))}
          </ul>
        )}
        <AddTaskForm userId={member.id} date={date} onCreated={() => router.refresh()} />
      </div>
    </div>
  );
}

function GoalEditor({
  userId,
  date,
  initialGoal,
  onSaved,
}: {
  userId: string;
  date: string;
  initialGoal: string;
  onSaved: () => void;
}) {
  const [goal, setGoal] = useState(initialGoal);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = goal.trim() !== initialGoal.trim();

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/day-plan", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, date, goal: goal.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg("Goal saved.");
      onSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error || "Failed to save the goal.");
    }
  }

  return (
    <div className="mt-4">
      <label className={labelCls}>Goal of the day</label>
      <textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="What's the one thing this day is about?"
        className={cn(fieldCls, "resize-y")}
      />
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="text-sm px-3 py-1.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save goal"}
        </button>
        {msg && <span className="text-xs text-[#9c968d]">{msg}</span>}
      </div>
    </div>
  );
}

function TaskRow({ task, onDeleted }: { task: PlanTask; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (res.ok) onDeleted();
    else setBusy(false);
  }

  return (
    <li className="flex items-center gap-2 py-2 text-sm">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_META[task.status].dot}`} />
      <span className="flex-1 truncate text-[#2c2925]">{task.title}</span>
      {task.assignedById && (
        <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 bg-blue-100 text-blue-700" title="Assigned by a lead">
          Assigned
        </span>
      )}
      <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${PRIORITY_META[task.priority].badge}`}>
        {PRIORITY_META[task.priority].label}
      </span>
      <span className="mono text-[11px] text-[#b0a99e] shrink-0 w-14 text-right">
        {task.status === "DONE" ? STATUS_META[task.status].label : `est ${fmtHours(task.estimatedHours)}`}
      </span>
      <button
        type="button"
        onClick={del}
        disabled={busy}
        title="Remove this task from the member's day"
        className="shrink-0 text-[#b0a99e] hover:text-red-500 text-sm leading-none px-1 disabled:opacity-50"
      >
        ✕
      </button>
    </li>
  );
}

function AddTaskForm({ userId, date, onCreated }: { userId: string; date: string; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [estimate, setEstimate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
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
        date,
        title: t,
        priority,
        estimatedHours: estimate === "" ? undefined : Number(estimate),
        notes: notes.trim() || undefined,
      }),
    });
    if (res.ok) {
      setTitle("");
      setEstimate("");
      setNotes("");
      setPriority("MEDIUM");
      onCreated();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to add the task.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="border-t border-[#f2efe9] pt-4 space-y-3">
      <div>
        <label className={labelCls}>Add a task</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          className={fieldCls}
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
          <label className={labelCls}>Estimate (optional, hours)</label>
          <input
            type="number"
            min="0.1667"
            step="any"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="e.g. 2"
            className={fieldCls}
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Notes / context (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Background, links, acceptance criteria…"
          className={cn(fieldCls, "resize-y")}
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="text-sm px-3 py-1.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
      >
        {busy ? "Adding…" : "+ Add to day"}
      </button>
    </form>
  );
}
