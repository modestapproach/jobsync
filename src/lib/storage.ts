import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Object storage boundary.
 *
 * Every byte JobSync persists outside the database (resume uploads, backup
 * snapshots) goes through here. On Cloudflare the backing store is the R2
 * bucket bound as `FILES`; anywhere else (local dev without wrangler, vitest)
 * it is the filesystem under APP_CONSTANTS.UPLOADS_DIR, which keeps the
 * existing behaviour and test fixtures intact.
 *
 * Keys are the same strings the database already stores in `File.filePath`
 * (e.g. "data/files/resumes/<name>.pdf"); a leading "/" is stripped so the
 * production "/data/..." paths and dev "data/..." paths map to one keyspace.
 */
export interface StoredObject {
  key: string;
  size: number;
}

export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
}

export function toObjectKey(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: { key: string; size: number }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

function r2Store(bucket: R2Like): ObjectStore {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(toObjectKey(key), bytes, contentType ? { httpMetadata: { contentType } } : undefined);
    },
    async get(key) {
      const obj = await bucket.get(toObjectKey(key));
      return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    },
    async exists(key) {
      return (await bucket.head(toObjectKey(key))) !== null;
    },
    async delete(key) {
      await bucket.delete(toObjectKey(key));
    },
    async list(prefix) {
      const out: StoredObject[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix: toObjectKey(prefix), cursor });
        out.push(...page.objects.map((o) => ({ key: o.key, size: o.size })));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return out;
    },
  };
}

function fsStore(): ObjectStore {
  // Loaded lazily so the Workers bundle never evaluates node:fs at import
  // time; nodejs_compat provides the module but the R2 path never uses it.
  const load = async () => {
    const fs = await import("fs/promises");
    const path = await import("path");
    return { fs, path };
  };
  return {
    async put(key, bytes) {
      const { fs, path } = await load();
      await fs.mkdir(path.dirname(key), { recursive: true });
      await fs.writeFile(key, bytes);
    },
    async get(key) {
      const { fs } = await load();
      try {
        return new Uint8Array(await fs.readFile(key));
      } catch {
        return null;
      }
    },
    async exists(key) {
      const { fs } = await load();
      return fs
        .stat(key)
        .then(() => true)
        .catch(() => false);
    },
    async delete(key) {
      const { fs } = await load();
      await fs.unlink(key).catch(() => undefined);
    },
    async list(prefix) {
      const { fs, path } = await load();
      const dir = prefix.endsWith("/") ? prefix : path.dirname(prefix);
      const base = prefix.endsWith("/") ? "" : path.basename(prefix);
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        return [];
      }
      const out: StoredObject[] = [];
      for (const name of names) {
        if (!name.startsWith(base)) continue;
        const full = path.join(dir, name);
        const stat = await fs.stat(full).catch(() => null);
        if (stat?.isFile()) out.push({ key: full, size: stat.size });
      }
      return out;
    },
  };
}

function resolveR2Bucket(): R2Like | null {
  try {
    // Present under wrangler/OpenNext (deployed and `next dev` with
    // initOpenNextCloudflareForDev); throws outside a Cloudflare context.
    const bucket = (getCloudflareContext().env as Record<string, unknown>).FILES;
    return bucket ? (bucket as R2Like) : null;
  } catch {
    return null;
  }
}

let cached: ObjectStore | null = null;

/** The object store for this runtime. R2 when bound, filesystem otherwise. */
export function getStorage(): ObjectStore {
  if (cached) return cached;
  const bucket = resolveR2Bucket();
  cached = bucket ? r2Store(bucket) : fsStore();
  return cached;
}

/** Test seam: drop the memoized store so a spec can re-resolve it. */
export function resetStorageForTests(): void {
  cached = null;
}
