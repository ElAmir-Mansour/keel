import { isLocalRequest, localDir, readBundle, refuse } from "@/lib/local-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isLocalRequest(req)) return refuse();
  const dir = localDir();
  const name = new URL(req.url).searchParams.get("name") ?? "";
  const text = dir ? await readBundle(dir, name) : null;
  if (text === null) return Response.json({ error: "not_found" }, { status: 404 });
  return new Response(text, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
