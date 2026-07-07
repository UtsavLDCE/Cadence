import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayDate, formatDate } from "@/lib/utils";
import { getTeamsConfig, postToFlow, buildMorningCard } from "@/lib/integrations/teams";

// POST /api/integrations/teams/test
// Admin-only. Sends a single morning planning card to the admin's OWN Teams DM so
// they can confirm the Power Automate flow + secret + email mapping work end to
// end before turning the daily loop on. It does NOT record a TeamsPrompt and does
// NOT require the integration to be enabled — it's a config smoke test. Any reply
// to this card still flows through /ingest normally (the admin is a real user).
export async function POST() {
  const session = await auth();
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cfg = await getTeamsConfig();
  if (!cfg.flowUrl) {
    return NextResponse.json(
      { error: "Set the Power Automate flow URL first." },
      { status: 503 },
    );
  }
  if (!cfg.sharedSecret) {
    return NextResponse.json(
      { error: "Set a shared secret first." },
      { status: 503 },
    );
  }

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true },
  });
  if (!me?.email) {
    return NextResponse.json(
      { error: "Your account has no email, so Teams can't match you." },
      { status: 400 },
    );
  }

  const today = todayDate();
  const card = buildMorningCard({ name: me.name, dateLabel: `Test message · ${formatDate(today)}` });

  const sent = await postToFlow(
    {
      phase: "morning",
      email: me.email,
      name: me.name,
      date: today.toISOString().slice(0, 10),
      card,
    },
    cfg,
  );

  if (!sent.ok) {
    return NextResponse.json(
      { error: sent.error ?? `Flow returned HTTP ${sent.status}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, email: me.email });
}
