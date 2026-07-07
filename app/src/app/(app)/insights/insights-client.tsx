"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { fmtHours, DEFERRAL_CAUSE_META } from "@/lib/task-status";
import { WIP_THRESHOLD, type MemberInsights, type TeamInsights, type CategorySlice, type Trends } from "@/lib/insights";
import type { RangeKey } from "@/lib/insights-range";
import { TONE, Stat, BlockedList, CategoryBreakdown, CategoryByPerson, buildCategoryColors } from "./insights-ui";
import { TimelineSelector } from "./timeline-selector";

type SortKey = "name" | "drift" | "fire" | "reopens" | "wip";

export function InsightsClient({
  team,
  members,
  categories,
  membersCategories,
  trends,
  rangeLabel,
  rangeKey,
  rangeFrom,
  rangeTo,
}: {
  team: TeamInsights;
  members: MemberInsights[];
  categories: CategorySlice[];
  membersCategories: { id: string; name: string; categories: CategorySlice[] }[];
  trends: Trends;
  rangeLabel: string;
  rangeKey: RangeKey;
  rangeFrom: string;
  rangeTo: string;
}) {
  // Shared palette so a category reads the same colour in the team bar and each
  // person's bar below.
  const colorOf = buildCategoryColors(categories);
  const [sort, setSort] = useState<SortKey>("drift");

  const sorted = [...members].sort((a, b) => {
    switch (sort) {
      case "drift":
        return Math.abs(b.estimate.variance) - Math.abs(a.estimate.variance);
      case "fire":
        return (b.fire.ratioPct ?? -1) - (a.fire.ratioPct ?? -1);
      case "reopens":
        return b.flow.reopens - a.flow.reopens;
      case "wip":
        return b.wip.inProgress - a.wip.inProgress;
      default:
        return (a.name ?? "").localeCompare(b.name ?? "");
    }
  });

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Productivity leaks</h1>
          <p className="text-gray-500">
            Where the team&apos;s time leaks for {rangeLabel.toLowerCase()}. Signals, not scores —
            use them to spot friction, not to rank people.
          </p>
        </div>
        <TimelineSelector current={rangeKey} from={rangeFrom} to={rangeTo} />
      </div>

      {/* Team headline strip — level + weekly trend so a manager reads direction,
          not just a point-in-time number. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <Stat
          label="Estimate drift"
          value={team.estimate.pct != null ? `${team.estimate.pct}%` : "—"}
          accent={TONE[team.estimate.tone].color}
          hint={team.estimate.sampleSize ? `${team.estimate.label} · ${team.estimate.sampleSize} done` : "No completed work yet"}
          alert={TONE[team.estimate.tone].alert}
          trend={trends.drift}
        />
        <Stat
          label="Firefighting"
          value={team.fire.ratioPct != null ? `${team.fire.ratioPct}%` : "—"}
          accent={team.fire.ratioPct != null && team.fire.ratioPct >= 25 ? "#f4502e" : "#1f2433"}
          hint={`${team.fire.unplannedCount} item${team.fire.unplannedCount === 1 ? "" : "s"} · ${fmtHours(team.fire.unplannedHours)} of ${fmtHours(team.fire.totalHours)}`}
          alert={team.fire.ratioPct != null && team.fire.ratioPct >= 25}
          trend={trends.firefighting}
          trendColor="#f4502e"
        />
        <Stat
          label="Deferrals"
          value={String(team.totalDeferrals)}
          accent={team.totalDeferrals ? "#f5a623" : "#2bb673"}
          hint={`across ${team.memberCount} member${team.memberCount === 1 ? "" : "s"}`}
        />
        <Stat
          label="Chronic slips"
          value={String(team.chronicCount)}
          accent={team.chronicCount ? "#f4502e" : "#2bb673"}
          hint="people with a task slipping repeatedly"
          alert={team.chronicCount > 0}
        />
        <Stat
          label="Rework"
          value={String(team.totalReopens)}
          accent={team.totalReopens ? "#f5a623" : "#2bb673"}
          hint="tasks reopened after DONE"
        />
        <Stat
          label="WIP overload"
          value={String(team.overloadedWip)}
          accent={team.overloadedWip ? "#f4502e" : "#2bb673"}
          hint={`people with ≥${WIP_THRESHOLD} in progress`}
          alert={team.overloadedWip > 0}
        />
      </div>

      {/* Cross-team dependency leak — who the team keeps waiting on. */}
      <BlockedList
        blocked={team.blocked}
        emptyHint="Nothing logged as blocked yet. When someone puts a task on hold, they can name who it's waiting on — those dependencies surface here."
      />

      {/* Where time goes — effort split by category, team-wide then per person. */}
      <CategoryBreakdown categories={categories} />
      <CategoryByPerson members={membersCategories} colorOf={colorOf} />

      {/* Per-member breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <h2 className="font-semibold text-gray-800">By person</h2>
          <label className="text-sm text-gray-500 flex items-center gap-2">
            Sort by
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#f4502e55]"
            >
              <option value="drift">Estimate drift</option>
              <option value="fire">Firefighting</option>
              <option value="reopens">Rework</option>
              <option value="wip">WIP</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>

        {members.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No team members yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-4 font-medium">Member</th>
                  <th className="py-2 px-3 font-medium" title="Actual ÷ estimated over completed work">Est. drift</th>
                  <th className="py-2 px-3 font-medium" title="Logged effort ÷ planned effort">Utilization</th>
                  <th className="py-2 px-3 font-medium" title="Share of effort spent on unplanned/interruption work">Firefighting</th>
                  <th className="py-2 px-3 font-medium" title="Open work right now">WIP</th>
                  <th className="py-2 px-3 font-medium" title="Deferrals in window + top reason">Deferrals</th>
                  <th className="py-2 px-3 font-medium" title="Flow from the status log (accrues going forward)">Flow</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <MemberRow key={m.id} m={m} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">
          Cycle / blocked / rework come from the status-transition log, which began recording on
          2026-07-01 — those columns fill in as work moves through statuses. Meetings and cross-team
          waiting happen between tasks, so a task tracker can&apos;t see them.
        </p>
      </div>
    </div>
  );
}

function MemberRow({ m }: { m: MemberInsights }) {
  const drift = m.estimate;
  const chronic = m.chronic;
  return (
    <tr className="border-b border-gray-50 align-top">
      <td className="py-3 pr-4">
        <p className="font-medium text-gray-900">{m.name ?? m.email ?? "—"}</p>
        {m.team && <p className="text-[11px] text-gray-400">{m.team}</p>}
      </td>

      {/* Estimate drift */}
      <td className="py-3 px-3">
        {drift.sampleSize === 0 ? (
          <span className="text-gray-300">—</span>
        ) : (
          <div>
            <span className="font-semibold" style={{ color: TONE[drift.tone].color }}>
              {drift.pct != null ? `${drift.pct}%` : "—"}
            </span>
            <p className="text-[11px] text-gray-400">
              {fmtHours(drift.actualHours)} vs {fmtHours(drift.estimatedHours)} est · {drift.sampleSize}
            </p>
          </div>
        )}
      </td>

      {/* Utilization */}
      <td className="py-3 px-3">
        {m.util.plannedHours === 0 ? (
          <span className="text-gray-300">—</span>
        ) : (
          <div>
            <span className={cn("font-semibold", m.util.pct != null && m.util.pct < 60 ? "text-primary" : "text-gray-800")}>
              {m.util.pct != null ? `${m.util.pct}%` : "—"}
            </span>
            <p className="text-[11px] text-gray-400">
              {fmtHours(m.util.loggedHours)} logged / {fmtHours(m.util.plannedHours)} planned
            </p>
          </div>
        )}
      </td>

      {/* Firefighting */}
      <td className="py-3 px-3">
        {m.fire.totalHours === 0 ? (
          <span className="text-gray-300">—</span>
        ) : (
          <div>
            <span className={cn("font-semibold", m.fire.ratioPct != null && m.fire.ratioPct >= 25 ? "text-primary" : "text-gray-800")}>
              {m.fire.ratioPct != null ? `${m.fire.ratioPct}%` : "—"}
            </span>
            <p className="text-[11px] text-gray-400">
              {m.fire.unplannedCount} item{m.fire.unplannedCount === 1 ? "" : "s"} · {fmtHours(m.fire.unplannedHours)}
              {m.fire.interruptionLogCount > 0 && ` · ${m.fire.interruptionLogCount} logged`}
            </p>
          </div>
        )}
      </td>

      {/* WIP */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1.5">
          <span className={cn("font-semibold", m.wip.inProgress >= WIP_THRESHOLD ? "text-primary" : "text-gray-800")}>
            {m.wip.inProgress}
          </span>
          {m.wip.onHold > 0 && (
            <span className="text-[11px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">
              {m.wip.onHold} hold
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-400">in progress</p>
      </td>

      {/* Deferrals + chronic */}
      <td className="py-3 px-3">
        {m.deferral.total === 0 ? (
          <span className="text-gray-300">—</span>
        ) : (
          <div>
            <span className="font-semibold text-gray-800">{m.deferral.total}</span>
            {m.deferral.topCause && (
              <span className="text-[11px] text-gray-500"> · mostly {DEFERRAL_CAUSE_META[m.deferral.topCause].label.toLowerCase()}</span>
            )}
            {chronic.length > 0 && (
              <p className="text-[11px] text-primary mt-0.5" title={chronic.map((c) => `${c.title} ×${c.slips}`).join("\n")}>
                ⚠ {chronic.length} slipping repeatedly
              </p>
            )}
          </div>
        )}
      </td>

      {/* Flow */}
      <td className="py-3 px-3">
        {m.flow.sampleSize === 0 && m.flow.avgBlockedHours == null && m.flow.reopens === 0 && m.blocked.length === 0 ? (
          <span className="text-[11px] text-gray-300">accruing…</span>
        ) : (
          <div className="text-[11px] text-gray-500 space-y-0.5">
            {m.flow.avgCycleHours != null && <p>cycle {fmtHours(m.flow.avgCycleHours)}</p>}
            {m.flow.avgBlockedHours != null && <p className="text-violet-600">blocked {fmtHours(m.flow.avgBlockedHours)}</p>}
            {m.flow.reopens > 0 && <p className="text-primary">{m.flow.reopens} reopened</p>}
            {m.blocked.length > 0 && (
              <p className="text-violet-600" title={m.blocked.map((b) => `${b.blockedOn} ×${b.count}`).join("\n")}>
                waiting on {m.blocked[0].blockedOn}
                {m.blocked.length > 1 && ` +${m.blocked.length - 1}`}
              </p>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
