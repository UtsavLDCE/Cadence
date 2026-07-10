-- Direct per-user reporting line (User.managerId self-reference).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "managerId" TEXT;

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_managerId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
