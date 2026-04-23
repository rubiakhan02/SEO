export type ExtensionStatus =
  | "checking"
  | "installed"
  | "incognito_disabled"
  | "missing"
  | "unsupported"
  | "unconfigured";

type ExtensionStatusBannerProps = {
  status: ExtensionStatus;
  message?: string;
};

const statusMap: Record<
  ExtensionStatus,
  { label: string; classes: string; defaultMessage: string }
> = {
  checking: {
    label: "Checking Extension",
    classes: "border-slate-300 bg-slate-50 text-slate-700",
    defaultMessage: "Detecting Chrome extension availability...",
  },
  installed: {
    label: "Extension Active",
    classes: "border-emerald-300 bg-emerald-50 text-emerald-900",
    defaultMessage: "Chrome extension is installed and ready.",
  },
  incognito_disabled: {
    label: "Incognito Access Required",
    classes: "border-rose-300 bg-rose-50 text-rose-900",
    defaultMessage:
      "Please enable incognito access for this extension. Go to chrome://extensions, click Details on the Rank Checker extension, and turn on Allow in Incognito. Then reload the extension.",
  },
  missing: {
    label: "Extension Missing",
    classes: "border-amber-300 bg-amber-50 text-amber-900",
    defaultMessage:
      "Install the company SEO extension in Chrome, then refresh this page.",
  },
  unsupported: {
    label: "Browser Unsupported",
    classes: "border-amber-300 bg-amber-50 text-amber-900",
    defaultMessage: "Open this dashboard in Chrome or a Chromium-based browser.",
  },
  unconfigured: {
    label: "Setup Required",
    classes: "border-amber-300 bg-amber-50 text-amber-900",
    defaultMessage:
      "Set NEXT_PUBLIC_CHROME_EXTENSION_ID in your environment and restart the app.",
  },
};

export function ExtensionStatusBanner({
  status,
  message,
}: ExtensionStatusBannerProps) {
  const config = statusMap[status];

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${config.classes}`}>
      <p className="font-semibold">{config.label}</p>
      <p className="mt-1">{message ?? config.defaultMessage}</p>
    </div>
  );
}
