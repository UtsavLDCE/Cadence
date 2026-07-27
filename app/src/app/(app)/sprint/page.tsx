import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate } from "@/lib/utils";
import { parseEstimateHours, STARTED_STATES, RESOLVED_STATES } from "@/lib/sprint";
import { AddToToday } from "./add-button";

// The signed-in member's current-sprint work items (matched by email local-part
// on import). Items that are overdue, due today, or already started can be pulled
// straight onto today's plan; the rest are shown read-only for reference.
export default async function SprintPage() {
  const session = await auth();
  const userId = session!.user.id;

  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  const version = settings?.currentSprintVersion ?? null;

  const rawItems = version
    ? await prisma.sprintItem.findMany({
        where: { version, userId },
        orderBy: [{ priority: "asc" }, { externalId: "asc" }],
      })
    : [];

  // Actionable = due on/before today, or work already underway. These are the
  // ones a member should be pulling into today.
  const today = todayDate();
  const urgency = (it: (typeof rawItems)[number]): "overdue" | "today" | "started" | null => {
    if (it.dueDate) {
      const due = it.dueDate.getTime();
      if (due < today.getTime()) return "overdue";
      if (due === today.getTime()) return "today";
    }
    if (it.state && STARTED_STATES.has(it.state)) return "started";
    return null;
  };

  // Most urgent first: overdue, then due-today, then started, then the rest.
  // Ties break by due date ascending (soonest first; no-due-date sinks last).
  const RANK = { overdue: 0, today: 1, started: 2 } as const;
  const rank = (it: (typeof rawItems)[number]) => {
    const u = urgency(it);
    return u ? RANK[u] : 3;
  };
  // Resolved items live in their own section; keep them out of the actionable list.
  const isResolved = (it: (typeof rawItems)[number]) => !!it.state && RESOLVED_STATES.has(it.state);
  const resolved = rawItems.filter(isResolved);
  const items = rawItems.filter((it) => !isResolved(it)).sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const da = a.dueDate?.getTime() ?? Infinity;
    const db = b.dueDate?.getTime() ?? Infinity;
    return da - db;
  });
  const URGENCY_LABEL: Record<"overdue" | "today" | "started", { text: string; cls: string }> = {
    overdue: { text: "Overdue", cls: "bg-red-50 text-red-600" },
    today: { text: "Due today", cls: "bg-amber-50 text-amber-600" },
    started: { text: "Started", cls: "bg-blue-50 text-blue-600" },
  };

  const fmt = (d: Date | null) =>
    d ? `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}` : "—";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Sprint</h1>
        {version && <span className="text-sm text-gray-500">Version {version}</span>}
      </div>

      {!version ? (
        <p className="text-sm text-gray-400 text-center py-10">No sprint has been imported yet.</p>
      ) : rawItems.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No sprint items are assigned to you this sprint.</p>
      ) : (
       <>
        {items.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Item</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">State</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Est.</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Start</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Due</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Add</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it) => {
                const u = urgency(it);
                return (
                <tr key={it.id}>
                  <td className="px-4 py-3">
                    <p className="text-gray-900">
                      <span className="text-gray-400">#{it.externalId}</span> {it.title}
                      {u && (
                        <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${URGENCY_LABEL[u].cls}`}>
                          {URGENCY_LABEL[u].text}
                        </span>
                      )}
                    </p>
                    {it.tags && <p className="text-xs text-gray-400 mt-0.5">{it.tags}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{it.workItemType || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{it.state || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{it.estimate || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmt(it.startDate)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="whitespace-nowrap">{fmt(it.dueDate)}</span>
                    {u && (
                      <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${URGENCY_LABEL[u].cls}`}>
                        {URGENCY_LABEL[u].text}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u && (
                      <AddToToday
                        title={it.title}
                        estimatedHours={parseEstimateHours(it.estimate) ?? 1}
                        externalId={it.externalId}
                      />
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}

        {resolved.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-500 mb-2">Resolved ({resolved.length})</h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Item</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">State</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {resolved.map((it) => (
                  <tr key={it.id} className="text-gray-500">
                    <td className="px-4 py-3">
                      <span className="text-gray-400">#{it.externalId}</span> {it.title}
                    </td>
                    <td className="px-4 py-3">{it.workItemType || "—"}</td>
                    <td className="px-4 py-3">{it.state || "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmt(it.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}
       </>
      )}
    </div>
  );
}
