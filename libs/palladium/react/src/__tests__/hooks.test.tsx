import { createEngine, sql } from "@palladium/core";
import { NodeSqliteAdapter } from "@palladium/sqlite-node";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PalladiumProvider, useLiveQuery, useSyncStatus } from "../index.js";

afterEach(cleanup);

interface Schema {
  tasks: { id: string; name: string; done: number };
}

const MIGRATIONS = [
  "CREATE TABLE tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, done INTEGER NOT NULL)",
];

function makeDb() {
  return createEngine<Schema>(new NodeSqliteAdapter({ vfs: { type: "memory" } }), MIGRATIONS);
}

function wrapper(
  db: ReturnType<typeof makeDb>,
): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <PalladiumProvider engine={db}>{children}</PalladiumProvider>;
  };
}

describe("useLiveQuery", () => {
  it("returns empty array initially", async () => {
    const db = makeDb();
    await db.init();

    function App(): ReactNode {
      const { rows, loading } = useLiveQuery<Schema["tasks"]>(sql`SELECT * FROM tasks`);
      return <div data-testid="out">{loading ? "loading" : rows.length}</div>;
    }

    render(<App />, { wrapper: wrapper(db) });
    await waitFor(() => expect(screen.getByTestId("out").textContent).toBe("0"));
  });

  it("re-renders when a row is inserted", async () => {
    const db = makeDb();
    await db.init();

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
      await db.insert("tasks", { id: "t1", name: "Buy milk", done: 0 });
    });

    await waitFor(() => expect(screen.queryAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByRole("listitem").textContent).toBe("Buy milk");
  });
});

describe("useSyncStatus", () => {
  it("returns idle by default", async () => {
    const db = makeDb();
    await db.init();

    function App(): ReactNode {
      const status = useSyncStatus();
      return <div data-testid="status">{status}</div>;
    }

    render(<App />, { wrapper: wrapper(db) });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("idle"));
  });

  it("updates when engine emits sync:status", async () => {
    const db = makeDb();
    await db.init();

    function App(): ReactNode {
      const status = useSyncStatus();
      return <div data-testid="status">{status}</div>;
    }

    render(<App />, { wrapper: wrapper(db) });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("idle"));

    act(() => {
      db.setStatus("syncing");
    });

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("syncing"));
  });
});
