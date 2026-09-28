import { isLocalRequest, localDir, readVault, refuse } from "@/lib/local-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isLocalRequest(req)) return refuse();
  const dir = localDir();
  if (!dir) return Response.json({ files: [] });
  return Response.json({ files: await readVault(dir) }, { headers: { "cache-control": "no-store" } });
}
