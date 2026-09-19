-- Link contract: a job references people by identity-ledger id
-- (comma-separated `ledger:person:<uuid>`); the ledger owns identity.
ALTER TABLE "Job" ADD COLUMN "contactLedgerIds" TEXT;
