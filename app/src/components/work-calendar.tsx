"use client";

import { cn } from "@/lib/utils";
import { fmtHours } from "@/lib/task-status";
import type { CalCell, WeekPoint } from "@/lib/work-calendar";

// Monthly-style calendar (5 Mon-start weeks). Each day cell shows worked vs
// planned hours, colored green when worked meets/exceeds plan, amber when short,
// faint when nothing logged. A weekly worked-hours dashboard sits underneath.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WorkCalendar({ calendar, weeks }: { calendar: CalCell[]; weeks: WeekPoint[] }) {
  const maxWeek = Math.max(1, ...weeks.map((w) => w.worked));
  const todayKey = calendar.filter((c) => !c.future).slice(-1)[0]?.date ?? "";

  return (
    <div className="bg-white rounded-2xl border border-[#ece8e1] p-[22px]">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#1c1a17]">Work calendar</div>
          <p className="text-xs text-[#9c968d] mt-[5px]">Worked vs planned hours per day over the last 5 weeks.</p>
        </div>
        <div className="flex items-center gap-[14px] shrink-0 text-xs text-[#6b665f]">
          <span className="inline-flex items-center gap-1.5"><span className="w-[9px] h-[9px] rounded-sm bg-[#3f8a5b]" /> Met plan</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-[9px] h-[9px] rounded-sm bg-[#c08a2d]" /> Short</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-[6px]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-[11px] text-center text-[#b0a99e] font-medium pb-1">{d}</div>
        ))}
        {calendar.map((c) => {
          const met = c.worked > 0 && c.worked + 0.05 >= c.planned;
          return (
            <div
              key={c.date}
              className={cn(
                "rounded-lg border p-1.5 min-h-[58px] flex flex-col",
                c.future ? "border-transparent bg-transparent" : "border-[#f0ece5] bg-[#fbfaf8]",
                c.date === todayKey && "ring-1 ring-[#e0533a]",
              )}
            >
              {!c.future && (
                <>
                  <span className="text-[10px] text-[#b0a99e]">{Number(c.date.slice(8, 10))}</span>
                  {c.worked > 0 || c.planned > 0 ? (
                    <span className="mt-auto leading-tight">
                      <span className={cn("mono text-[12px] font-semibold", met ? "text-[#3f8a5b]" : "text-[#c08a2d]")}>
                        {fmtHours(c.worked)}
                      </span>
                      <span className="mono text-[10px] text-[#b0a99e]"> / {fmtHours(c.planned)}</span>
                    </span>
                  ) : (
                    <span className="mono text-[10px] text-[#d6d0c7] mt-auto">—</span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Weekly worked-hours dashboard */}
      <div className="mt-6 space-y-2">
        <div className="text-xs font-semibold text-[#6b665f] mb-1">Weekly work hours</div>
        {weeks.map((w) => (
          <div key={w.start} className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0 text-[#9c968d]">{weekLabel(w.start)}</span>
            <div className="flex-1 h-[10px] rounded-full bg-[#f0ece5] overflow-hidden">
              <div className="h-full bg-[#e0533a] rounded-full transition-all" style={{ width: `${(w.worked / maxWeek) * 100}%` }} />
            </div>
            <span className="mono w-28 text-right text-[#1c1a17]">
              {fmtHours(w.worked)} <span className="text-[#b0a99e]">/ {fmtHours(w.planned)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// "Jun 30" for a week-start YYYY-MM-DD key, formatted in UTC.
function weekLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}
