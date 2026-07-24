-- Server-side "last login" signal. Stamped on each successful credential login.
-- JWT sessions are not persisted, so this is the only real login timestamp.
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
