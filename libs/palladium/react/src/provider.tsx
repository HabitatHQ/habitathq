import type { PalladiumEngine, SchemaMap } from "@palladium/core";
import { createContext, type ReactNode, useContext } from "react";

// biome-ignore lint/suspicious/noExplicitAny: context holds an engine for any schema
const PalladiumContext = createContext<PalladiumEngine<any> | null>(null);

interface PalladiumProviderProps {
  // biome-ignore lint/suspicious/noExplicitAny: provider accepts any schema engine
  engine: PalladiumEngine<any>;
  children: ReactNode;
}

export function PalladiumProvider({ engine, children }: PalladiumProviderProps): ReactNode {
  return <PalladiumContext.Provider value={engine}>{children}</PalladiumContext.Provider>;
}

export function usePalladium<S extends SchemaMap>(): PalladiumEngine<S> {
  const engine = useContext(PalladiumContext) as PalladiumEngine<S> | null;
  if (engine === null) {
    throw new TypeError("usePalladium must be used inside a <PalladiumProvider>.");
  }
  return engine;
}
