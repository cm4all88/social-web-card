/**
 * A minimal stand-in for the service-role Supabase client (supabaseAdmin) that
 * runs the few query shapes the tipping server code uses against PGlite, so
 * server code can be tested against the real migrations. Like the service key,
 * it is not subject to row-level security (queries run as the database owner).
 */
import type { PGlite } from "@electric-sql/pglite";

type Filter = { col: string; op: "=" | "<>"; val: unknown };

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`unsupported identifier ${s}`);
  return `"${s}"`;
};

class Query {
  private filters: Filter[] = [];
  private cols = "*";
  private countOnly = false;
  constructor(
    private db: PGlite,
    private table: string,
  ) {}
  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    this.cols = cols
      .split(",")
      .map((c) => c.trim())
      .map((c) => (c === "*" ? "*" : ident(c)))
      .join(", ");
    this.countOnly = !!opts?.head;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ col, op: "=", val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push({ col, op: "<>", val });
    return this;
  }
  private sql() {
    const where = this.filters.map((f, i) => `${ident(f.col)} ${f.op} $${i + 1}`).join(" AND ");
    const sel = this.countOnly ? "count(*)::int AS count" : this.cols;
    return {
      text: `SELECT ${sel} FROM public.${ident(this.table)}${where ? ` WHERE ${where}` : ""}`,
      params: this.filters.map((f) => f.val),
    };
  }
  async maybeSingle() {
    const { text, params } = this.sql();
    try {
      const { rows } = await this.db.query(text, params);
      return { data: rows[0] ?? null, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }
  then<T>(resolve: (v: { data: unknown; count: number | null; error: unknown }) => T) {
    const { text, params } = this.sql();
    return this.db.query<{ count?: number }>(text, params).then(
      ({ rows }) =>
        resolve({
          data: this.countOnly ? null : rows,
          count: this.countOnly ? (rows[0]?.count ?? 0) : null,
          error: null,
        }),
      (e: Error) => resolve({ data: null, count: null, error: { message: e.message } }),
    );
  }
}

export function pgliteAdmin(db: PGlite) {
  return {
    from: (table: string) => new Query(db, table),
    async rpc(fn: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      const call = `SELECT public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")}) AS result`;
      try {
        const { rows } = await db.query<{ result: unknown }>(call, keys.map((k) => args[k]));
        return { data: rows[0]?.result ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
}
