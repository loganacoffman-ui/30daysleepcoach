// In-memory implementation of the service-only cache/lease storage contract.
export function coachAdmin(revision: () => string = () => "revision-1") {
  const tables = new Map<string, any[]>();
  const calls: string[] = [];
  const rows = (table: string) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };
  const admin = {
    tables,
    calls,
    rows,
    rpc(name: string, args: any) {
      calls.push(name);
      const result = () => {
        if (name === "daily_coach_evidence_revision") return { data: revision(), error: null };
        if (name !== "claim_coach_generation") throw new Error(`Unexpected RPC ${name}`);
        const list = rows("coach_generation_leases");
        const existing = list.find((r) => r.user_id === args.p_user_id && r.cache_key === args.p_key);
        if (existing && Date.parse(existing.expires_at) > Date.now()) return { data: false, error: null };
        const row = {
          user_id: args.p_user_id,
          cache_key: args.p_key,
          owner: args.p_owner,
          expires_at: new Date(Date.now() + 120000).toISOString(),
        };
        if (existing) Object.assign(existing, row);
        else list.push(row);
        return { data: true, error: null };
      };
      return { abortSignal: () => Promise.resolve(result()) };
    },
    from(table: string) {
      calls.push(table);
      let op = "select", value: any, conflict = "", single = false;
      const filters: Array<[string, unknown]> = [];
      const query: any = {
        select: () => query,
        eq: (key: string, v: unknown) => {
          filters.push([key, v]);
          return query;
        },
        maybeSingle: () => {
          single = true;
          return query;
        },
        abortSignal: () => query,
        upsert: (v: any, options: any) => {
          op = "upsert";
          value = v;
          conflict = options.onConflict;
          return query;
        },
        update: (v: any) => {
          op = "update";
          value = v;
          return query;
        },
        delete: () => {
          op = "delete";
          return query;
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve().then(() => {
            const list = rows(table);
            const matches = (r: any) => filters.every(([key, v]) => r[key] === v);
            if (op === "upsert") {
              const existing = list.find((r) => conflict.split(",").every((key) => r[key] === value[key]));
              if (existing) Object.assign(existing, structuredClone(value));
              else list.push(structuredClone(value));
            }
            if (op === "update") { for (const row of list.filter(matches)) Object.assign(row, value); }
            const found = list.filter(matches);
            if (op === "delete") tables.set(table, list.filter((r) => !matches(r)));
            return { data: single ? found[0] ?? null : found, error: null };
          }).then(resolve, reject),
      };
      return query;
    },
  };
  return admin;
}
