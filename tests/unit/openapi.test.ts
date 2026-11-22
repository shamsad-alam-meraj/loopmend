import { describe, expect, it } from "vitest";
import { buildOpenApi } from "@/lib/http/openapi";

describe("OpenAPI document", () => {
  const doc = buildOpenApi("https://example.test") as { openapi: string; paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> } }>> };
  it("covers the documented endpoints with generated schemas", () => {
    expect(doc.openapi).toBe("3.1.0");
    for (const p of ["/webhooks/n8n/incident", "/incidents", "/incidents/{id}/investigate", "/workflows/{id}/executions", "/recovery-plans", "/recovery-plans/{id}/approve", "/recovery-plans/{id}/reject", "/recovery-plans/{id}/execute", "/analytics/reliability", "/health"]) {
      expect(doc.paths[p], p).toBeDefined();
    }
    const event = doc.paths["/webhooks/n8n/incident"].post.requestBody!.content["application/json"].schema;
    expect(Object.keys(event.properties ?? {})).toEqual(expect.arrayContaining(["event", "eventId", "workflow", "execution", "occurredAt"]));
  });
});
