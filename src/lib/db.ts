import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type D1Binding = ConstructorParameters<typeof PrismaD1>[0];

/**
 * On Cloudflare the client talks to D1 through the driver adapter; the binding
 * comes from the OpenNext request context and is only available inside a
 * request/cron invocation, so the client is created on first use rather than
 * at module load. Everywhere else (local dev without wrangler, vitest) it is
 * the stock SQLite client from DATABASE_URL.
 *
 * D1 has no transactions: Prisma runs `$transaction` bodies as sequential
 * statements. Every call site that relied on rollback must tolerate partial
 * completion or be rewritten against D1 batch; tracked in docs/cloudflare.md.
 */
function resolveD1(): D1Binding | null {
  try {
    const db = (getCloudflareContext().env as Record<string, unknown>).DB;
    return db ? (db as D1Binding) : null;
  } catch {
    return null;
  }
}

const prismaClientSingleton = () => {
  const d1 = resolveD1();
  if (d1) {
    return new PrismaClient({ adapter: new PrismaD1(d1) });
  }
  return new PrismaClient();
};

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton> | undefined;
} & typeof global;

let instance: PrismaClient | undefined = globalThis.prismaGlobal;

function client(): PrismaClient {
  if (!instance) {
    instance = prismaClientSingleton();
    if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = instance;
  }
  return instance;
}

// Lazy proxy so `import db from "@/lib/db"` keeps working unchanged while the
// real client is constructed inside the first request that touches it.
const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const real = client();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export default prisma;
