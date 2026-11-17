import { route } from "@/lib/http/api";
import { apiContext } from "@/lib/http/auth-context";
import { generatePostmortem } from "@/services/insights.service";

export const dynamic = "force-dynamic";

/** GET /api/v1/incidents/:id/postmortem — blameless postmortem as a Markdown download. */
export const GET = route<RouteContext<"/api/v1/incidents/[id]/postmortem">>(async (req, { params, requestId }) => {
  const { ctx } = await apiContext("incident:read", requestId);
  const { filename, markdown } = await generatePostmortem(ctx, (await params).id);
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "x-request-id": requestId,
      "cache-control": "no-store",
    },
  });
});
