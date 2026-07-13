"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { fmtHours, DEFERRAL_CAUSE_META, WORKDAY_HOURS } from "@/lib/task-status";
import { WIP_THRESHOLD, MIN_PLAN_LOAD_PCT, type MemberInsights, type TeamInsights, type CategorySlice, type Trends } from "@/lib/insights";
import type { RangeKey } from "@/lib/insights-range";
import { TONE, Stat, BlockedList, CategoryBreakdown, CategoryByPerson, buildCategoryColors } from "./insights-ui";
import { TimelineSelector } from "./timeline-selector";
import { ScopeToggle, type Scope } from "@/components/scope-toggle";

type SortKey = "name" | "discipline" | "drift" | "fire" | "reopens" | "wip";

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
  scope,
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
  scope: Scope;
}) {
  // Shared palette so a category reads the same colour in the team bar and each
  // person's bar below.
  const colorOf = buildCategoryColors(categories);
  const [sort, setSort] = useState<SortKey>("drift");
  const [filter, setFilter] = useState("");

  const sorted = [...members].sort((a, b) => {
    switch (sort) {
      case "discipline":
        // Lowest score first (who needs a look); null scores sink to the bottom.
        return (a.discipline.score ?? 101) - (b.discipline.score ?? 101);
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

  // Name/email filter — at ~50 members, finding one person needs a search box.
  const q = filter.trim().toLowerCase();
  const visible = q
    ? sorted.filter((m) => `${m.name ?? ""} ${m.email ?? ""}`.toLowerCase().includes(q))
    : sorted;

  return (
    <div className="w-full">
      <div className="flex items-start justify-between mb-[22px] gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[#1c1a17] leading-tight">Productivity leaks</h1>
          <p className="text-sm text-[#9c968d] mt-1.5 max-w-[560px]">
            Where {scope === "team" ? "your team" : "the organization"}&apos;s time leaks for {rangeLabel.toLowerCase()}. Signals, not scores —
            use them to spot friction, not to rank people.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ScopeToggle current={scope} />
          <TimelineSelector current={rangeKey} from={rangeFrom} to={rangeTo} />
        </div>
      </div>

      {/* Team headline strip — level + weekly trend so a manager reads direction,
          not just a point-in-time number. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-[22px]">
        <Stat
          label="Discipline"
          value={team.discipline.avgScore != null ? String(team.discipline.avgScore) : "—"}
          accent={
            team.discipline.avgScore == null
              ? "#b0a99e"
              : team.discipline.avgScore >= 75
                ? "#3f8a5b"
                : team.discipline.avgScore >= 50
                  ? "#c08a2d"
                  : "#c0392b"
          }
          hint={
            team.discipline.submissionPct != null
              ? `${team.discipline.submissionPct}% plans submitted${team.discipline.lowCount ? ` · ${team.discipline.lowCount} need a look` : ""}`
              : "no plan data yet"
          }
          alert={team.discipline.lowCount > 0}
        />
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
          accent={team.fire.ratioPct != null && team.fire.ratioPct >= 25 ? "#c08a2d" : "#1c1a17"}
          hint={`${team.fire.unplannedCount} item${team.fire.unplannedCount === 1 ? "" : "s"} · ${fmtHours(team.fire.unplannedHours)} of ${fmtHours(team.fire.totalHours)}`}
          alert={team.fire.ratioPct != null && team.fire.ratioPct >= 25}
          trend={trends.firefighting}
          trendColor="#c08a2d"
        />
        <Stat
          label="Deferrals"
          value={String(team.totalDeferrals)}
          accent={team.totalDeferrals ? "#c08a2d" : "#3f8a5b"}
          hint={`across ${team.memberCount} member${team.memberCount === 1 ? "" : "s"}`}
        />
        <Stat
          label="Chronic slips"
          value={String(team.chronicCount)}
          accent={team.chronicCount ? "#c0392b" : "#3f8a5b"}
          hint="people with a task slipping repeatedly"
          alert={team.chronicCount > 0}
        />
        <Stat
          label="Rework"
          value={String(team.totalReopens)}
          accent={team.totalReopens ? "#c08a2d" : "#3f8a5b"}
          hint="tasks reopened after DONE"
        />
        <Stat
          label="WIP overload"
          value={String(team.overloadedWip)}
          accent={team.overloadedWip ? "#c0392b" : "#3f8a5b"}
          hint={`people with ≥${WIP_THRESHOLD} in progress`}
          alert={team.overloadedWip > 0}
        />
      </div>

      {/* Cross-team dependency leak — who the team keeps waiting on. */}
      <BlockedList
        blocked={team.blocked}
        emptyHint="Nothing logged as blocked yet. When someone puts a task on hold, they can name who it's waiting on — those dependencies surface here."
      />

      {/* Below KPIs: main analytics on the left (3/4), the per-person "where time
          goes" rail on the right (1/4). */}
      <div className="flex gap-[22px] items-start">
        <div className="flex-1 min-w-0">
          {/* Where time goes — team-wide effort split by category. */}
          <CategoryBreakdown categories={categories} />

          {/* Per-member breakdown */}
          <div className="bg-white rounded-[16px] border border-[#ece8e1] p-[22px]">
        <div className="flex items-center justify-between mb-3.5 gap-4 flex-wrap">
          <h2 className="text-sm font-semibold text-[#1c1a17]">
            By person
            <span className="ml-2 mono text-xs font-normal text-[#b0a99e]">
              {visible.length}
              {q && visible.length !== members.length ? ` of ${members.length}` : ""}
            </span>
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name…"
              className="border border-[#e7e3dd] rounded-lg px-2.5 py-1 text-xs text-[#6b665f] w-[180px] focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
            />
            <label className="text-xs text-[#9c968d] flex items-center gap-2">
              Sort by
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="border border-[#e7e3dd] rounded-lg px-2 py-1 text-xs text-[#6b665f] focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
              >
                <option value="discipline">Discipline</option>
                <option value="drift">Estimate drift</option>
                <option value="fire">Firefighting</option>
                <option value="reopens">Rework</option>
                <option value="wip">WIP</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
        </div>

        {members.length === 0 ? (
          <p className="text-sm text-[#b0a99e] py-6 text-center">No team members yet.</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-[#b0a99e] py-6 text-center">No members match &ldquo;{filter}&rdquo;.</p>
        ) : (
          // Internal scroll + sticky header so 50 rows stay scannable without the
          // column labels scrolling off. max-h keeps the page from becoming one
          // giant scroll when the roster is large.
          <div className="overflow-auto max-h-[70vh] rounded-[10px] border border-[#f2eee7]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="text-left text-[10px] tracking-[0.08em] uppercase text-[#b0a99e] border-b border-[#ece8e1]">
                  <th className="py-2.5 pl-4 pr-4 font-medium bg-white">Member</th>
                  <th className="py-2.5 px-3 font-medium bg-white" title="Planning ritual + follow-through: plan submission, completion, on-plan delivery">Discipline</th>
                  <th className="py-2.5 px-3 font-medium bg-white" title="Actual ÷ estimated over completed work">Est. drift</th>
                  <th className="py-2.5 px-3 font-medium bg-white" title="Logged effort ÷ planned effort">Utilization</th>
                  <th className="py-2.5 px-3 font-medium bg-white" title="Share of effort spent on unplanned/interruption work">Firefighting</th>
                  <th className="py-2.5 px-3 font-medium bg-white" title="Open work right now">WIP</th>
                  <th className="py-2.5 px-3 font-medium bg-white" title="Deferrals in window + top reason">Deferrals</th>
                  <th className="py-2.5 px-3 font-medium bg-white" title="Flow from the status log (accrues going forward)">Flow</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <MemberRow key={m.id} m={m} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-[#b0a99e] mt-4 leading-relaxed">
          Cycle / blocked / rework come from the status-transition log, which began recording on
          2026-07-01 — those columns fill in as work moves through statuses. Meetings and cross-team
          waiting happen between tasks, so a task tracker can&apos;t see them.
        </p>
          </div>
        </div>

        <aside className="w-1/4 min-w-[240px] shrink-0">
          <CategoryByPerson members={membersCategories} colorOf={colorOf} />
        </aside>
      </div>
    </div>
  );
}

function MemberRow({ m }: { m: MemberInsights }) {
  const drift = m.estimate;
  const chronic = m.chronic;
  return (
    <tr className="border-b border-[#f2eee7] align-top">
      <td className="py-3.5 pl-4 pr-4">
        <p className="text-sm font-medium text-[#1c1a17]">{m.name ?? m.email ?? "—"}</p>
        {m.team && <p className="text-[11px] text-[#b0a99e]">{m.team}</p>}
      </td>

      {/* Discipline */}
      <td className="py-3.5 px-3">
        {m.discipline.score == null ? (
          <span className="mono text-[#b0a99e]">—</span>
        ) : (
          <div>
            <span className="mono font-semibold" style={{ color: TONE[m.discipline.tone].color }}>
              {m.discipline.score}
            </span>
            <p className="mono text-[10px] text-[#b0a99e]">
              {m.discipline.submissionPct ?? 0}% plan · {m.discipline.completionPct ?? 0}% done · {m.discipline.onPlanPct ?? 0}% on-plan
            </p>
          </div>
        )}
      </td>

      {/* Estimate drift */}
      <td className="py-3.5 px-3">
        {drift.sampleSize === 0 ? (
          <span className="mono text-[#b0a99e]">—</span>
        ) : (
          <div>
            <span className="mono font-semibold" style={{ color: TONE[drift.tone].color }}>
              {drift.pct != null ? `${drift.pct}%` : "—"}
            </span>
            <p className="mono text-[10px] text-[#b0a99e]">
              {fmtHours(drift.actualHours)} vs {fmtHours(drift.estimatedHours)} est · {drift.sampleSize}
            </p>
            <p className="text-[10px] font-medium" style={{ color: TONE[drift.tone].color }}>{drift.label}</p>
          </div>
        )}
      </td>

      {/* Utilization */}
      <td className="py-3.5 px-3">
        {m.util.plannedHours === 0 ? (
          <span className="mono text-[#b0a99e]">—</span>
        ) : (
          <div>
            <span className={cn("mono font-semibold", m.util.pct != null && m.util.pct < 60 ? "text-primary" : "text-[#1c1a17]")}>
              {m.util.pct != null ? `${m.util.pct}%` : "—"}
            </span>
            <p className="mono text-[10px] text-[#b0a99e]">
              {fmtHours(m.util.loggedHours)} / {fmtHours(m.util.plannedHours)} planned
            </p>
            {m.util.underPlanned && m.util.perDayHours != null && (
              <p
                className="text-[10px] text-[#c0392b] font-semibold"
                title={`Plans ${fmtHours(m.util.perDayHours)}/day of ${WORKDAY_HOURS}h — under the ${MIN_PLAN_LOAD_PCT}% floor`}
              >
                ⚠ only {fmtHours(m.util.perDayHours)}/day of {WORKDAY_HOURS}h
              </p>
            )}
          </div>
        )}
      </td>

      {/* Firefighting */}
      <td className="py-3.5 px-3">
        {m.fire.totalHours === 0 ? (
          <span className="mono text-[#b0a99e]">—</span>
        ) : (
          <div>
            <span className={cn("mono font-semibold", m.fire.ratioPct != null && m.fire.ratioPct >= 25 ? "text-[#c08a2d]" : "text-[#1c1a17]")}>
              {m.fire.ratioPct != null ? `${m.fire.ratioPct}%` : "—"}
            </span>
            <p className="mono text-[10px] text-[#b0a99e]">
              {m.fire.unplannedCount} item{m.fire.unplannedCount === 1 ? "" : "s"} · {fmtHours(m.fire.unplannedHours)}
              {m.fire.interruptionLogCount > 0 && ` · ${m.fire.interruptionLogCount} logged`}
            </p>
          </div>
        )}
      </td>

      {/* WIP */}
      <td className="py-3.5 px-3">
        <div className="flex items-center gap-1.5">
          <span className={cn("mono", m.wip.inProgress >= WIP_THRESHOLD ? "text-primary font-semibold" : "text-[#1c1a17]")}>
            {m.wip.inProgress}
          </span>
          {m.wip.onHold > 0 && (
            <span className="text-[10px] bg-[#eae6fb] text-[#6a5acd] px-1.5 py-0.5 rounded font-semibold">
              {m.wip.onHold} hold
            </span>
          )}
        </div>
        <p className="text-[10px] text-[#b0a99e]">in progress</p>
      </td>

      {/* Deferrals + chronic */}
      <td className="py-3.5 px-3">
        {m.deferral.total === 0 ? (
          <span className="mono text-[#b0a99e]">—</span>
        ) : (
          <div>
            <span className="mono font-semibold text-[#1c1a17]">{m.deferral.total}</span>
            {m.deferral.topCause && (
              <span className="text-[11px] text-[#9c968d]"> · mostly {DEFERRAL_CAUSE_META[m.deferral.topCause].label.toLowerCase()}</span>
            )}
            {chronic.length > 0 && (
              <p className="text-[10px] text-[#c0392b] mt-0.5" title={chronic.map((c) => `${c.title} ×${c.slips}`).join("\n")}>
                ⚠ {chronic.length} slipping repeatedly
              </p>
            )}
          </div>
        )}
      </td>

      {/* Flow */}
      <td className="py-3.5 px-3">
        {m.flow.sampleSize === 0 && m.flow.avgBlockedHours == null && m.flow.reopens === 0 && m.blocked.length === 0 ? (
          <span className="text-[11px] text-[#b0a99e]">accruing…</span>
        ) : (
          <div className="text-[11px] text-[#6b665f] space-y-0.5">
            {m.flow.avgCycleHours != null && <p className="mono">cycle {fmtHours(m.flow.avgCycleHours)}</p>}
            {m.flow.avgBlockedHours != null && <p className="mono text-[#6a5acd]">blocked {fmtHours(m.flow.avgBlockedHours)}</p>}
            {m.flow.reopens > 0 && <p className="mono text-primary">{m.flow.reopens} reopened</p>}
            {m.blocked.length > 0 && (
              <p className="text-[#6a5acd]" title={m.blocked.map((b) => `${b.blockedOn} ×${b.count}`).join("\n")}>
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
