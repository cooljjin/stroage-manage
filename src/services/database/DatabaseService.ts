import { supabase } from "../../lib/supabase";
import type { Database } from "../../types/supabase";

type PublicTables = Database["public"]["Tables"];
type PublicFunctions = Database["public"]["Functions"];
type TableName = keyof PublicTables & string;
type FunctionName = keyof PublicFunctions & string;
type TableInsert<T extends TableName> = PublicTables[T]["Insert"];
type TableUpdate<T extends TableName> = PublicTables[T]["Update"];
type FunctionArgs<T extends FunctionName> = PublicFunctions[T]["Args"];

export type SelectFilter = {
  column: string;
  operator: "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "in" | "ilike";
  value: unknown;
};

export type SelectOrder = {
  column: string;
  ascending?: boolean;
  foreignTable?: string;
};

export type SelectOptions = {
  filters?: SelectFilter[];
  order?: SelectOrder[];
  limit?: number;
  single?: boolean;
  maybeSingle?: boolean;
  count?: "exact" | "planned" | "estimated";
  head?: boolean;
};

// Supabase's fluent query builders change type after each chained call.
// This service keeps that fluent behavior intact while moving the dependency boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FluentQuery = any;

function applySelectOptions<T extends FluentQuery>(query: T, options?: SelectOptions): FluentQuery {
  let next: FluentQuery = query;

  for (const filter of options?.filters ?? []) {
    if (filter.operator === "in") {
      next = next.in(filter.column, Array.isArray(filter.value) ? filter.value : [filter.value]);
    } else if (filter.operator === "ilike") {
      next = next.ilike(filter.column, String(filter.value));
    } else {
      next = next[filter.operator](filter.column, filter.value);
    }
  }

  for (const order of options?.order ?? []) {
    next = next.order(order.column, { ascending: order.ascending, foreignTable: order.foreignTable });
  }

  if (typeof options?.limit === "number") {
    next = next.limit(options.limit);
  }

  if (options?.single) return next.single();
  if (options?.maybeSingle) return next.maybeSingle();
  return next;
}

export const DatabaseService = {
  select<T extends TableName>(table: T, columns = "*", options?: SelectOptions) {
    const query = supabase.from(table).select(columns, { count: options?.count, head: options?.head });
    return applySelectOptions(query, options);
  },

  insert<T extends TableName>(table: T, values: TableInsert<T> | TableInsert<T>[]) {
    return supabase.from(table).insert(values as never);
  },

  update<T extends TableName>(table: T, values: TableUpdate<T>) {
    return supabase.from(table).update(values as never);
  },

  delete<T extends TableName>(table: T) {
    return supabase.from(table).delete();
  },

  upsert<T extends TableName>(table: T, values: TableInsert<T> | TableInsert<T>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    return supabase.from(table).upsert(values as never, options);
  },

  rpc<T extends FunctionName>(name: T, args?: FunctionArgs<T>) {
    return supabase.rpc(name, args as never);
  }
};
