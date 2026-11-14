import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma's generated client. Not our source; not ours to lint.
    "src/generated/**",
    "playwright-report/**",
    "test-results/**",
    // RoofSignal is a separate app with its own lint config (roofsignal/web).
    "roofsignal/**",
  ]),
]);

export default eslintConfig;
