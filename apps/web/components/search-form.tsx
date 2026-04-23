import type { FormEvent } from "react";

type SearchFormProps = {
  keyword: string;
  domain: string;
  engine: "google" | "bing";
  isSubmitting: boolean;
  disabled: boolean;
  onKeywordChange: (value: string) => void;
  onDomainChange: (value: string) => void;
  onDomainBlur: () => void;
  onEngineChange: (value: "google" | "bing") => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function SearchForm({
  keyword,
  domain,
  engine,
  isSubmitting,
  disabled,
  onKeywordChange,
  onDomainChange,
  onDomainBlur,
  onEngineChange,
  onSubmit,
}: SearchFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm"
    >
      <div>
        <label htmlFor="keyword" className="block text-sm font-semibold text-slate-800">
          Keyword
        </label>
        <input
          id="keyword"
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder="running shoes"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-800"
          required
        />
      </div>

      <div>
        <label htmlFor="domain" className="block text-sm font-semibold text-slate-800">
          Website Domain
        </label>
        <input
          id="domain"
          value={domain}
          onChange={(event) => onDomainChange(event.target.value)}
          onBlur={onDomainBlur}
          placeholder="nike.com"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-800"
          required
        />
        <p className="mt-2 text-xs text-slate-600">No `https` needed, just the domain name.</p>
      </div>

      <div>
        <label htmlFor="engine" className="block text-sm font-semibold text-slate-800">
          Search Engine
        </label>
        <select
          id="engine"
          value={engine}
          onChange={(event) => onEngineChange(event.target.value as "google" | "bing")}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-slate-800"
        >
          <option value="google">Google</option>
          <option value="bing" disabled>
            Bing (Coming Soon)
          </option>
        </select>
      </div>

      <button
        type="submit"
        disabled={disabled || isSubmitting}
        className="inline-flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {isSubmitting ? "Checking Rank..." : "Check Rank"}
      </button>
    </form>
  );
}
