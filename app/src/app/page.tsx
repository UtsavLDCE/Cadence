import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function RootPage() {
  const session = await auth();
  // CXO has no dashboard/personal screens — land on the team Feed instead.
  if (session) redirect(session.user.role === "CXO" ? "/feed" : "/dashboard");
  redirect("/login");
}
