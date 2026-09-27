import type { SupabaseClient } from "@supabase/supabase-js";
import type { RemoteAdapter, RemoteRow } from "./types";

// One table, `keel_records`, holds every synced row as JSON under the signed-in
// user's id. Row-level security keeps users apart; `synced_at` is set by a
// trigger on the server so the pull cursor never depends on device clocks.
// The schema lives in supabase/schema.sql.

const TABLE = "keel_records";
const PAGE = 500;

export class SupabaseAdapter implements RemoteAdapter {
  constructor(
    private client: SupabaseClient,
    private userId: string,
  ) {}

  async pull(cursor: string | null) {
    const rows: RemoteRow[] = [];
    let last = cursor;
    let from = 0;
    for (;;) {
      let q = this.client
        .from(TABLE)
        .select("tbl,id,data,updated_at,deleted_at,synced_at")
        .eq("user_id", this.userId)
        .order("synced_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (cursor) q = q.gt("synced_at", cursor);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const page = (data ?? []) as RemoteRow[];
      rows.push(...page);
      if (page.length) last = page[page.length - 1].synced_at ?? last;
      if (page.length < PAGE) break;
      from += PAGE;
    }
    return { rows, cursor: last };
  }

  async push(rows: RemoteRow[]) {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((r) => ({
        user_id: this.userId,
        tbl: r.tbl,
        id: r.id,
        data: r.data ?? {},
        updated_at: r.updated_at,
        deleted_at: r.deleted_at,
      }));
      const { error } = await this.client.from(TABLE).upsert(chunk, { onConflict: "user_id,tbl,id" });
      if (error) throw new Error(error.message);
    }
  }

  async wipe() {
    const { error } = await this.client.from(TABLE).delete().eq("user_id", this.userId);
    if (error) throw new Error(error.message);
  }
}
