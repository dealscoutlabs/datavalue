import { execSync } from "node:child_process";

/**
 * Restores the demo organisation to its seeded state before the suite runs.
 * The seed is idempotent and deliberately clears the demo questionnaire, so
 * every run starts from "measured, but no rights answers and therefore no
 * dollar figure anywhere".
 */
export default function globalSetup() {
  execSync("npx dotenv -e .env -- tsx prisma/seed.ts", { stdio: "inherit" });
}
