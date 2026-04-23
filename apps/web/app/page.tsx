"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  ExtensionStatusBanner,
  type ExtensionStatus,
} from "@/components/extension-status-banner";
import { ResultCard } from "@/components/result-card";
import { SearchForm } from "@/components/search-form";
import { normalizeDomain } from "@/lib/utils/url-normalizer";

type ExtensionScrapeResult = {
  ok: boolean;
  results?: Array<{
    position?: number;
    url: string;
    title?: string;
    snippet?: string;
  }>;
  error?: string;
  code?: string;
  scannedCount?: number;
  captchaHtml?: string;
  captchaUrl?: string;
};

type RankApiResponse = {
  success: boolean;
  data: {
    keyword: string;
    domain: string;
    engine: string;
    status: "found" | "not_found" | "invalid_input";
    position: number | null;
    positionOnPage: number | null;
    page: number | null;
    matchedUrl: string | null;
    scannedCount: number;
    fromCache: boolean;
    checkedAt: string;
  };
};

const extensionId = process.env.NEXT_PUBLIC_CHROME_EXTENSION_ID ?? "";
const INCOGNITO_WARNING_MESSAGE =
  "Please enable incognito access for this extension. Go to chrome://extensions, click Details on the Rank Checker extension, and turn on Allow in Incognito. Then reload the extension.";

export default function Home() {
  const [keyword, setKeyword] = useState("");
  const [domain, setDomain] = useState("");
  const [engine, setEngine] = useState<"google" | "bing">("google");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined);
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>("checking");
  const [error, setError] = useState<string | null>(null);
  const [captchaPreview, setCaptchaPreview] = useState<{
    html: string;
    url?: string;
  } | null>(null);
  const [result, setResult] = useState<RankApiResponse["data"] | null>(null);

  const canSubmit = useMemo(
    () => extensionStatus === "installed" && !isSubmitting,
    [extensionStatus, isSubmitting],
  );

  useEffect(() => {
    async function checkExtension() {
      if (!extensionId) {
        setExtensionStatus("unconfigured");
        return;
      }

      if (typeof window === "undefined") {
        return;
      }

      const runtime = window.chrome?.runtime;
      if (!runtime?.sendMessage) {
        setExtensionStatus("unsupported");
        return;
      }

      try {
        const ping = (await sendExtensionMessage({ type: "PING" })) as {
          ok?: boolean;
          version?: string;
          incognitoAccessAllowed?: boolean;
          incognitoWarning?: string;
        };

        if (ping?.ok) {
          if (!ping.incognitoAccessAllowed) {
            setExtensionStatus("incognito_disabled");
            setStatusMessage(ping.incognitoWarning ?? INCOGNITO_WARNING_MESSAGE);
            return;
          }

          setExtensionStatus("installed");
          setStatusMessage(
            ping.version
              ? `Chrome extension is active (v${ping.version}).`
              : "Chrome extension is active.",
          );
          return;
        }

        setExtensionStatus("missing");
      } catch {
        setExtensionStatus("missing");
      }
    }

    checkExtension();
  }, []);

  async function sendExtensionMessage(payload: Record<string, unknown>) {
    return new Promise<unknown>((resolve, reject) => {
      if (!extensionId) {
        reject(new Error("Extension ID is not configured."));
        return;
      }

      const runtime = window.chrome?.runtime;
      if (!runtime?.sendMessage) {
        reject(new Error("Chrome runtime API is unavailable."));
        return;
      }

      runtime.sendMessage(extensionId, payload, (response: unknown) => {
        const runtimeError = window.chrome?.runtime?.lastError;

        if (runtimeError) {
          reject(new Error(runtimeError.message ?? "Failed to reach extension."));
          return;
        }

        resolve(response);
      });
    });
  }

  function normalizeDomainInput() {
    const normalized = normalizeDomain(domain);
    if (normalized) {
      setDomain(normalized);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setCaptchaPreview(null);
    setResult(null);

    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) {
      setError("Please enter a valid domain like nike.com.");
      return;
    }

    if (!keyword.trim()) {
      setError("Please enter a keyword.");
      return;
    }

    if (extensionStatus !== "installed") {
      setError(
        extensionStatus === "incognito_disabled"
          ? INCOGNITO_WARNING_MESSAGE
          : "Chrome extension is not active. Install it and refresh this page.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const extensionResponse = (await sendExtensionMessage({
        type: "SCRAPE_GOOGLE",
        keyword: keyword.trim(),
        domain: normalizedDomain,
      })) as ExtensionScrapeResult;

      if (!extensionResponse?.ok || !Array.isArray(extensionResponse.results)) {
        const extensionError = extensionResponse?.error ?? "Could not scrape Google results.";
        const extensionCode = extensionResponse?.code ? ` [${extensionResponse.code}]` : "";
        const captchaHtml =
          typeof extensionResponse?.captchaHtml === "string"
            ? extensionResponse.captchaHtml
            : "";
        const captchaUrl =
          typeof extensionResponse?.captchaUrl === "string" ? extensionResponse.captchaUrl : "";

        if (captchaHtml.trim()) {
          setCaptchaPreview({
            html: captchaHtml,
            url: captchaUrl || undefined,
          });
        }

        throw new Error(`${extensionError}${extensionCode}`);
      }

      const apiResponse = await fetch("/api/rank-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          keyword: keyword.trim(),
          domain: normalizedDomain,
          engine,
          results: extensionResponse.results,
          scannedCount:
            typeof extensionResponse.scannedCount === "number"
              ? extensionResponse.scannedCount
              : extensionResponse.results.length,
        }),
      });

      const payload = (await apiResponse.json()) as
        | RankApiResponse
        | {
            error?: string;
          };

      if (!apiResponse.ok || !("success" in payload) || !payload.success) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Rank check API failed. Please retry.",
        );
      }

      setDomain(normalizedDomain);
      setResult(payload.data);
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Unexpected error while checking rank.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,#fef3c7,transparent_35%),radial-gradient(circle_at_85%_15%,#bae6fd,transparent_30%),#f8fafc] px-4 py-10 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Internal SEO Tool
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Search Rank Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">
            Enter a keyword and website domain to find the current Google ranking position.
          </p>
        </header>

        <ExtensionStatusBanner status={extensionStatus} message={statusMessage} />

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <SearchForm
            keyword={keyword}
            domain={domain}
            engine={engine}
            isSubmitting={isSubmitting}
            disabled={!canSubmit}
            onKeywordChange={setKeyword}
            onDomainChange={setDomain}
            onDomainBlur={normalizeDomainInput}
            onEngineChange={setEngine}
            onSubmit={onSubmit}
          />

          <ResultCard result={result} error={error} captchaPreview={captchaPreview} />
        </div>
      </div>
    </div>
  );
}
