import { NextResponse } from "next/server";

import { ENGINE_REGISTRY, isSupportedEngine } from "@/lib/providers";
import { detectRank, type RawSearchResult } from "@/lib/utils/rank-detector";
import { normalizeDomain } from "@/lib/utils/url-normalizer";

type RankCheckPayload = {
  keyword?: unknown;
  domain?: unknown;
  engine?: unknown;
  results?: unknown;
  scannedCount?: unknown;
};

export async function POST(request: Request) {
  let payload: RankCheckPayload;

  try {
    payload = (await request.json()) as RankCheckPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const keyword = typeof payload.keyword === "string" ? payload.keyword.trim() : "";
  const domainInput = typeof payload.domain === "string" ? payload.domain.trim() : "";
  const engineInput = typeof payload.engine === "string" ? payload.engine.trim().toLowerCase() : "";

  if (!keyword) {
    return NextResponse.json(
      { error: "Keyword is required." },
      { status: 400 },
    );
  }

  if (!domainInput) {
    return NextResponse.json(
      { error: "Domain is required." },
      { status: 400 },
    );
  }

  const normalizedDomain = normalizeDomain(domainInput);
  if (!normalizedDomain) {
    return NextResponse.json(
      { error: "Domain is invalid. Use a value like nike.com." },
      { status: 400 },
    );
  }

  if (!isSupportedEngine(engineInput)) {
    return NextResponse.json(
      { error: "Engine is not supported." },
      { status: 400 },
    );
  }

  const engineConfig = ENGINE_REGISTRY[engineInput];
  if (!engineConfig.active) {
    return NextResponse.json(
      { error: `${engineConfig.label} is not active yet.` },
      { status: 400 },
    );
  }

  if (!Array.isArray(payload.results)) {
    return NextResponse.json(
      { error: "Results must be an array." },
      { status: 400 },
    );
  }

  const rawResults: RawSearchResult[] = payload.results
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as Record<string, unknown>;
      const url = typeof candidate.url === "string" ? candidate.url : "";
      const title = typeof candidate.title === "string" ? candidate.title : undefined;
      const snippet = typeof candidate.snippet === "string" ? candidate.snippet : undefined;
      const position = typeof candidate.position === "number" ? candidate.position : index + 1;

      if (!url) {
        return null;
      }

      return {
        url,
        title,
        snippet,
        position,
      };
    })
    .filter((item): item is RawSearchResult => Boolean(item));

  const requestedScannedCount =
    typeof payload.scannedCount === "number" && Number.isFinite(payload.scannedCount)
      ? Math.max(0, Math.floor(payload.scannedCount))
      : rawResults.length;

  const detection = detectRank(normalizedDomain, rawResults, 10);
  const positionOnPage =
    detection.position && detection.page
      ? detection.position - (detection.page - 1) * 10
      : null;

  return NextResponse.json({
    success: true,
    data: {
      keyword,
      domain: normalizedDomain,
      engine: engineConfig.label,
      status: detection.status,
      position: detection.position,
      positionOnPage,
      page: detection.page,
      matchedUrl: detection.matchedUrl,
      scannedCount: Math.max(detection.scannedCount, requestedScannedCount),
      fromCache: false,
      checkedAt: new Date().toISOString(),
    },
  });
}
