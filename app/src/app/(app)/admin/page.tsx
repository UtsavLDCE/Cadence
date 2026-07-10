import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AdminClient } from "./admin-client";

export default async function AdminPage() {
  const session = await auth();
  if (session!.user.role !== "ADMIN") redirect("/dashboard");

  const [users, teams, settings] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teamId: true,
        managerId: true,
        excludedFromInsights: true,
        team: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true, email: true } },
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
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Panel</h1>
      <AdminClient
        users={JSON.parse(JSON.stringify(users))}
        teams={JSON.parse(JSON.stringify(teams))}
        settings={JSON.parse(JSON.stringify(settings))}
      />
    </div>
  );
}
