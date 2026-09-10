import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default configuration: no incremental cache, no queue, no tag cache.
// JobSync is a per-user dynamic app behind auth; every page is rendered per
// request, so ISR/tag caching would add Durable Object and KV surface for no
// benefit. Revisit if a public marketing route is ever added.
export default defineCloudflareConfig();
