import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  // Never expose the shared secret over the shared GET (any signed-in user can
  // call this). Report only whether one is set; the admin page reads the raw
  // value directly from the DB server-side when it needs to prefill the field.
  const { teamsSharedSecret, ...safe } = settings;
  return NextResponse.json({ ...safe, teamsSecretSet: teamsSharedSecret.length > 0 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { cutoffTime, timezone, teamsEnabled, teamsFlowUrl, teamsSharedSecret } = body as {
    cutoffTime?: string;
    timezone?: string;
    teamsEnabled?: boolean;
    teamsFlowUrl?: string;
    teamsSharedSecret?: string;
  };

  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {
      ...(cutoffTime && { cutoffTime }),
      ...(timezone && { timezone }),
      ...(typeof teamsEnabled === "boolean" && { teamsEnabled }),
      ...(typeof teamsFlowUrl === "string" && { teamsFlowUrl: teamsFlowUrl.trim() }),
      // Only overwrite the secret when a non-empty value is supplied, so saving the
      // form without re-typing the secret leaves the stored one intact.
      ...(typeof teamsSharedSecret === "string" && teamsSharedSecret.trim() !== "" && {
        teamsSharedSecret: teamsSharedSecret.trim(),
      }),
    },
    create: { id: "singleton" },
  });

  const { teamsSharedSecret: _secret, ...safe } = settings;
  return NextResponse.json({ ...safe, teamsSecretSet: settings.teamsSharedSecret.length > 0 });
}
