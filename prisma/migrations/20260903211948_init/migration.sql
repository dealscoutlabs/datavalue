-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProviderKey" AS ENUM ('DROPBOX', 'HUBSPOT', 'MICROSOFT', 'GOOGLE', 'SLACK', 'DEMO');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'SCANNING', 'SCANNED', 'PARTIAL', 'EXPIRED', 'SCOPE_LIMITED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'RUNNING', 'PARTIAL', 'SUCCEEDED', 'FAILED', 'RATE_LIMITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConfidenceTier" AS ENUM ('EXACT', 'DERIVED', 'SAMPLED', 'SCOPE_LIMITED');

-- CreateEnum
CREATE TYPE "DataUnitType" AS ENUM ('UNSTRUCTURED_BYTES', 'STRUCTURED_RECORDS');

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('EMAIL', 'PHONE', 'EITHER');

-- CreateEnum
CREATE TYPE "TriState" AS ENUM ('YES', 'NO', 'UNSURE');

-- CreateEnum
CREATE TYPE "EligibilityStatus" AS ENUM ('LIKELY_ELIGIBLE', 'REVIEW_REQUIRED', 'LIKELY_INELIGIBLE');

-- CreateEnum
CREATE TYPE "OfferRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT,
    "employeeRange" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "ProviderKey" NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "accountLabel" TEXT,
    "accountDomain" TEXT,
    "externalId" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT,
    "scanPath" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "provider" "ProviderKey" NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "progressLabel" TEXT,
    "pagesCompleted" INTEGER NOT NULL DEFAULT 0,
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "partialTotals" JSONB,
    "lastError" TEXT,
    "errorCode" TEXT,
    "resumable" BOOLEAN NOT NULL DEFAULT true,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanCheckpoint" (
    "id" TEXT NOT NULL,
    "scanJobId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "cursor" TEXT,
    "samplingJson" JSONB,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataAssetMetric" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "ProviderKey" NOT NULL,
    "unitType" "DataUnitType" NOT NULL,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "totalRecords" BIGINT NOT NULL DEFAULT 0,
    "totalFiles" BIGINT NOT NULL DEFAULT 0,
    "categoryMix" JSONB,
    "recordBreakdown" JSONB,
    "oldestItemAt" TIMESTAMP(3),
    "newestItemAt" TIMESTAMP(3),
    "confidence" "ConfidenceTier" NOT NULL,
    "method" TEXT NOT NULL,
    "caveats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopeLimited" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataAssetMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireResponse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "dataAgeRange" TEXT NOT NULL,
    "originCreatedOrControlled" "TriState" NOT NULL,
    "thirdPartyPii" "TriState" NOT NULL,
    "ndaBoundMaterial" "TriState" NOT NULL,
    "employeePersonalData" "TriState" NOT NULL,
    "uniqueness" TEXT NOT NULL,
    "alreadyLicensed" "TriState" NOT NULL,
    "exclusivityPossible" "TriState" NOT NULL,
    "personalData" "TriState" NOT NULL,
    "healthData" "TriState" NOT NULL,
    "financialData" "TriState" NOT NULL,
    "childrensData" "TriState" NOT NULL,
    "biometricData" "TriState" NOT NULL,
    "legalPrivilegeData" "TriState" NOT NULL,
    "credentialData" "TriState" NOT NULL,
    "exportControlledData" "TriState" NOT NULL,
    "willingToAnonymize" "TriState" NOT NULL,
    "contactMethod" "ContactMethod" NOT NULL DEFAULT 'EMAIL',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT,
    "status" "EligibilityStatus" NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "ratesUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValuationFormulaVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationFormulaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValuationRate" (
    "id" TEXT NOT NULL,
    "formulaVersionId" TEXT NOT NULL,
    "provider" "ProviderKey" NOT NULL,
    "unitType" "DataUnitType" NOT NULL,
    "baseRate" DOUBLE PRECISION NOT NULL,
    "sourceNote" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValuationSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "formulaVersionId" TEXT NOT NULL,
    "unitType" "DataUnitType" NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "lowRate" DOUBLE PRECISION NOT NULL,
    "midRate" DOUBLE PRECISION NOT NULL,
    "highRate" DOUBLE PRECISION NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactRole" TEXT NOT NULL,
    "businessEmail" TEXT NOT NULL,
    "phone" TEXT,
    "companyName" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT NOT NULL,
    "employeeRange" TEXT NOT NULL,
    "sourceSummary" JSONB NOT NULL,
    "eligibilitySummary" JSONB NOT NULL,
    "questionnaireSnapshot" JSONB NOT NULL,
    "consentToContact" BOOLEAN NOT NULL,
    "acknowledgedNotAnOffer" BOOLEAN NOT NULL,
    "status" "OfferRequestStatus" NOT NULL DEFAULT 'NEW',
    "notifiedAt" TIMESTAMP(3),
    "notifyError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "OrganizationMember_organizationId_idx" ON "OrganizationMember"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_userId_organizationId_key" ON "OrganizationMember"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "ProviderConnection_organizationId_provider_idx" ON "ProviderConnection"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_state_key" ON "OAuthState"("state");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "ScanJob_organizationId_idx" ON "ScanJob"("organizationId");

-- CreateIndex
CREATE INDEX "ScanJob_connectionId_status_idx" ON "ScanJob"("connectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScanCheckpoint_scanJobId_stream_key" ON "ScanCheckpoint"("scanJobId", "stream");

-- CreateIndex
CREATE INDEX "DataAssetMetric_organizationId_idx" ON "DataAssetMetric"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DataAssetMetric_connectionId_key" ON "DataAssetMetric"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireResponse_organizationId_key" ON "QuestionnaireResponse"("organizationId");

-- CreateIndex
CREATE INDEX "EligibilityAssessment_organizationId_createdAt_idx" ON "EligibilityAssessment"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ValuationFormulaVersion_version_key" ON "ValuationFormulaVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "ValuationRate_formulaVersionId_provider_unitType_key" ON "ValuationRate"("formulaVersionId", "provider", "unitType");

-- CreateIndex
CREATE INDEX "ValuationSnapshot_organizationId_createdAt_idx" ON "ValuationSnapshot"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OfferRequest_organizationId_idx" ON "OfferRequest"("organizationId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanCheckpoint" ADD CONSTRAINT "ScanCheckpoint_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAssetMetric" ADD CONSTRAINT "DataAssetMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAssetMetric" ADD CONSTRAINT "DataAssetMetric_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireResponse" ADD CONSTRAINT "QuestionnaireResponse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityAssessment" ADD CONSTRAINT "EligibilityAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityAssessment" ADD CONSTRAINT "EligibilityAssessment_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationRate" ADD CONSTRAINT "ValuationRate_formulaVersionId_fkey" FOREIGN KEY ("formulaVersionId") REFERENCES "ValuationFormulaVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationSnapshot" ADD CONSTRAINT "ValuationSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationSnapshot" ADD CONSTRAINT "ValuationSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationSnapshot" ADD CONSTRAINT "ValuationSnapshot_formulaVersionId_fkey" FOREIGN KEY ("formulaVersionId") REFERENCES "ValuationFormulaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRequest" ADD CONSTRAINT "OfferRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
