import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { todayDate, formatDate } from "@/lib/utils";
import { getTeamsConfig, teamsConfigStatus } from "@/lib/integrations/teams";
import { AdminClient } from "./admin-client";

export default async function AdminPage() {
  const session = await auth();
  if (session!.user.role !== "ADMIN") redirect("/dashboard");

  const today = todayDate();

  const [users, teams, settings, members, todaysPrompts] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teamId: true,
        excludedFromInsights: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    prisma.team.findMany({
      include: {
        manager: { select: { id: true, name: true, email: true } },
        _count: { select: { members: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    }),
    prisma.user.findMany({
      where: { role: "MEMBER", email: { not: null } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.teamsPrompt.findMany({
      where: { date: today },
      select: { userId: true, phase: true, sentAt: true, respondedAt: true },
    }),
  ]);

  // Fold today's prompt rows into a per-member morning/eod status for the table.
  type PhaseState = { sentAt: string; respondedAt: string | null } | null;
  const promptByUser = new Map<string, { MORNING: PhaseState; EOD: PhaseState }>();
  for (const m of members) promptByUser.set(m.id, { MORNING: null, EOD: null });
  for (const p of todaysPrompts) {
    const entry = promptByUser.get(p.userId);
    if (!entry) continue;
    entry[p.phase] = { sentAt: p.sentAt.toISOString(), respondedAt: p.respondedAt?.toISOString() ?? null };
  }
  const teamsStatus = members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    ...promptByUser.get(m.id)!,
  }));

  const cfg = await getTeamsConfig();
  const teams_config = teamsConfigStatus(cfg);
  // The page is ADMIN-gated, so it's safe to hand the editable values to the form.
  // The secret is sent only as a "set/not set" flag — never the raw value — and the
  // form overwrites it on save only when a new one is typed.
  const teamsSettings = {
    enabled: cfg.enabled,
    flowUrl: settings.teamsFlowUrl ?? "",
    secretSet: cfg.sharedSecret.length > 0,
  };

  // Keep the shared secret out of the client payload entirely.
  const { teamsSharedSecret: _omit, ...safeSettings } = settings;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Panel</h1>
      <AdminClient
        users={JSON.parse(JSON.stringify(users))}
        teams={JSON.parse(JSON.stringify(teams))}
        settings={JSON.parse(JSON.stringify(safeSettings))}
        teamsToday={JSON.parse(JSON.stringify(teamsStatus))}
        teamsConfig={teams_config}
        teamsSettings={teamsSettings}
        teamsDateLabel={formatDate(today)}
      />
    </div>
  );
}
