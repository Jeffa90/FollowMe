-- Full-text search: generated tsvector on SearchChunk (title weighted above body text)
ALTER TABLE "SearchChunk" DROP COLUMN "tsv";
ALTER TABLE "SearchChunk" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("text", '')), 'B')
) STORED;
CREATE INDEX "SearchChunk_tsv_idx" ON "SearchChunk" USING GIN ("tsv");

-- Published versions are immutable: content and control data cannot change once a
-- version leaves the editable states (DRAFT, CHANGES_REQUESTED). Enforced in the
-- database as a defence in depth behind the service layer.
CREATE OR REPLACE FUNCTION followme_guide_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('DRAFT') THEN
      RAISE EXCEPTION 'GuideVersion % is % and cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('IN_REVIEW','READY_FOR_APPROVAL','APPROVED','PUBLISHED','UNDER_REVIEW','SUPERSEDED','ARCHIVED') THEN
    IF NEW."content" IS DISTINCT FROM OLD."content"
       OR NEW."contentHash" <> OLD."contentHash"
       OR NEW."number" <> OLD."number"
       OR NEW."guideId" <> OLD."guideId"
       OR NEW."authorId" <> OLD."authorId" THEN
      RAISE EXCEPTION 'GuideVersion % is % and its content is immutable', OLD.id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF OLD.status IN ('PUBLISHED','UNDER_REVIEW','SUPERSEDED','ARCHIVED') THEN
    IF NEW."controlSnapshot" IS DISTINCT FROM OLD."controlSnapshot"
       OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR NEW."publishedById" IS DISTINCT FROM OLD."publishedById"
       OR NEW."effectiveDate" IS DISTINCT FROM OLD."effectiveDate"
       OR NEW."revisionSummary" <> OLD."revisionSummary"
       OR NEW."label" <> OLD."label" THEN
      RAISE EXCEPTION 'GuideVersion % is % and its control record is immutable', OLD.id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'ARCHIVED'
       OR (OLD.status = 'SUPERSEDED' AND NEW.status <> 'ARCHIVED')
       OR (OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('UNDER_REVIEW','SUPERSEDED','ARCHIVED'))
       OR (OLD.status = 'UNDER_REVIEW' AND NEW.status NOT IN ('PUBLISHED','SUPERSEDED','ARCHIVED'))
       OR (OLD.status = 'APPROVED' AND NEW.status NOT IN ('PUBLISHED','ARCHIVED')) THEN
      RAISE EXCEPTION 'Illegal GuideVersion status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER followme_guide_version_guard
BEFORE UPDATE OR DELETE ON "GuideVersion"
FOR EACH ROW EXECUTE FUNCTION followme_guide_version_guard();

-- Audit events and approval decisions are append-only.
CREATE OR REPLACE FUNCTION followme_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER followme_audit_append_only
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION followme_append_only();

CREATE TRIGGER followme_decision_append_only
BEFORE UPDATE OR DELETE ON "ApprovalDecision"
FOR EACH ROW EXECUTE FUNCTION followme_append_only();

-- Stored files are content-addressed and immutable (source evidence never overwritten).
CREATE OR REPLACE FUNCTION followme_asset_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."sha256" <> OLD."sha256" OR NEW."storageKey" <> OLD."storageKey"
     OR NEW."size" <> OLD."size" OR NEW."mime" <> OLD."mime" OR NEW."purpose" <> OLD."purpose" THEN
    RAISE EXCEPTION 'Asset % is immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER followme_asset_guard
BEFORE UPDATE ON "Asset"
FOR EACH ROW EXECUTE FUNCTION followme_asset_guard();
