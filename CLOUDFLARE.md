# JobSync on Cloudflare Workers

This branch runs JobSync on Cloudflare: Workers (via the OpenNext adapter), D1 for the database, R2 for files, and a Cron Trigger for the scheduler. Nothing runs on a server you manage.

## Architecture

| Concern | Node/Docker deployment | Cloudflare deployment |
| --- | --- | --- |
| Database | SQLite file via Prisma | D1 via `@prisma/adapter-d1` (`src/lib/db.ts`) |
| Files (resumes, backups, snapshots) | local filesystem under `UPLOADS_DIR` | R2 bucket `FILES` through `src/lib/storage.ts` |
| Scheduler | in-process `node-cron` | Cron Trigger → `worker.ts` → `POST /api/automations/tick` |
| Query engine | native library | WASM (`.prisma/client/wasm.js`), selected by `serverExternalPackages` in `next.config.mjs` |

`src/lib/storage.ts` is the single boundary for bytes outside the database. It picks R2 when the `FILES` binding exists and the filesystem otherwise, so `next dev` without wrangler and the vitest suite behave exactly as before. Keys are the `File.filePath` strings already stored in the database.

## Deploy

```bash
npm ci
npx wrangler d1 migrations apply jobsync-db --remote   # first time and after schema changes
npm run cf:deploy
```

Secrets (set once with `npx wrangler secret put <NAME>`): `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `NEXTAUTH_URL`.

Schema changes: edit `prisma/schema.prisma`, then generate the D1 migration from the schema diff and apply it:

```bash
npx prisma migrate diff --from-local-d1 --to-schema-datamodel prisma/schema.prisma --script > migrations/000N_<name>.sql
npx wrangler d1 migrations apply jobsync-db --remote
```

## Known limits on D1

- **No transactions.** Prisma runs `$transaction` bodies as sequential statements. Backup import keeps its pre-import snapshot as the recovery path; the PRD's atomic mutation+audit writes should use D1 `batch()` directly when implemented.
- **Ownership of the WASM engine choice.** `serverExternalPackages` makes OpenNext (not Next's webpack) resolve Prisma, which picks the `workerd` export. If a Prisma upgrade changes its export map, `/api/version` returning 500 with `PrismaClientInitializationError` is the symptom.
- Public registration closes after the first account (`src/actions/auth.actions.ts`); set `SIGNUP_OPEN=true` to reopen deliberately.
