import type { PalladiumEngine, SchemaConfig, SqlQuery } from "@palladium/core";
import { createEngine, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PalladiumProvider, useLiveQuery, useSyncStatus } from "../index.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Schema = {
  tasks: { id: string; name: string; done: number };
};

const SCHEMA: SchemaConfig = {
  schema:
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
  version: 1,
};

function makeDb() {
  return createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }));
}

function wrapper(
  db: PalladiumEngine<Schema>,
): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <PalladiumProvider engine={db}>{children}</PalladiumProvider>;
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

interface QueryGate {
  pending: Promise<void>;
  started: Promise<void>;
  start: () => void;
}

function deferQueryResults(db: PalladiumEngine<Schema>, gates: QueryGate[]): void {
  const liveQuery = db.liveQuery.bind(db);
  let nextGate = 0;
  db.liveQuery = <T,>(query: SqlQuery) => {
    const instance = liveQuery<T>(query);
    const exec = instance.exec.bind(instance);
    const gate = gates[nextGate++];
    instance.exec = async () => {
      const outcome = await exec().then(
        (rows) => ({ ok: true as const, rows }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      gate?.start();
      await gate?.pending;
      if (!outcome.ok) throw outcome.error;
      return outcome.rows;
    };
    return instance;
  };
}

describe("useLiveQuery", () => {
  it("returns empty array initially", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    function App(): ReactNode {
      const { rows, loading } = useLiveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
      return <div data-testid="out">{loading ? "loading" : rows.length}</div>;
    }

    render(<App />, { wrapper: wrapper(db) });
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("0"));
  });

  it("re-renders when a row is inserted", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    function App(): ReactNode {
      const { rows } = useLiveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
      return (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>{r.name}</li>
          ))}
        </ul>
      );
    }

    render(<App />, { wrapper: wrapper(db) });
    await waitFor(() => expect(screen.queryAllByRole("listitem")).toHaveLength(0));

    await act(async () => {
      await db.insert("tasks", {
        id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
        name: "Buy milk",
        done: 0,
      });
    });

    await waitFor(() => expect(screen.queryAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByRole("listitem").textContent).toBe("Buy milk");
  });

  it("ignores a replaced query's delayed initial result", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "Old",
      done: 0,
    });
    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ac",
      name: "New",
      done: 0,
    });
    const oldPending = deferred<void>();
    const oldStarted = deferred<void>();
    const newPending = deferred<void>();
    const newStarted = deferred<void>();
    deferQueryResults(db, [
      { pending: oldPending.promise, started: oldStarted.promise, start: oldStarted.resolve },
      { pending: newPending.promise, started: newStarted.promise, start: newStarted.resolve },
    ]);

    function App({ query }: { query: SqlQuery }): ReactNode {
      const { rows, loading } = useLiveQuery<Schema["tasks"]>(query);
      return (
        <div data-testid="state">{loading ? "loading" : rows.map((row) => row.name).join(",")}</div>
      );
    }

    const view = render(<App query={sql`SELECT * FROM tasks WHERE name = ${"Old"}`} />, {
      wrapper: wrapper(db),
    });
    await oldStarted.promise;
    view.rerender(<App query={sql`SELECT * FROM tasks WHERE name = ${"New"}`} />);
    await newStarted.promise;
    await act(async () => {
      newPending.resolve();
    });
    expect(screen.getByTestId("state").textContent).toBe("New");

    await act(async () => {
      oldPending.resolve();
    });
    expect(screen.getByTestId("state").textContent).toBe("New");
  });

  it.each(["result", "error"])(
    "does not let a delayed initial %s replace a newer change notification",
    async (initialOutcome) => {
      const db = makeDb();
      await db.init(SCHEMA);
      const initialPending = deferred<void>();
      const initialStarted = deferred<void>();
      deferQueryResults(db, [
        {
          pending: initialPending.promise,
          started: initialStarted.promise,
          start: initialStarted.resolve,
        },
      ]);
      const query =
        initialOutcome === "error"
          ? sql`SELECT name, unavailable FROM tasks`
          : sql`SELECT * FROM tasks`;

      function App(): ReactNode {
        const { rows, loading, error } = useLiveQuery<Schema["tasks"]>(query);
        return (
          <div data-testid="state">
            {error ? error.message : loading ? "loading" : rows.map((row) => row.name).join(",")}
          </div>
        );
      }

      render(<App />, { wrapper: wrapper(db) });
      await initialStarted.promise;
      if (initialOutcome === "error") {
        await db.exec(sql`ALTER TABLE tasks ADD COLUMN unavailable INTEGER`);
      }
      await act(async () => {
        await db.insert("tasks", {
          id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
          name: "Newer",
          done: 0,
        });
      });
      await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("Newer"));

      await act(async () => {
        initialPending.resolve();
      });
      expect(screen.getByTestId("state").textContent).toBe("Newer");
    },
  );

  it("clears a query error and stale rows while a replacement query is loading", async () => {
    const db = makeDb();
    await db.init(SCHEMA);
    await db.insert("tasks", {
      id: "018f0f50-7b8d-7a1c-8e2f-1234567890ab",
      name: "Old result",
      done: 0,
    });

    const { promise: queryResult, resolve: resolveQuery } = deferred<Schema["tasks"][]>();
    const originalExec = db.adapter.exec.bind(db.adapter);
    const execSpy = vi.spyOn(db.adapter, "exec").mockImplementation((query, params) => {
      if (query === "SELECT * FROM tasks WHERE name = ?") return queryResult;
      return originalExec(query, params);
    });

    function App({ query }: { query: SqlQuery }): ReactNode {
      const { rows, loading, error } = useLiveQuery<Schema["tasks"]>(query);
      return (
        <div data-testid="state">
          {JSON.stringify({
            rows: rows.map((row) => row.name),
            loading,
            error: error?.message ?? null,
          })}
        </div>
      );
    }

    const view = render(<App query={sql`SELECT * FROM tasks`} />, { wrapper: wrapper(db) });
    await waitFor(() => expect(screen.getByTestId("state").textContent).toContain("Old result"));

    view.rerender(<App query={sql`SELEC invalid`} />);
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("state").textContent ?? "null")).toMatchObject({
        rows: [],
        loading: false,
        error: expect.any(String),
      }),
    );
    expect(screen.getByTestId("state").textContent).not.toContain("Old result");

    view.rerender(<App query={sql`SELECT * FROM tasks WHERE name = ${"New result"}`} />);
    expect(screen.getByTestId("state").textContent).toBe(
      JSON.stringify({ rows: [], loading: true, error: null }),
    );

    await act(async () => {
      resolveQuery([{ id: "new", name: "New result", done: 0 }]);
    });
    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toBe(
        JSON.stringify({ rows: ["New result"], loading: false, error: null }),
      ),
    );
    execSpy.mockRestore();
  });
});

describe("useSyncStatus", () => {
  it("updates when engine emits sync:status", async () => {
    const db = makeDb();
    await db.init(SCHEMA);

    function App(): ReactNode {
      const status = useSyncStatus();
      return <div data-testid="status">{status}</div>;
    }

    render(<App />, { wrapper: wrapper(db) });

    act(() => {
      db.setStatus("syncing");
    });

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("syncing"));
  });
});
