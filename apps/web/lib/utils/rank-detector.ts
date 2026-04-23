import { normalizeDomain, normalizeResultUrl } from "@/lib/utils/url-normalizer";

export type RawSearchResult = {
  position?: number;
  url: string;
  title?: string;
  snippet?: string;
};

export type RankDetectionResult = {
  status: "found" | "not_found" | "invalid_input";
  normalizedDomain: string;
  position: number | null;
  page: number | null;
  matchedUrl: string | null;
  scannedCount: number;
};

export function detectRank(
  targetDomain: string,
  rawResults: RawSearchResult[],
  resultsPerPage = 10,
): RankDetectionResult {
  const normalizedDomain = normalizeDomain(targetDomain);

  if (!normalizedDomain) {
    return {
      status: "invalid_input",
      normalizedDomain: "",
      position: null,
      page: null,
      matchedUrl: null,
      scannedCount: rawResults.length,
    };
  }

  for (let index = 0; index < rawResults.length; index += 1) {
    const result = rawResults[index];
    const normalizedResultHost = normalizeResultUrl(result.url);

    if (!normalizedResultHost) {
      continue;
    }

    if (normalizedResultHost === normalizedDomain) {
      const resolvedPosition = result.position ?? index + 1;
      return {
        status: "found",
        normalizedDomain,
        position: resolvedPosition,
        page: Math.ceil(resolvedPosition / resultsPerPage),
        matchedUrl: result.url,
        scannedCount: rawResults.length,
      };
    }
  }

  return {
    status: "not_found",
    normalizedDomain,
    position: null,
    page: null,
    matchedUrl: null,
    scannedCount: rawResults.length,
  };
}
