/**
 * Seed.
 *
 * Creates:
 *  - the active valuation formula version and its illustrative reference rates
 *  - a platform admin account
 *  - the demo organisation, with five sources already measured
 *
 * The demo organisation is seeded WITHOUT a questionnaire response on purpose.
 * That is the honest starting state: with no rights answers, every source is
 * REVIEW_REQUIRED and no dollar figure appears anywhere. Completing the
 * questionnaire inside the demo is what unlocks rates for the sources that pass,
 * and it leaves the communications corpora suppressed — which is exactly the
 * behaviour worth showing.
 */
import { PrismaClient } from "../src/generated/prisma";
import { DEFAULT_FORMULA_PARAMETERS, FORMULA_VERSION } from "../src/lib/valuation/engine";
import { SEED_RATES, FORMULA_DESCRIPTION } from "../src/lib/valuation/seed-rates";
import { DEMO_ACCOUNT_LABELS, DEMO_PROVIDERS, demoMetricsFor } from "../src/lib/connectors/demo";
import { DEMO_USER_EMAIL, DEMO_USER_PASSWORD } from "../src/config/demo";
import { refreshEligibility } from "../src/lib/eligibility/service";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@datavalue.example";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin-inventory-2026";

async function main() {
  // ---------------------------------------------------------------- formula
  const formula = await prisma.valuationFormulaVersion.upsert({
    where: { version: FORMULA_VERSION },
    create: {
      version: FORMULA_VERSION,
      description: FORMULA_DESCRIPTION,
      parameters: DEFAULT_FORMULA_PARAMETERS,
      isActive: true,
    },
    update: { description: FORMULA_DESCRIPTION, parameters: DEFAULT_FORMULA_PARAMETERS, isActive: true },
  });
  console.log(`formula version ${formula.version}`);

  for (const rate of SEED_RATES) {
    await prisma.valuationRate.upsert({
      where: {
        formulaVersionId_provider_unitType: {
          formulaVersionId: formula.id,
          provider: rate.provider,
          unitType: rate.unitType,
        },
      },
      create: { formulaVersionId: formula.id, ...rate },
      update: { baseRate: rate.baseRate, sourceNote: rate.sourceNote },
    });
  }
  console.log(`${SEED_RATES.length} reference rates seeded`);

  // ---------------------------------------------------------------- admin
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      email: ADMIN_EMAIL,
      name: "Platform admin",
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
      isPlatformAdmin: true,
    },
    update: { isPlatformAdmin: true },
  });
  console.log(`admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);

  // ---------------------------------------------------------------- demo org
  const demoUser = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    create: {
      email: DEMO_USER_EMAIL,
      name: "Jordan Okafor",
      passwordHash: await bcrypt.hash(DEMO_USER_PASSWORD, 12),
    },
    update: {},
  });

  let org = await prisma.organization.findFirst({ where: { isDemo: true } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: "Northwind Supply Co. (Demo)",
        website: "northwind-supply.example",
        industry: "Logistics & transport",
        employeeRange: "50–199",
        isDemo: true,
        members: { create: { userId: demoUser.id, role: "OWNER" } },
      },
    });
  } else {
    await prisma.organizationMember.upsert({
      where: { userId_organizationId: { userId: demoUser.id, organizationId: org.id } },
      create: { userId: demoUser.id, organizationId: org.id, role: "OWNER" },
      update: {},
    });
  }

  // A previous seed's questionnaire would change the demo's starting state, so
  // clear it: the demo must begin with no rights answers and therefore no rates.
  await prisma.questionnaireResponse.deleteMany({ where: { organizationId: org.id } });

  for (const provider of DEMO_PROVIDERS) {
    const metrics = demoMetricsFor(provider);

    const existing = await prisma.providerConnection.findFirst({
      where: { organizationId: org.id, provider },
    });
    const connection =
      existing ??
      (await prisma.providerConnection.create({
        data: {
          organizationId: org.id,
          provider,
          isDemo: true,
          status: metrics.scopeLimited ? "SCOPE_LIMITED" : "SCANNED",
          accountLabel: DEMO_ACCOUNT_LABELS[provider],
          scanPath: provider === "MICROSOFT" ? "delegated" : null,
          connectedAt: new Date("2026-08-14T10:00:00.000Z"),
        },
      }));

    if (existing) {
      await prisma.providerConnection.update({
        where: { id: existing.id },
        data: {
          status: metrics.scopeLimited ? "SCOPE_LIMITED" : "SCANNED",
          disconnectedAt: null,
          lastError: null,
        },
      });
    }

    await prisma.scanJob.deleteMany({ where: { connectionId: connection.id } });
    await prisma.scanJob.create({
      data: {
        organizationId: org.id,
        connectionId: connection.id,
        status: "SUCCEEDED",
        progressPct: 100,
        progressLabel: "Scan complete",
        pagesCompleted: 4,
        itemsSeen: Math.round(metrics.totalFiles + metrics.totalRecords),
        partialTotals: metrics as unknown as object,
        startedAt: new Date("2026-08-14T10:00:00.000Z"),
        finishedAt: new Date("2026-08-14T10:04:00.000Z"),
      },
    });

    const metricData = {
      unitType: metrics.unitType,
      totalBytes: BigInt(Math.round(metrics.totalBytes)),
      totalRecords: BigInt(Math.round(metrics.totalRecords)),
      totalFiles: BigInt(Math.round(metrics.totalFiles)),
      categoryMix: metrics.categoryMix,
      recordBreakdown: metrics.recordBreakdown,
      oldestItemAt: metrics.oldestItemAt ? new Date(metrics.oldestItemAt) : null,
      newestItemAt: metrics.newestItemAt ? new Date(metrics.newestItemAt) : null,
      confidence: metrics.confidence,
      method: metrics.method,
      caveats: metrics.caveats,
      scopeLimited: metrics.scopeLimited,
      isDemo: true,
      measuredAt: new Date("2026-08-14T10:04:00.000Z"),
    };

    await prisma.dataAssetMetric.upsert({
      where: { connectionId: connection.id },
      create: { organizationId: org.id, connectionId: connection.id, provider, ...metricData },
      update: metricData,
    });
  }

  const eligibility = await refreshEligibility(org.id);
  console.log(`demo: ${DEMO_USER_EMAIL} / ${DEMO_USER_PASSWORD}`);
  console.log(`demo org eligibility: ${eligibility.status} (rates unlocked: ${eligibility.ratesUnlocked})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
