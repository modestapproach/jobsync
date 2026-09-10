import { handleListJobs } from "@/lib/mcp/tools/listJobs";
import prisma from "@/lib/db";
import { checkMcpRateLimit } from "@/lib/mcp/rate-limit";

vi.mock("@/lib/db", () => ({
  default: { job: { count: vi.fn(), findMany: vi.fn() } },
}));
vi.mock("@/lib/mcp/rate-limit", () => ({ checkMcpRateLimit: vi.fn() }));

const row = {
  id: "job_1",
  jobUrl: "https://example.com/j/1",
  applied: false,
  appliedDate: null,
  dueDate: new Date("2026-09-20T00:00:00Z"),
  createdAt: new Date("2026-09-09T00:00:00Z"),
  matchScore: 72,
  discoveryStatus: null,
  Status: { value: "saved" },
  JobTitle: { label: "Product Designer" },
  Company: { label: "Acme" },
  Location: { label: "Remote" },
};

describe("list_jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (checkMcpRateLimit as any).mockReturnValue({ allowed: true, resetIn: 0 });
  });

  it("scopes the query to the caller and returns one JSON line per role", async () => {
    (prisma.job.count as any).mockResolvedValue(1);
    (prisma.job.findMany as any).mockResolvedValue([row]);
    const result = await handleListJobs({ limit: 25, offset: 0 }, "user_1");
    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" }, take: 25, skip: 0 }),
    );
    const text = result.content[0].text;
    expect(text).toContain("Showing 1-1 of 1");
    const line = JSON.parse(text.split("\n")[1]);
    expect(line).toMatchObject({ id: "job_1", title: "Product Designer", company: "Acme", status: "saved", applied: false, matchScore: 72 });
  });

  it("applies status and applied filters", async () => {
    (prisma.job.count as any).mockResolvedValue(0);
    (prisma.job.findMany as any).mockResolvedValue([]);
    await handleListJobs({ status: "applied", applied: true, limit: 10, offset: 0 }, "user_1");
    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1", Status: { value: "applied" }, applied: true } }),
    );
  });

  it("says plainly when nothing is saved", async () => {
    (prisma.job.count as any).mockResolvedValue(0);
    (prisma.job.findMany as any).mockResolvedValue([]);
    const result = await handleListJobs({ limit: 25, offset: 0 }, "user_1");
    expect(result.content[0].text).toMatch(/Nothing is saved yet/);
  });

  it("honours the rate limiter", async () => {
    (checkMcpRateLimit as any).mockReturnValue({ allowed: false, resetIn: 4000 });
    const result = await handleListJobs({ limit: 25, offset: 0 }, "user_1");
    expect(result.content[0].text).toMatch(/Rate limit exceeded/);
    expect(prisma.job.findMany).not.toHaveBeenCalled();
  });
});
