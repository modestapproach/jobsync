import path from "path";
import { getStorage } from "@/lib/storage";
import { APP_CONSTANTS } from "@/lib/constants";
import { buildBackupZip } from "./export";
import { BackupError, openBackupZip, readManifest } from "./manifest";
import { log } from "@/lib/telemetry";

export interface SnapshotInfo {
  id: string;
  exportedAt: string;
  appVersion: string;
  counts: Record<string, number>;
  sizeBytes: number;
}

// Anchored, and deliberately narrow: the only names this accepts are ones
// writeSnapshot produced. A traversal segment cannot match it.
const SNAPSHOT_ID = /^pre-import-[0-9TZ.:-]+\.zip$/;

export function snapshotDir(userId: string): string {
  return path.join(APP_CONSTANTS.UPLOADS_DIR, "backups", userId);
}

export async function writeSnapshot(
  userId: string,
  email: string,
): Promise<string> {
  const { buffer } = await buildBackupZip(userId, email);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.posix.join(snapshotDir(userId), `pre-import-${stamp}.zip`);
  await getStorage().put(target, new Uint8Array(buffer), "application/zip");
  await pruneSnapshots(userId, APP_CONSTANTS.BACKUP_SNAPSHOT_KEEP);
  return target;
}

async function snapshotObjects(userId: string) {
  const objects = await getStorage().list(snapshotDir(userId) + "/");
  return objects
    .map((o) => ({ ...o, name: path.posix.basename(o.key) }))
    .filter((o) => SNAPSHOT_ID.test(o.name));
}

export async function listSnapshots(userId: string): Promise<SnapshotInfo[]> {
  const infos: SnapshotInfo[] = [];
  for (const obj of await snapshotObjects(userId)) {
    try {
      const bytes = await getStorage().get(obj.key);
      if (!bytes) continue;
      const manifest = await readManifest(await openBackupZip(Buffer.from(bytes)));
      infos.push({
        id: obj.name,
        exportedAt: manifest.exportedAt,
        appVersion: manifest.appVersion,
        counts: manifest.counts,
        sizeBytes: bytes.length,
      });
    } catch (error) {
      // An unreadable snapshot is skipped, not fatal — the list is a recovery
      // surface and must not be taken down by one bad file.
      log.warn("[Backup] Skipping unreadable snapshot", {
        "snapshot.name": obj.name,
        error: String(error),
      });
    }
  }
  return infos.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
}

export async function readSnapshot(
  userId: string,
  id: string,
): Promise<Buffer> {
  if (!SNAPSHOT_ID.test(id)) {
    throw new BackupError("That is not a valid snapshot.");
  }
  const bytes = await getStorage().get(path.posix.join(snapshotDir(userId), id));
  if (!bytes) {
    throw new BackupError("That snapshot no longer exists.");
  }
  return Buffer.from(bytes);
}

// Prunes on count and on total bytes. The count alone is not a storage bound:
// nothing caps how large one snapshot is, and an import/rollback loop writes
// one every time. The newest is always kept, even if it alone exceeds the
// byte budget — dropping the only record of the state a user just left is
// worse than overshooting.
export async function pruneSnapshots(
  userId: string,
  keep: number,
): Promise<void> {
  // Names are ISO-stamped, so a lexical sort is a chronological one.
  const newestFirst = (await snapshotObjects(userId)).sort((a, b) =>
    b.name.localeCompare(a.name),
  );

  const stale: string[] = [];
  let running = 0;

  for (const [index, obj] of newestFirst.entries()) {
    if (index >= keep) {
      stale.push(obj.key);
      continue;
    }
    running += obj.size;
    if (index > 0 && running > APP_CONSTANTS.BACKUP_SNAPSHOT_MAX_TOTAL_BYTES) {
      stale.push(obj.key);
    }
  }

  for (const key of stale) {
    await getStorage()
      .delete(key)
      .catch((error) =>
        log.warn("[Backup] Could not prune snapshot", {
          "snapshot.name": path.posix.basename(key),
          error: String(error),
        }),
      );
  }
}
