"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Team scope for Insights: "All" (every team) or one specific team (Dev, DevOps,
// QA…). Teams are dynamic, so this is a select rather than a fixed toggle. Writes
// ?team=<id> to the URL (dropped when "all"), preserving other params, so the
// server page re-fetches filtered.
export function TeamFilter({ current, teams }: { current: string; teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(teamId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (teamId === "all") params.delete("team");
    else params.set("team", teamId);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <label className="flex items-center gap-2 text-xs text-[#9c968d]">
      Team
      <select
        value={current}
        onChange={(e) => select(e.target.value)}
        className="border border-[#ece8e1] rounded-[10px] px-2.5 py-1.5 text-xs text-[#6b665f] bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55]"
      >
        <option value="all">All teams</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
