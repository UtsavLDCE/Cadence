import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { NavBar } from "@/components/nav-bar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar user={session.user} />
      <main className="flex-1 w-full mx-auto px-4 lg:px-8 py-6 max-w-[1600px]">
        {children}
      </main>
    </div>
  );
}
