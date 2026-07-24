-- 107: Fixes a real cross-tenant collision gap introduced by 106.
--
-- 106 made esp_communities.code only tenant-scoped unique (UNIQUE(tenant_id,
-- code)), on the assumption that -- unlike slug -- code never appears in a
-- public URL so it doesn't need to be global. That reasoning missed that
-- esp_check_status() (the public "check my membership status" lookup,
-- migration 101) searches esp_members.membership_number with NO tenant_id
-- filter at all -- it was written when membership_number was still
-- slug-derived and therefore always globally unique. Once 106 let two
-- different tenants both pick code='SPM', their independently-numbered
-- members (each tenant has its own esp_membership_counters row) can
-- produce an *identical* membership_number string, and esp_check_status()
-- has no way to know which tenant's row it just returned.
--
-- Fix: make code globally unique again (same precedent as tenants.slug and
-- esp_communities.slug), AND require the format to actually embed {CODE} --
-- global code uniqueness alone doesn't help if a community's format is,
-- say, "{YEAR}-{SEQ:6}" with no {CODE} token in the output at all.
-- Together these guarantee the generated string itself can never collide
-- across tenants, without having to touch esp_check_status()'s query shape.

DROP INDEX IF EXISTS esp_communities_tenant_code_unique;

-- Existing data check: at time of writing only one community has a code
-- set ('SMXMG'), so a plain global unique index applies cleanly. If this
-- ever needs to run against data with duplicate codes across tenants,
-- resolve those first -- this ALTER will fail loudly rather than silently
-- picking a winner.
CREATE UNIQUE INDEX IF NOT EXISTS esp_communities_code_unique
  ON esp_communities (code) WHERE code IS NOT NULL;

ALTER TABLE esp_communities DROP CONSTRAINT IF EXISTS esp_communities_format_has_seq;
ALTER TABLE esp_communities ADD CONSTRAINT esp_communities_format_has_seq_and_code
  CHECK (
    membership_number_format IS NULL
    OR (membership_number_format ~ '\{SEQ:?[0-9]*\}' AND membership_number_format ~ '\{CODE\}')
  );
