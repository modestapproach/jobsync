import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes D1/R2 bindings available to `next dev` via local emulation.
initOpenNextCloudflareForDev();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Keep Prisma out of the Next.js webpack bundle so OpenNext resolves it with
  // the `workerd` export condition, which selects the WASM query engine
  // (.prisma/client/wasm.js) instead of the native Node library engine.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@prisma/adapter-d1"],
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
