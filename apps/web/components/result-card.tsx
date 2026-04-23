type RankResponseData = {
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

type ResultCardProps = {
  result: RankResponseData | null;
  error: string | null;
  captchaPreview?: {
    html: string;
    url?: string;
  } | null;
};

export function ResultCard({ result, error, captchaPreview }: ResultCardProps) {
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-300 bg-rose-50 p-6 text-rose-900">
        <p className="text-sm font-semibold">Unable to complete rank check</p>
        <p className="mt-2 text-sm">{error}</p>
        {captchaPreview?.url ? (
          <p className="mt-2 break-all text-xs">
            CAPTCHA URL: <span className="font-semibold">{captchaPreview.url}</span>
          </p>
        ) : null}
        {captchaPreview?.html ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-rose-200 bg-white">
            <iframe
              title="Captcha preview"
              srcDoc={captchaPreview.html}
              className="h-[420px] w-full bg-white"
              sandbox="allow-same-origin allow-forms allow-scripts"
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/90 p-6 text-slate-600 shadow-sm">
        <p className="text-sm">Run a rank check to see results here.</p>
      </div>
    );
  }

  const checkedAtText = new Date(result.checkedAt).toLocaleString();

  if (
    result.status === "found" &&
    result.position &&
    result.positionOnPage &&
    result.page &&
    result.matchedUrl
  ) {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-emerald-900">Rank Found</p>
          {result.fromCache ? (
            <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900">
              From Cache
            </span>
          ) : null}
        </div>

        <p className="mt-4 text-4xl font-bold text-slate-900">#{result.positionOnPage}</p>
        <p className="mt-1 text-sm text-slate-600">Page {result.page} Position</p>

        <div className="mt-5 space-y-2 text-sm text-slate-700">
          <p>
            <span className="font-semibold">Keyword:</span> {result.keyword}
          </p>
          <p>
            <span className="font-semibold">Domain:</span> {result.domain}
          </p>
          <p>
            <span className="font-semibold">Matched URL:</span> {result.matchedUrl}
          </p>
          <p>
            <span className="font-semibold">Overall Rank:</span> #{result.position}
          </p>
          <p>
            <span className="font-semibold">Engine:</span> {result.engine}
          </p>
          <p>
            <span className="font-semibold">Total Results Scanned:</span> {result.scannedCount}
          </p>
          <p>
            <span className="font-semibold">Checked At:</span> {checkedAtText}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-900 shadow-sm">
      <p className="text-sm font-semibold">Not found in top {result.scannedCount} results</p>
      <p className="mt-2 text-sm">
        {result.domain} was not ranked for &ldquo;{result.keyword}&rdquo; in scanned Google results. Try a broader
        keyword.
      </p>
      <p className="mt-2 text-sm font-semibold">Total Results Scanned: {result.scannedCount}</p>
      <p className="mt-3 text-xs">Checked At: {checkedAtText}</p>
    </div>
  );
}
