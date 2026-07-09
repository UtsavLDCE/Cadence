// Fresh-install seed: ensure one admin user exists. Idempotent — upsert on
// email, so re-running (every migrate) never duplicates or clobbers a changed
// password. ponytail: hardcoded default creds; change them in the UI after
// first login.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const email = "admin@admin.com";
const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  console.log(`Seed: admin ${email} already exists — skipping.`);
} else {
  await prisma.user.create({
    data: {
      name: "Admin",
      email,
      password: await bcrypt.hash("admin", 12),
      role: "ADMIN",
    },
  });
  console.log(`Seed: created admin ${email} (password: admin).`);
}

await prisma.$disconnect();
