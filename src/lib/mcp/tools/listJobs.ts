import prisma from "@/lib/db";
import { checkMcpRateLimit } from "@/lib/mcp/rate-limit";
import type { McpListJobsInput } from "@/models/mcp.schema";

/**
 * Read-only listing of the caller's saved roles. Returns compact JSON lines the
 * model can reason over plus a one-line summary; ids are what update_job needs.
 */
export async function handleListJobs(
  input: McpListJobsInput,
  userId: string,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const rateCheck = checkMcpRateLimit(userId);
  if (!rateCheck.allowed) {
    const resetSec = Math.ceil(rateCheck.resetIn / 1000);
    return { content: [{ type: "text", text: `Rate limit exceeded. Try again in ${resetSec}s.` }] };
  }
  const where = {
    userId,
    ...(input.status ? { Status: { value: input.status } } : {}),
    ...(input.applied === undefined ? {} : { applied: input.applied }),
  };
  const [total, rows] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: input.offset,
      take: input.limit,
      select: {
        id: true,
        jobUrl: true,
        applied: true,
        appliedDate: true,
        dueDate: true,
        createdAt: true,
        matchScore: true,
        discoveryStatus: true,
        Status: { select: { value: true } },
        JobTitle: { select: { label: true } },
        Company: { select: { label: true } },
        Location: { select: { label: true } },
      },
    }),
  ]);
  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: total === 0
            ? "No saved roles match. Nothing is saved yet for these filters."
            : `No rows at offset ${input.offset}; total matching roles: ${total}.`,
        },
      ],
    };
  }
  const lines = rows.map((j) =>
    JSON.stringify({
      id: j.id,
      title: j.JobTitle?.label ?? null,
      company: j.Company?.label ?? null,
      location: j.Location?.label ?? null,
      status: j.Status?.value ?? null,
      applied: j.applied,
      appliedDate: j.appliedDate?.toISOString() ?? null,
      dueDate: j.dueDate?.toISOString() ?? null,
      matchScore: j.matchScore ?? null,
      discoveryStatus: j.discoveryStatus ?? null,
      savedAt: j.createdAt.toISOString(),
      url: j.jobUrl ?? null,
    }),
  );
  const shown = `${input.offset + 1}-${input.offset + rows.length}`;
  return {
    content: [
      {
        type: "text",
        text: `Showing ${shown} of ${total} saved roles (newest first). One JSON object per line; use "id" with update_job.\n${lines.join("\n")}`,
      },
    ],
  };
}
