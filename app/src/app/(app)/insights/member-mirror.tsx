"use client";

import { useState } from "react";
import { fmtHours, DEFERRAL_CAUSE_META } from "@/lib/task-status";
import { WIP_THRESHOLD, type MemberInsights, type CategorySlice, type Trends, type FireItem } from "@/lib/insights";
import type { RangeKey } from "@/lib/insights-range";
import { TONE, Stat, BlockedList, CategoryBreakdown } from "./insights-ui";
import { TimelineSelector } from "./timeline-selector";

// A member's personal mirror of their OWN work patterns. Same analytics as the
// manager team view, scoped to self and framed as self-diagnosis — so logging
// faithfully pays the member back, not only their manager. Deliberately no
// composite "score": these are signals to reflect on, not a grade.
export function MemberMirror({
  me,
  categories,
  trends,
  rangeLabel,
  rangeKey,
  rangeFrom,
  rangeTo,
}: {
  me: MemberInsights;
  categories: CategorySlice[];
  trends: Trends;
  rangeLabel: string;
  rangeKey: RangeKey;
  rangeFrom: string;
  rangeTo: string;
}) {
  const firstName = (me.name ?? "").split(" ")[0] || "there";
  const util = me.util;
  const fire = me.fire;
  const drift = me.estimate;

  return (
    <div className="w-full max-w-[1400px]">
      <div className="flex items-start justify-between mb-[22px] gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1c1a17] leading-tight">Your work patterns</h1>
          <p className="text-sm text-[#9c968d] mt-1.5 max-w-[560px]">
            {firstName}, this is your own mirror for {rangeLabel.toLowerCase()} — a reflection to help
            you plan better, not a scoreboard. Only you and your manager see it.
          </p>
        </div>
        <TimelineSelector current={rangeKey} from={rangeFrom} to={rangeTo} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-[22px]">
        {/* Discipline habits — the planning ritual reflected back as its three
            components (submit a plan, finish it, keep it on its day). Shown as
            separate signals, not a single grade — this is a mirror, not a score. */}
        <Stat
          label="Plans submitted"
          value={me.discipline.submissionPct != null ? `${me.discipline.submissionPct}%` : "—"}
          accent={me.discipline.submissionPct != null && me.discipline.submissionPct < 60 ? "#c08a2d" : "#3f8a5b"}
          hint={`${me.discipline.submittedPlans} of ${me.discipline.workingDays} working days`}
          alert={me.discipline.submissionPct != null && me.discipline.submissionPct < 60}
        />
        <Stat
          label="Follow-through"
          value={me.discipline.completionPct != null ? `${me.discipline.completionPct}%` : "—"}
          accent={me.discipline.completionPct != null && me.discipline.completionPct < 60 ? "#c08a2d" : "#3f8a5b"}
          hint={me.discipline.committed ? `${me.discipline.completed} of ${me.discipline.committed} planned done` : "no planned work yet"}
        />
        <Stat
          label="On-plan delivery"
          value={me.discipline.onPlanPct != null ? `${me.discipline.onPlanPct}%` : "—"}
          accent={me.discipline.onPlanPct != null && me.discipline.onPlanPct < 75 ? "#c08a2d" : "#3f8a5b"}
          hint={me.discipline.committed ? `${me.discipline.deferred} of ${me.discipline.committed} slipped to another day` : "landed on their planned day"}
        />
        <Stat
          label="Estimate accuracy"
          value={drift.pct != null ? `${drift.pct}%` : "—"}
          accent={TONE[drift.tone].color}
          hint={drift.sampleSize ? `${drift.label} · ${drift.sampleSize} done` : "Complete estimated tasks to see this"}
          alert={TONE[drift.tone].alert}
          trend={trends.drift}
        />
        <Stat
          label="Utilization"
          value={util.pct != null ? `${util.pct}%` : "—"}
          accent={util.pct != null && util.pct < 60 ? "#e0533a" : "#1c1a17"}
          hint={`${fmtHours(util.loggedHours)} logged / ${fmtHours(util.plannedHours)} planned`}
          alert={util.pct != null && util.pct < 60}
          trend={trends.utilization}
        />
        <Stat
          label="Firefighting"
          value={fire.ratioPct != null ? `${fire.ratioPct}%` : "—"}
          accent={fire.ratioPct != null && fire.ratioPct >= 25 ? "#e0533a" : "#1c1a17"}
          hint={`${fire.unplannedCount} item${fire.unplannedCount === 1 ? "" : "s"} · ${fmtHours(fire.unplannedHours)} of ${fmtHours(fire.totalHours)}`}
          alert={fire.ratioPct != null && fire.ratioPct >= 25}
          trend={trends.firefighting}
          trendColor="#e0533a"
        />
        <Stat
          label="Open now"
          value={String(me.wip.inProgress)}
          accent={me.wip.inProgress >= WIP_THRESHOLD ? "#e0533a" : "#3f8a5b"}
          hint={me.wip.onHold > 0 ? `${me.wip.onHold} on hold` : "in progress right now"}
          alert={me.wip.inProgress >= WIP_THRESHOLD}
        />
        <Stat
          label="Deferrals"
          value={String(me.deferral.total)}
          accent={me.deferral.total ? "#c08a2d" : "#3f8a5b"}
          hint={me.deferral.topCause ? `mostly ${DEFERRAL_CAUSE_META[me.deferral.topCause].label.toLowerCase()}` : "tasks pushed to another day"}
        />
        <Stat
          label="Rework"
          value={String(me.flow.reopens)}
          accent={me.flow.reopens ? "#c08a2d" : "#3f8a5b"}
          hint="tasks you reopened after DONE"
        />
        <Stat
          label="Avg cycle"
          value={me.flow.avgCycleHours != null ? fmtHours(me.flow.avgCycleHours) : "—"}
          accent="#1c1a17"
          hint={me.flow.sampleSize ? `across ${me.flow.sampleSize} finished` : "start → done, accrues forward"}
        />
        <Stat
          label="Blocked time"
          value={me.flow.avgBlockedHours != null ? fmtHours(me.flow.avgBlockedHours) : "—"}
          accent={me.flow.avgBlockedHours != null ? "#6a5acd" : "#3f8a5b"}
          hint="avg time your tasks sat on hold"
        />
      </div>

      {/* What you're waiting on — your own cross-team dependencies. */}
      <BlockedList
        blocked={me.blocked}
        emptyHint="Nothing logged as blocked. When you put a task on hold, name who it's waiting on — it'll show here and helps your manager clear it."
      />

      {/* Where your time goes. */}
      <CategoryBreakdown categories={categories} title="Where your time goes" />

      {/* Your unplanned work, browsable — so firefighting is a list you can see,
          not just a ratio. */}
      <UnplannedList items={me.fireItems} />

      {me.chronic.length > 0 && (
        <div className="bg-white rounded-[16px] border border-[#f6cabc] p-[22px]">
          <h2 className="text-sm font-semibold text-[#1c1a17] mb-2">Tasks that keep slipping</h2>
          <ul className="space-y-1 text-sm">
            {me.chronic.map((c) => (
              <li key={c.title} className="flex items-center gap-2">
                <span className="text-primary">⚠</span>
                <span className="flex-1 truncate text-[#1c1a17]">{c.title}</span>
                <span className="mono text-xs text-[#b0a99e]">slipped ×{c.slips}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-[#b0a99e] mt-3">
            Repeatedly deferred work is often mis-scoped or blocked — worth breaking down or escalating.
          </p>
        </div>
      )}

      <p className="text-[11px] text-[#b0a99e] mt-6 leading-relaxed">
        Cycle, blocked, and rework come from the status log, which began recording on 2026-07-01 — they
        fill in as your work moves through statuses. The more faithfully you log estimates, actuals, and
        holds, the sharper this mirror gets.
      </p>
    </div>
  );
}

// A browsable list of the member's own unplanned work in the window — the items
// behind the Firefighting ratio, so "my off-plan work" is something you can see
// and check, not just a percentage. Collapsed by default; the header always
// shows the count and hours so the signal is visible without expanding.
function UnplannedList({ items }: { items: FireItem[] }) {
  const [open, setOpen] = useState(false);
  const totalHours = Math.round(items.reduce((s, i) => s + i.hours, 0) * 10) / 10;

  if (items.length === 0) return null;

  const fmtDay = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

  return (
    <div className="bg-white rounded-[16px] border border-[#f6cabc] p-[22px] mb-[22px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 text-left"
        aria-expanded={open}
      >
        <h2 className="text-sm font-semibold text-[#1c1a17]">
          Unplanned work you logged
          <span className="ml-2 mono text-xs font-normal text-[#b0a99e]">
            {items.length} item{items.length === 1 ? "" : "s"} · {fmtHours(totalHours)}
          </span>
        </h2>
        <span className="text-primary text-sm shrink-0">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <ul className="mt-3 space-y-1 text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 border-t border-[#f6f4f1] pt-1.5 first:border-t-0 first:pt-0">
              <span className="text-primary">⚡</span>
              <span className="flex-1 truncate text-[#1c1a17]">{it.title}</span>
              <span className="mono text-xs text-[#b0a99e]">{fmtDay(it.date)}</span>
              <span className="mono text-xs text-[#9c968d] w-12 text-right">{fmtHours(it.hours)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-[#b0a99e] mt-3">
        Off-plan work you logged through ⚡ — meetings, ad-hoc calls, interruptions. High firefighting
        means the plan and the day diverged; worth protecting focus time or planning for the recurring ones.
      </p>
    </div>
  );
}
