import { z } from "zod";
import { McpAddJobInputShape, McpUpdateJobInputShape } from "@/models/mcp.schema";
import { AgentAddJobSchema } from "@/models/agent.schema";

const workplaceType = (shape: Record<string, z.ZodTypeAny>) =>
  z.object({ workplaceType: shape.workplaceType });

describe("workplaceType schema", () => {
  const schema = workplaceType(McpAddJobInputShape as any);

  it("accepts the posting's own spelling and canonicalizes it", () => {
    expect(schema.parse({ workplaceType: "On-site" }).workplaceType).toBe("Onsite");
    expect(schema.parse({ workplaceType: "on site" }).workplaceType).toBe("Onsite");
  });

  it("still accepts the enum keys existing MCP callers may send", () => {
    expect(schema.parse({ workplaceType: "REMOTE" }).workplaceType).toBe("Remote");
  });

  it("stays optional", () => {
    expect(schema.parse({}).workplaceType).toBeUndefined();
  });

  it("rejects a value no spelling fold can rescue", () => {
    expect(schema.safeParse({ workplaceType: "Moon Base" }).success).toBe(false);
  });

  // The point of the change: prose in .describe() was ignored, so the model
  // has to see the options in the JSON schema the SDK generates from this.
  it("exposes the options as a JSON-schema enum, not a bare string", () => {
    const json: any = z.toJSONSchema(schema);
    expect(json.properties.workplaceType.enum).toEqual(["Remote", "Hybrid", "Onsite"]);
  });

  it("carries the same field into update_job and the agent's add_job", () => {
    expect(workplaceType(McpUpdateJobInputShape as any).parse({ workplaceType: "On-site" }).workplaceType).toBe("Onsite");
    expect(AgentAddJobSchema.parse({ company: "Acme", jobTitle: "Engineer", workplaceType: "On-site" }).workplaceType).toBe("Onsite");
  });
});

// Link contract: a job references people by identity-ledger id, never by name.
describe("contactLedgerIds schema", () => {
  const id = "ledger:person:b9ce7c04-ab61-443b-b5b4-f74fadc6924d";
  for (const [tool, shape] of [["add_job", McpAddJobInputShape], ["update_job", McpUpdateJobInputShape]] as const) {
    const schema = z.object({ contactLedgerIds: (shape as any).contactLedgerIds });
    it(`${tool} accepts ledger ids and an empty list`, () => {
      expect(schema.parse({ contactLedgerIds: [id] }).contactLedgerIds).toEqual([id]);
      expect(schema.parse({ contactLedgerIds: [] }).contactLedgerIds).toEqual([]);
    });
    it(`${tool} rejects a name or a bare uuid`, () => {
      expect(schema.safeParse({ contactLedgerIds: ["Carmelina Piedra"] }).success).toBe(false);
      expect(schema.safeParse({ contactLedgerIds: [id.slice("ledger:person:".length)] }).success).toBe(false);
    });
  }
});
