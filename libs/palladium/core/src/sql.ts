/**
 * SQL tagged template literal.
 *
 * Produces a `SqlQuery` object with parameterised `text` (using `?` placeholders)
 * and a `params` array. Also extracts table names mentioned in FROM/JOIN clauses
 * for reactive query invalidation.
 */

export interface SqlQuery {
  readonly text: string;
  readonly params: readonly unknown[];
  /** Tables referenced in FROM / JOIN clauses (best-effort parse). */
  readonly tables: readonly string[];
}

function extractTables(sql: string): string[] {
  const tables: string[] = [];
  // Match FROM <name> and JOIN <name>, ignoring sub-queries, aliases, schema prefixes.
  // Stryker disable next-line Regex -- minor regex character-class mutations produce equivalent matches for all real table names
  const re = /(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
  while ((m = re.exec(sql)) !== null) {
    const table = m[1];
    if (table !== undefined) tables.push(table.toLowerCase());
  }
  return [...new Set(tables)];
}

function buildSqlTag(strings: TemplateStringsArray, values: unknown[]): SqlQuery {
  let text = "";
  const params: unknown[] = [];
  for (let i = 0; i < strings.length; i++) {
    text += strings[i] ?? "";
    if (i < values.length) {
      text += "?";
      params.push(values[i]);
    }
  }
  return { text, params, tables: extractTables(text) };
}

/**
 * Tag function for SQL queries:
 * ```ts
 * const q = sql`SELECT * FROM tasks WHERE id = ${id}`;
 * ```
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery {
  return buildSqlTag(strings, values);
}

/** Join multiple SqlQuery fragments with a separator. */
sql.join = function join(queries: readonly SqlQuery[], separator: string): SqlQuery {
  const texts: string[] = [];
  const params: unknown[] = [];
  for (const q of queries) {
    texts.push(q.text);
    for (const p of q.params) params.push(p);
  }
  const text = texts.join(separator);
  return { text, params, tables: extractTables(text) };
};
