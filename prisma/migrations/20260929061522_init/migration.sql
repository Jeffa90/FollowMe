-- CreateEnum
CREATE TYPE "Role" AS ENUM ('AUTHOR', 'PROCESS_OWNER', 'REVIEWER', 'APPROVER', 'PUBLISHER', 'LEARNER', 'ADMIN', 'AUDITOR');

-- CreateEnum
CREATE TYPE "Classification" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "GuideStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'READY_FOR_APPROVAL', 'APPROVED', 'PUBLISHED', 'UNDER_REVIEW', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VersionSource" AS ENUM ('MANUAL', 'CAPTURE', 'IMPORT', 'REVISION', 'URGENT_CORRECTION', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "DecisionPhase" AS ENUM ('REVIEW', 'APPROVAL');

-- CreateEnum
CREATE TYPE "DecisionKind" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_CHANGES');

-- CreateEnum
CREATE TYPE "AssetPurpose" AS ENUM ('EVIDENCE', 'CONTENT', 'ATTACHMENT', 'IMPORT_SOURCE', 'IMPORT_IMAGE');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('RECORDING', 'PAUSED', 'STOPPED', 'PROCESSED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'NEEDS_REVIEW', 'CONFIRMED', 'REJECTED', 'FAILED', 'DUPLICATE', 'DRY_RUN_OK');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('RATING', 'OUTDATED', 'UNCLEAR', 'BROKEN_LINK', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('BLOCKING_ERROR', 'WARNING', 'SUGGESTION', 'ACCEPTED_EXCEPTION');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'ACCEPTED_EXCEPTION', 'RESOLVED');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "dataRegion" TEXT NOT NULL DEFAULT 'uk-south',
    "aiPolicy" JSONB NOT NULL DEFAULT '{}',
    "capturePolicy" JSONB NOT NULL DEFAULT '{}',
    "retentionPolicy" JSONB NOT NULL DEFAULT '{}',
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siteId" TEXT,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "roles" "Role"[],
    "clearance" "Classification" NOT NULL DEFAULT 'INTERNAL',
    "siteId" TEXT,
    "teamId" TEXT,
    "allSites" BOOLEAN NOT NULL DEFAULT true,
    "siteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jobTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "definition" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reviewMin" INTEGER NOT NULL DEFAULT 1,
    "stages" JSONB NOT NULL,
    "requireSegregation" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxonomyTerm" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "TaxonomyTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Synonym" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SYNONYM',
    "term" TEXT NOT NULL,
    "expansions" TEXT[],

    CONSTRAINT "Synonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetiredReference" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "replacement" TEXT,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "RetiredReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guide" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "workflowId" TEXT,
    "title" TEXT NOT NULL,
    "ownerId" TEXT,
    "backupOwnerId" TEXT,
    "escalationUserId" TEXT,
    "escalationPath" TEXT NOT NULL DEFAULT '',
    "reviewFrequencyDays" INTEGER NOT NULL DEFAULT 365,
    "siteId" TEXT,
    "businessUnit" TEXT,
    "department" TEXT,
    "processCode" TEXT,
    "functionCode" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "systems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "websites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "urlPatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sapTransactions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "businessRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "classification" "Classification" NOT NULL DEFAULT 'INTERNAL',
    "criticality" "Criticality" NOT NULL DEFAULT 'MEDIUM',
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "liveVersionId" TEXT,
    "orphanedSince" TIMESTAMP(3),

    CONSTRAINT "Guide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuideVersion" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" "GuideStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "authorId" TEXT NOT NULL,
    "contributorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submissionCycle" INTEGER NOT NULL DEFAULT 0,
    "source" "VersionSource" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "importConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "revisionSummary" TEXT NOT NULL DEFAULT '',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "urgentReason" TEXT,
    "controlSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "supersededByNumber" INTEGER,

    CONSTRAINT "GuideVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "phase" "DecisionPhase" NOT NULL,
    "stageIndex" INTEGER NOT NULL DEFAULT 0,
    "stageName" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "decision" "DecisionKind" NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "purpose" "AssetPurpose" NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guideId" TEXT,
    "captureSessionId" TEXT,
    "importItemId" TEXT,
    "scanResult" TEXT NOT NULL DEFAULT 'clean',

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSession" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CaptureStatus" NOT NULL DEFAULT 'RECORDING',
    "title" TEXT,
    "startUrl" TEXT,
    "appName" TEXT,
    "extensionVersion" TEXT,
    "policySnapshot" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "guideId" TEXT,
    "versionId" TEXT,
    "eventCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CaptureSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "url" TEXT NOT NULL,
    "pageTitle" TEXT NOT NULL DEFAULT '',
    "target" JSONB NOT NULL DEFAULT '{}',
    "viewport" JSONB NOT NULL DEFAULT '{}',
    "rect" JSONB,
    "screenshotAssetId" TEXT,
    "redactions" JSONB NOT NULL DEFAULT '[]',
    "sensitiveHits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CaptureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'UPLOAD',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "totals" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "batchId" TEXT,
    "createdById" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "extracted" JSONB,
    "conversion" JSONB,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "guideId" TEXT,
    "versionId" TEXT,
    "duplicateOfId" TEXT,
    "groupKeys" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "stepId" TEXT,
    "userId" TEXT,
    "kind" "FeedbackKind" NOT NULL,
    "rating" INTEGER,
    "comment" TEXT NOT NULL DEFAULT '',
    "status" "WorkStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRecommendation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "versionId" TEXT,
    "source" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "ReviewRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthFinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "stepId" TEXT,
    "message" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "exceptionReason" TEXT,
    "acceptedById" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBlock" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requiresReapproval" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBlockVersion" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentBlockVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessMap" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchChunk" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "stepId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tsv" tsvector,

    CONSTRAINT "SearchChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalised" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'web',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favourite" (
    "userId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favourite_pkey" PRIMARY KEY ("userId","guideId")
);

-- CreateTable
CREATE TABLE "RecentView" (
    "userId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentView_pkey" PRIMARY KEY ("userId","guideId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "guideId" TEXT,
    "versionId" TEXT,
    "summary" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "requestId" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL DEFAULT 'default',
    "type" TEXT NOT NULL,
    "orgId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "responseCode" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "exportedById" TEXT NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sha256" TEXT NOT NULL,
    "controlRef" TEXT NOT NULL,

    CONSTRAINT "ExportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "stepId" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "uncertainty" JSONB NOT NULL DEFAULT '{}',
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiQuestion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answered" BOOLEAN NOT NULL,
    "citedGuides" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provider" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Acknowledgement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),

    CONSTRAINT "Acknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencySignoff" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "assessorId" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reassessOn" TIMESTAMP(3),

    CONSTRAINT "CompetencySignoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Site_orgId_code_key" ON "Site"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Team_orgId_name_key" ON "Team"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "User_orgId_email_key" ON "User"("orgId", "email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_orgId_key_key" ON "Template"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_orgId_key_key" ON "Workflow"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyTerm_orgId_kind_code_key" ON "TaxonomyTerm"("orgId", "kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Synonym_orgId_kind_term_key" ON "Synonym"("orgId", "kind", "term");

-- CreateIndex
CREATE UNIQUE INDEX "RetiredReference_orgId_kind_value_key" ON "RetiredReference"("orgId", "kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Guide_shortCode_key" ON "Guide"("shortCode");

-- CreateIndex
CREATE UNIQUE INDEX "Guide_liveVersionId_key" ON "Guide"("liveVersionId");

-- CreateIndex
CREATE INDEX "Guide_orgId_ownerId_idx" ON "Guide"("orgId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Guide_orgId_documentId_key" ON "Guide"("orgId", "documentId");

-- CreateIndex
CREATE INDEX "GuideVersion_orgId_status_idx" ON "GuideVersion"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GuideVersion_guideId_number_key" ON "GuideVersion"("guideId", "number");

-- CreateIndex
CREATE INDEX "ApprovalDecision_versionId_idx" ON "ApprovalDecision"("versionId");

-- CreateIndex
CREATE INDEX "Asset_orgId_sha256_idx" ON "Asset"("orgId", "sha256");

-- CreateIndex
CREATE INDEX "Asset_guideId_idx" ON "Asset"("guideId");

-- CreateIndex
CREATE INDEX "CaptureSession_orgId_userId_idx" ON "CaptureSession"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureEvent_sessionId_seq_key" ON "CaptureEvent"("sessionId", "seq");

-- CreateIndex
CREATE INDEX "ImportItem_orgId_status_idx" ON "ImportItem"("orgId", "status");

-- CreateIndex
CREATE INDEX "ImportItem_batchId_idx" ON "ImportItem"("batchId");

-- CreateIndex
CREATE INDEX "Feedback_guideId_kind_idx" ON "Feedback"("guideId", "kind");

-- CreateIndex
CREATE INDEX "ReviewRecommendation_orgId_status_idx" ON "ReviewRecommendation"("orgId", "status");

-- CreateIndex
CREATE INDEX "ReviewRecommendation_guideId_dedupeKey_idx" ON "ReviewRecommendation"("guideId", "dedupeKey");

-- CreateIndex
CREATE INDEX "HealthFinding_guideId_idx" ON "HealthFinding"("guideId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthFinding_versionId_ruleId_stepId_key" ON "HealthFinding"("versionId", "ruleId", "stepId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBlock_orgId_key_key" ON "ContentBlock"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBlockVersion_blockId_version_key" ON "ContentBlockVersion"("blockId", "version");

-- CreateIndex
CREATE INDEX "SearchChunk_orgId_guideId_idx" ON "SearchChunk"("orgId", "guideId");

-- CreateIndex
CREATE INDEX "SearchChunk_versionId_idx" ON "SearchChunk"("versionId");

-- CreateIndex
CREATE INDEX "SearchLog_orgId_at_idx" ON "SearchLog"("orgId", "at");

-- CreateIndex
CREATE INDEX "ViewEvent_orgId_guideId_idx" ON "ViewEvent"("orgId", "guideId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_guideId_idx" ON "AuditEvent"("orgId", "guideId");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_action_idx" ON "AuditEvent"("orgId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_orgId_seq_key" ON "AuditEvent"("orgId", "seq");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "AiSuggestion_versionId_idx" ON "AiSuggestion"("versionId");

-- CreateIndex
CREATE INDEX "AiQuestion_orgId_answered_idx" ON "AiQuestion"("orgId", "answered");

-- CreateIndex
CREATE INDEX "Acknowledgement_guideId_kind_idx" ON "Acknowledgement"("guideId", "kind");

-- CreateIndex
CREATE INDEX "Acknowledgement_userId_idx" ON "Acknowledgement"("userId");

-- CreateIndex
CREATE INDEX "QuizAttempt_guideId_idx" ON "QuizAttempt"("guideId");

-- CreateIndex
CREATE INDEX "CompetencySignoff_guideId_idx" ON "CompetencySignoff"("guideId");

-- CreateIndex
CREATE INDEX "CompetencySignoff_learnerId_idx" ON "CompetencySignoff"("learnerId");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideVersion" ADD CONSTRAINT "GuideVersion_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "GuideVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureEvent" ADD CONSTRAINT "CaptureEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportItem" ADD CONSTRAINT "ImportItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecommendation" ADD CONSTRAINT "ReviewRecommendation_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthFinding" ADD CONSTRAINT "HealthFinding_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBlockVersion" ADD CONSTRAINT "ContentBlockVersion_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "ContentBlock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favourite" ADD CONSTRAINT "Favourite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentView" ADD CONSTRAINT "RecentView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
