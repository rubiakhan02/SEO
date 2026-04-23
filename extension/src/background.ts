const REQUEST_TIMEOUT_MS = 240000;
const GOOGLE_PAGE_STARTS = Array.from({ length: 10 }, (_, index) => index * 10);
const RESULTS_PER_PAGE = 10;
const CONTENT_SCRIPT_RETRY_DELAY_MS = 400;
const CONTENT_SCRIPT_MAX_RETRIES = 12;
const INCOGNITO_WARNING_MESSAGE =
  "Please enable incognito access for this extension. Go to chrome://extensions, click Details on the Rank Checker extension, and turn on Allow in Incognito. Then reload the extension.";
const MIN_PAGE_DELAY_MS = 2000;
const MAX_PAGE_DELAY_MS = 3500;

type PendingRequest = {
  requestId: string;
  keyword: string;
  targetDomain: string;
  windowId: number | null;
  tabId: number | null;
  currentStart: number;
  currentPageIndex: number;
  pagesScanned: number;
  collectedResults: unknown[];
  timeoutId: number;
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

function hasTargetDomain(results: unknown[], targetDomain: string): boolean {
  if (!targetDomain) {
    return false;
  }

  return results.some((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const result = item as { url?: unknown };
    return isDomainMatch(result.url, targetDomain);
  });
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
    pendingByTabId.set(firstTab.id, requestId);
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

  pending.tabId = null;
  pending.windowId = null;

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
    ...(result as Record<string, unknown>),
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

function openNextSearchPage(requestId: string): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  if (pending.currentPageIndex >= GOOGLE_PAGE_STARTS.length) {
    finalizeRequest(requestId);
    return;
  }

  const start = GOOGLE_PAGE_STARTS[pending.currentPageIndex];
  pending.currentStart = start;
  const pageUrl = buildGoogleSearchUrl(pending.keyword, start);
  console.log(`[Rank Checker] Fetching Google URL: ${pageUrl}`);
  openFreshIncognitoTab(requestId, pageUrl);
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

function requestContentParse(tabId: number, requestId: string, attempt = 0): void {
  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "PARSE_GOOGLE_SERP",
      requestId,
      pageStart: pending.currentStart ?? 0,
      maxResults: RESULTS_PER_PAGE,
    },
    () => {
      const runtimeError = chrome.runtime.lastError;
      if (!runtimeError) {
        return;
      }

      if (attempt >= CONTENT_SCRIPT_MAX_RETRIES) {
        pending.sendResponse({
          ok: false,
          error: `Could not access Google page content in time: ${runtimeError.message}`,
          code: "CONTENT_SCRIPT_UNAVAILABLE",
        });
        cleanupRequest(requestId);
        return;
      }

      setTimeout(() => {
        requestContentParse(tabId, requestId, attempt + 1);
      }, CONTENT_SCRIPT_RETRY_DELAY_MS);
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
      currentStart: 0,
      currentPageIndex: 0,
      pagesScanned: 0,
      collectedResults: [],
      timeoutId,
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

    requestContentParse(tabId, requestId, 0);
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if ((message as { type?: string }).type !== "GOOGLE_SERP_PARSED") {
    return;
  }

  const requestId =
    typeof (message as { requestId?: unknown }).requestId === "string"
      ? (message as { requestId: string }).requestId
      : "";

  const pending = pendingByRequestId.get(requestId);
  if (!pending) {
    return;
  }

  const senderTabId = sender.tab?.id;
  if (!senderTabId || senderTabId !== pending.tabId) {
    return;
  }

  const pageStart =
    typeof (message as { pageStart?: unknown }).pageStart === "number"
      ? (message as { pageStart: number }).pageStart
      : -1;
  if (pageStart !== pending.currentStart) {
    return;
  }
  pending.pagesScanned += 1;

  if ((message as { captchaDetected?: unknown }).captchaDetected) {
    const captchaHtml =
      typeof (message as { captchaHtml?: unknown }).captchaHtml === "string"
        ? (message as { captchaHtml: string }).captchaHtml
        : "";
    const captchaUrl =
      typeof (message as { captchaUrl?: unknown }).captchaUrl === "string"
        ? (message as { captchaUrl: string }).captchaUrl
        : "";

    closeCurrentIncognitoTab(requestId, () => {
      const activePending = pendingByRequestId.get(requestId);
      if (!activePending) {
        return;
      }

      activePending.sendResponse({
        ok: false,
        error:
          "Google showed a CAPTCHA/blocked page for this request. Wait a few minutes and retry, or reduce request frequency.",
        code: "CAPTCHA_DETECTED",
        captchaHtml,
        captchaUrl,
      });
      cleanupRequest(requestId);
    });
    return;
  }

  const results = Array.isArray((message as { results?: unknown[] }).results)
    ? ((message as { results: unknown[] }).results as unknown[])
    : [];

  if (results.length > 0) {
    pending.collectedResults.push(...results);
    if (hasTargetDomain(results, pending.targetDomain)) {
      closeCurrentIncognitoTab(requestId, () => {
        finalizeRequest(requestId);
      });
      return;
    }
  }

  pending.currentPageIndex += 1;
  const hasMorePages = pending.currentPageIndex < GOOGLE_PAGE_STARTS.length;
  closeCurrentIncognitoTab(requestId, () => {
    if (!hasMorePages) {
      finalizeRequest(requestId);
      return;
    }

    scheduleNextSearchPage(requestId);
  });
});
