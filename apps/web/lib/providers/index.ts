export type SearchEngine = "google" | "bing";

export type EngineConfig = {
  key: SearchEngine;
  label: string;
  active: boolean;
};

export const ENGINE_REGISTRY: Record<SearchEngine, EngineConfig> = {
  google: {
    key: "google",
    label: "Google",
    active: true,
  },
  bing: {
    key: "bing",
    label: "Bing",
    active: false,
  },
};

export function isSupportedEngine(value: string): value is SearchEngine {
  return value in ENGINE_REGISTRY;
}
