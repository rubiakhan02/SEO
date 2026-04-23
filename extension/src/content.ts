type ParsedSearchResult = {
  position: number;
  url: string;
  title: string;
  snippet: string;
};

function safeText(node: Element | null): string {
  return node?.textContent?.trim() ?? "";
}

function isCaptchaOrBlockedPage(): boolean {
  const text = document.body?.innerText?.toLowerCase() ?? "";
  const title = document.title?.toLowerCase() ?? "";
  const path = window.location.pathname.toLowerCase();

  if (path.includes("/sorry") || path.includes("/interstitial")) {
    return true;
  }

  if (text.includes("unusual traffic") || text.includes("detected unusual traffic")) {
    return true;
  }

  if (text.includes("verify you are human") || text.includes("i'm not a robot")) {
    return true;
  }

  if (title.includes("sorry") || title.includes("captcha")) {
    return true;
  }

  if (document.querySelector("iframe[src*='recaptcha']")) {
    return true;
  }

  return false;
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
    block.querySelector<HTMLAnchorElement>("a[data-ved][href]") ??
    block.querySelector<HTMLAnchorElement>("a[href]")
  );
}

function extractResultsFromDocument(maxResults = 10): ParsedSearchResult[] {
  const seen = new Set<string>();
  const collected: ParsedSearchResult[] = [];

  const selectorGroups = [
    "div#search .MjjYud",
    "div#search .g",
    "div#search .Gx5Zad",
  ];

  for (const selector of selectorGroups) {
    const blocks = document.querySelectorAll(selector);

    blocks.forEach((block) => {
      const heading = block.querySelector("h3");
      if (!heading) {
        return;
      }

      const anchor = getPrimaryAnchor(block);
      const rawHref = anchor?.getAttribute("href")?.trim() ?? "";
      const url = resolveResultUrl(rawHref);
      if (!url) {
        return;
      }

      if (seen.has(url)) {
        return;
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
        return;
      }
    });

    if (collected.length >= maxResults) {
      break;
    }
  }

  return collected.slice(0, maxResults);
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || (message as { type?: string }).type !== "PARSE_GOOGLE_SERP") {
    return;
  }

  const requestId =
    typeof (message as { requestId?: unknown }).requestId === "string"
      ? (message as { requestId: string }).requestId
      : "";
  const pageStart =
    typeof (message as { pageStart?: unknown }).pageStart === "number"
      ? (message as { pageStart: number }).pageStart
      : 0;
  const maxResults =
    typeof (message as { maxResults?: unknown }).maxResults === "number"
      ? (message as { maxResults: number }).maxResults
      : 10;

  if (isCaptchaOrBlockedPage()) {
    chrome.runtime.sendMessage({
      type: "GOOGLE_SERP_PARSED",
      requestId,
      pageStart,
      captchaDetected: true,
      captchaHtml: document.documentElement?.outerHTML?.slice(0, 250000) ?? "",
      captchaUrl: window.location.href,
      results: [],
    });
    return;
  }

  const results = extractResultsFromDocument(maxResults);

  chrome.runtime.sendMessage({
    type: "GOOGLE_SERP_PARSED",
    requestId,
    pageStart,
    results,
  });
});
