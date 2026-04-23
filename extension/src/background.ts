const REQUEST_TIMEOUT_MS = 240000;
const TAB_LOAD_TIMEOUT_MS = 12000;
const GOOGLE_PAGE_STARTS = Array.from({ length: 10 }, (_, index) => index * 10);
const RESULTS_PER_PAGE = 10;
const MAX_PAGE_ATTEMPTS = 3;
const PAGE_RETRY_DELAY_MS = 2000;
const INCOGNITO_WARNING_MESSAGE =
  "Please enable incognito access for this extension. Go to chrome://extensions, click Details on the Rank Checker extension, and turn on Allow in Incognito. Then reload the extension.";
const MIN_PAGE_DELAY_MS = 2000;
const MAX_PAGE_DELAY_MS = 3500;

type ParsedSearchResult = {
  position: number;
  url: string;
  title: string;
  snippet: string;
};

type PendingRequest = {
  requestId: string;
  keyword: string;
  targetDomain: string;
  windowId: number | null;
  tabId: number | null;
  parseStartedTabId: number | null;
  currentStart: number;
  currentPageIndex: number;
  currentPageAttempt: number;
  pagesScanned: number;
  collectedResults: ParsedSearchResult[];
  timeoutId: number;
  tabLoadTimeoutId: number | null;
  sendResponse: (response: unknown) => void;
};

const pendingByRequestId = new Map<string, PendingRequest>();
const pendingByTabId = new Map<number, string>();

function makeRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function checkIncognitoAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.extension.isAllowedIncognitoAccess((allowed) => {
      resolve(Boolean(allowed));
    });
  });
}

function buildGoogleSearchUrl(keyword: string, start: number): string {
  const encoded = encodeURIComponent(keyword);
  return `https://www.google.com/search?q=${encoded}&start=${start}`;
}

function randomPageDelayMs(): number {
  const range = MAX_PAGE_DELAY_MS - MIN_PAGE_DELAY_MS;
  return MIN_PAGE_DELAY_MS + Math.floor(Math.random() * (range + 1));
}

function normalizeDomainForMatch(domainInput: unknown): string {
  if (typeof domainInput !== "string") {
    return "";
  }

  const trimmed = domainInput.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const hostname = new URL(withProtocol).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "").split("/")[0];
  }
}

function isDomainMatch(urlValue: unknown, targetDomain: string): boolean {
  if (!targetDomain || typeof urlValue !== "string" || !urlValue.trim()) {
    return false;
  }

  try {
    const host = new URL(urlValue).hostname.toLowerCase().replace(/^www\./, "");
    return host === targetDomain || host.endsWith(`.${targetDomain}`);
  } catch {
    return false;
  }
}

function hasTargetDomain(results: ParsedSearchResult[], targetDomain: string): boolean {
  if (!targetDomain) {
    return false;
  }

  return results.some((result) => isDomainMatch(result.url, targetDomain));
}

function clearTabLoadTimeout(pending: PendingRequest): void {
  if (pending.tabLoadTimeoutId !== null) {
    clearTimeout(pending.tabLoadTimeoutId);
    pending.tabLoadTimeoutId = null;
  }
}

function attachIncognitoTabToRequest(requestId: string, windowId: number): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  chrome.tabs.query({ windowId }, (tabs) => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError) {
      pending.sendResponse({
        ok: false,
        error: `Incognito tab lookup failed: ${runtimeError.message}`,
        code: "INCOGNITO_TAB_LOOKUP_FAILED",
      });
      cleanupRequest(requestId);
      return;
    }

    const firstTab = tabs.find((tab) => Boolean(tab.id));
    if (!firstTab?.id) {
      pending.sendResponse({
        ok: false,
        error: "Incognito tab was not created correctly.",
        code: "INCOGNITO_TAB_MISSING",
      });
      cleanupRequest(requestId);
      return;
    }

    pending.windowId = windowId;
    pending.tabId = firstTab.id;
    pending.parseStartedTabId = null;
    pendingByTabId.set(firstTab.id, requestId);

    clearTabLoadTimeout(pending);
    pending.tabLoadTimeoutId = setTimeout(() => {
      const activePending = pendingByRequestId.get(requestId);
      if (!activePending || activePending.tabId !== firstTab.id) {
        return;
      }

      closeCurrentIncognitoTab(requestId, () => {
        handlePageAttemptFailure(requestId, "TAB_LOAD_TIMEOUT");
      });
    }, TAB_LOAD_TIMEOUT_MS);
  });
}

function openFreshIncognitoTab(requestId: string, pageUrl: string): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  chrome.windows.create(
    { url: pageUrl, incognito: true, focused: false, type: "normal" },
    (windowRef) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !windowRef?.id) {
        pending.sendResponse({
          ok: false,
          error: `Unable to open incognito tab: ${runtimeError?.message ?? "window create failed."}`,
          code: "INCOGNITO_TAB_CREATE_FAILED",
        });
        cleanupRequest(requestId);
        return;
      }

      attachIncognitoTabToRequest(requestId, windowRef.id);
    },
  );
}

function closeCurrentIncognitoTab(requestId: string, onClosed: () => void): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  const tabId = pending.tabId;
  const windowId = pending.windowId;

  clearTabLoadTimeout(pending);
  pending.tabId = null;
  pending.windowId = null;
  pending.parseStartedTabId = null;

  if (tabId) {
    pendingByTabId.delete(tabId);
    chrome.tabs.remove(tabId, () => {
      if (windowId) {
        chrome.windows.remove(windowId).catch(() => {
          // ignore close race
        });
      }
      onClosed();
    });
    return;
  }

  if (windowId) {
    chrome.windows
      .remove(windowId)
      .catch(() => {
        // ignore close race
      })
      .then(() => {
        onClosed();
      });
    return;
  }

  onClosed();
}

function cleanupRequest(requestId: string): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  clearTabLoadTimeout(pending);
  pendingByRequestId.delete(requestId);
  if (pending.tabId) {
    pendingByTabId.delete(pending.tabId);
  }

  if (pending.windowId) {
    chrome.windows.remove(pending.windowId).catch(() => {
      // ignore close race
    });
    return;
  }

  if (pending.tabId) {
    chrome.tabs.remove(pending.tabId).catch(() => {
      // ignore close race
    });
  }
}

function finalizeRequest(requestId: string): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  const mergedResults = pending.collectedResults.map((result, index) => ({
    ...result,
    position: index + 1,
  }));

  pending.sendResponse({
    ok: true,
    keyword: pending.keyword,
    results: mergedResults,
    scannedCount: Math.min(
      pending.pagesScanned * RESULTS_PER_PAGE,
      GOOGLE_PAGE_STARTS.length * RESULTS_PER_PAGE,
    ),
  });

  cleanupRequest(requestId);
}

function scheduleNextSearchPage(requestId: string): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  const delayMs = randomPageDelayMs();
  setTimeout(() => {
    openNextSearchPage(requestId);
  }, delayMs);
}

function processPageResults(requestId: string, results: ParsedSearchResult[]): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  pending.pagesScanned += 1;

  if (results.length > 0) {
    pending.collectedResults.push(...results);
    if (hasTargetDomain(results, pending.targetDomain)) {
      finalizeRequest(requestId);
      return;
    }
  }

  pending.currentPageIndex += 1;
  pending.currentPageAttempt = 0;

  if (pending.currentPageIndex >= GOOGLE_PAGE_STARTS.length) {
    finalizeRequest(requestId);
    return;
  }

  scheduleNextSearchPage(requestId);
}

function handlePageAttemptFailure(requestId: string, reason: string): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  const pageNumber = pending.currentPageIndex + 1;
  console.warn(
    `[Rank Checker] Page ${pageNumber} attempt ${pending.currentPageAttempt}/${MAX_PAGE_ATTEMPTS} failed: ${reason}`,
  );

  if (pending.currentPageAttempt < MAX_PAGE_ATTEMPTS) {
    setTimeout(() => {
      openSearchPageAttempt(requestId);
    }, PAGE_RETRY_DELAY_MS);
    return;
  }

  pending.pagesScanned += 1;
  pending.currentPageIndex += 1;
  pending.currentPageAttempt = 0;

  if (pending.currentPageIndex >= GOOGLE_PAGE_STARTS.length) {
    finalizeRequest(requestId);
    return;
  }

  scheduleNextSearchPage(requestId);
}

function openSearchPageAttempt(requestId: string): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  if (pending.currentPageAttempt >= MAX_PAGE_ATTEMPTS) {
    handlePageAttemptFailure(requestId, "MAX_ATTEMPTS_REACHED");
    return;
  }

  pending.currentPageAttempt += 1;
  const pageUrl = buildGoogleSearchUrl(pending.keyword, pending.currentStart);
  console.log(
    `[Rank Checker] Fetching Google URL: ${pageUrl} (attempt ${pending.currentPageAttempt}/${MAX_PAGE_ATTEMPTS})`,
  );
  openFreshIncognitoTab(requestId, pageUrl);
}

function openNextSearchPage(requestId: string): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  if (pending.currentPageIndex >= GOOGLE_PAGE_STARTS.length) {
    finalizeRequest(requestId);
    return;
  }

  pending.currentStart = GOOGLE_PAGE_STARTS[pending.currentPageIndex];
  pending.currentPageAttempt = 0;
  openSearchPageAttempt(requestId);
}

function parseGoogleResultsInTab(maxResults: number): ParsedSearchResult[] {
  function safeText(node: Element | null): string {
    return node?.textContent?.trim() ?? "";
  }

  function resolveResultUrl(rawHref: string): string {
    if (!rawHref) {
      return "";
    }

    const trimmed = rawHref.trim();
    if (!trimmed) {
      return "";
    }

    try {
      const parsed = new URL(trimmed, window.location.origin);

      if (parsed.pathname === "/url") {
        const redirected = parsed.searchParams.get("q") ?? parsed.searchParams.get("url");
        if (!redirected) {
          return "";
        }
        return new URL(redirected).toString();
      }

      if (!/^https?:$/i.test(parsed.protocol)) {
        return "";
      }

      const hostname = parsed.hostname.toLowerCase();
      if (hostname.includes("google.")) {
        return "";
      }

      return parsed.toString();
    } catch {
      return "";
    }
  }

  function getPrimaryAnchor(block: Element): HTMLAnchorElement | null {
    const heading = block.querySelector("h3");
    if (heading) {
      const headingAnchor = heading.closest("a");
      if (headingAnchor instanceof HTMLAnchorElement) {
        return headingAnchor;
      }
    }

    return (
      block.querySelector<HTMLAnchorElement>(".yuRUbf > a") ??
      block.querySelector<HTMLAnchorElement>(".MjjYud a[href]") ??
      block.querySelector<HTMLAnchorElement>("a[data-ved][href]") ??
      block.querySelector<HTMLAnchorElement>("a[href]")
    );
  }

  const seen = new Set<string>();
  const collected: ParsedSearchResult[] = [];
  const selectorGroups = [
    "div#search .MjjYud",
    "div#search .tF2Cxc",
    "div#search .g",
    "div#search .Gx5Zad",
    "div#search div[data-sokoban-container]",
  ];

  for (const selector of selectorGroups) {
    const blocks = document.querySelectorAll(selector);
    for (const block of blocks) {
      const heading = block.querySelector("h3");
      if (!heading) {
        continue;
      }

      const anchor = getPrimaryAnchor(block);
      const rawHref = anchor?.getAttribute("href")?.trim() ?? "";
      const url = resolveResultUrl(rawHref);
      if (!url || seen.has(url)) {
        continue;
      }

      const title =
        safeText(block.querySelector("h3")) ||
        safeText(block.querySelector("[role='heading']")) ||
        safeText(anchor);
      const snippet =
        safeText(block.querySelector(".VwiC3b")) ||
        safeText(block.querySelector(".aCOpRe")) ||
        safeText(block.querySelector("span[data-sncf]"));

      seen.add(url);
      collected.push({
        position: collected.length + 1,
        url,
        title,
        snippet,
      });

      if (collected.length >= maxResults) {
        return collected.slice(0, maxResults);
      }
    }
  }

  return collected.slice(0, maxResults);
}

function normalizeExecuteScriptResults(
  injectionResults: chrome.scripting.InjectionResult<unknown>[] | undefined,
): ParsedSearchResult[] {
  if (!Array.isArray(injectionResults) || injectionResults.length === 0) {
    return [];
  }

  const payload = injectionResults[0]?.result;
  if (!Array.isArray(payload)) {
    return [];
  }

  const normalized: ParsedSearchResult[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as {
      position?: unknown;
      url?: unknown;
      title?: unknown;
      snippet?: unknown;
    };

    if (typeof candidate.url !== "string" || !candidate.url.trim()) {
      continue;
    }

    normalized.push({
      position: normalized.length + 1,
      url: candidate.url.trim(),
      title: typeof candidate.title === "string" ? candidate.title : "",
      snippet: typeof candidate.snippet === "string" ? candidate.snippet : "",
    });
  }

  return normalized.slice(0, RESULTS_PER_PAGE);
}

function executePageParse(requestId: string, tabId: number): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  chrome.scripting.executeScript(
    {
      target: { tabId },
      func: parseGoogleResultsInTab,
      args: [RESULTS_PER_PAGE],
    },
    (injectionResults) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        closeCurrentIncognitoTab(requestId, () => {
          handlePageAttemptFailure(requestId, `EXECUTE_SCRIPT_FAILED: ${runtimeError.message}`);
        });
        return;
      }

      const results = normalizeExecuteScriptResults(injectionResults);
      closeCurrentIncognitoTab(requestId, () => {
        if (results.length === 0) {
          handlePageAttemptFailure(requestId, "EMPTY_RESULTS");
          return;
        }

        processPageResults(requestId, results);
      });
    },
  );
}

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, error: "Invalid message payload." });
    return;
  }

  if ((message as { type?: string }).type === "PING") {
    checkIncognitoAccess().then((allowed) => {
      sendResponse({
        ok: true,
        installed: true,
        version: chrome.runtime.getManifest().version,
        incognitoAccessAllowed: allowed,
        incognitoWarning: allowed ? undefined : INCOGNITO_WARNING_MESSAGE,
      });
    });
    return true;
  }

  if ((message as { type?: string }).type !== "SCRAPE_GOOGLE") {
    sendResponse({ ok: false, error: "Unsupported action." });
    return;
  }

  const keyword =
    typeof (message as { keyword?: unknown }).keyword === "string"
      ? (message as { keyword: string }).keyword.trim()
      : "";
  const targetDomain = normalizeDomainForMatch((message as { domain?: unknown }).domain);

  if (!keyword) {
    sendResponse({ ok: false, error: "Keyword is required." });
    return;
  }

  checkIncognitoAccess().then((allowed) => {
    if (!allowed) {
      sendResponse({
        ok: false,
        error: INCOGNITO_WARNING_MESSAGE,
        code: "INCOGNITO_ACCESS_DISABLED",
      });
      return;
    }

    const requestId = makeRequestId();
    const timeoutId = setTimeout(() => {
      const pending = pendingByRequestId.get(requestId);
      if (!pending) {
        return;
      }

      pending.sendResponse({
        ok: false,
        error: "Google did not respond in time. Please retry in a few minutes.",
        code: "TIMEOUT",
      });

      cleanupRequest(requestId);
    }, REQUEST_TIMEOUT_MS);

    const pending: PendingRequest = {
      requestId,
      keyword,
      targetDomain,
      windowId: null,
      tabId: null,
      parseStartedTabId: null,
      currentStart: 0,
      currentPageIndex: 0,
      currentPageAttempt: 0,
      pagesScanned: 0,
      collectedResults: [],
      timeoutId,
      tabLoadTimeoutId: null,
      sendResponse,
    };

    pendingByRequestId.set(requestId, pending);
    openNextSearchPage(requestId);
  });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  const requestId = pendingByTabId.get(tabId);
  if (!requestId) {
    return;
  }

  const pending = pendingByRequestId.get(requestId);
  if (!pending || pending.tabId !== tabId || pending.parseStartedTabId === tabId) {
    return;
  }

  chrome.tabs.get(tabId, (tab) => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError || !tab?.url) {
      return;
    }

    const isSupportedGoogleUrl =
      /^https:\/\/www\.google\.com\//i.test(tab.url) ||
      /^https:\/\/www\.google\.co\.in\//i.test(tab.url);
    if (!isSupportedGoogleUrl) {
      return;
    }

    const activePending = pendingByRequestId.get(requestId);
    if (!activePending || activePending.tabId !== tabId || activePending.parseStartedTabId === tabId) {
      return;
    }

    activePending.parseStartedTabId = tabId;
    clearTabLoadTimeout(activePending);
    executePageParse(requestId, tabId);
  });
});
