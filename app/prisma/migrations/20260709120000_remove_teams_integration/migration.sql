-- Remove Microsoft Teams integration: prompt log, per-settings config, phase enum.
DROP TABLE IF EXISTS "TeamsPrompt";
DROP TYPE IF EXISTS "PromptPhase";

ALTER TABLE "AppSettings"
  DROP COLUMN IF EXISTS "teamsEnabled",
  DROP COLUMN IF EXISTS "teamsFlowUrl",
  DROP COLUMN IF EXISTS "teamsSharedSecret";
