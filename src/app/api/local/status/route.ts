import { ensureLayout, isLocalRequest, listBundles, localDir, readVault, refuse } from "@/lib/local-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isLocalRequest(req)) return refuse();
  const dir = localDir();
  if (!dir) return Response.json({ dir: null });
  await ensureLayout(dir);
  const [notes, bundles] = await Promise.all([readVault(dir), listBundles(dir)]);
  return Response.json({ dir, notes: notes.length, bundles }, { headers: { "cache-control": "no-store" } });
}
