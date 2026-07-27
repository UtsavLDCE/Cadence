import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { NavBar } from "@/components/nav-bar";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  // Only surface "My Sprint" once a sprint CSV has been imported.
  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  const hasSprint = !!settings?.currentSprintVersion;

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar user={session.user} hasSprint={hasSprint} />
      <main className="flex-1 w-full px-[26px] pt-[34px] pb-20">{children}</main>
    </div>
  );
}
