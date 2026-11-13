"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const DOCS = [
  ["/docs", "Overview & quick start"],
  ["/docs/merchants", "For merchants"],
  ["/docs/lenders", "For lenders"],
  ["/docs/customers", "For customers (paying)"],
  ["/docs/rupees", "Rupees & the INR gateway"],
  ["/docs/math", "Worked examples & formulas"],
  ["/docs/trust", "Trust, safety & checks"],
  ["/docs/glossary", "Glossary & FAQ"],
] as const;

export function DocsNav() {
  const path = usePathname() ?? "/docs";
  return (
    <nav className="space-y-1 text-sm">
      {DOCS.map(([href, label]) => {
        const on = path === href;
        return (
          <Link
            key={href}
            href={href}
            className={`block rounded-lg px-3 py-2 transition ${
              on ? "bg-ink-700 font-semibold text-sand-300" : "text-ink-800 hover:bg-sand-100"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Previous / next links at the bottom of a docs page. */
export function DocsPager() {
  const path = usePathname() ?? "/docs";
  const i = DOCS.findIndex(([h]) => h === path);
  const prev = i > 0 ? DOCS[i - 1] : null;
  const next = i >= 0 && i < DOCS.length - 1 ? DOCS[i + 1] : null;
  return (
    <div className="mt-12 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
      {prev ? (
        <Link href={prev[0]} className="card-lift rounded-xl border border-line bg-panel p-4 text-sm">
          <span className="text-xs text-subtle">← Previous</span>
          <span className="block font-semibold text-ink-900">{prev[1]}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link
          href={next[0]}
          className="card-lift rounded-xl border border-line bg-panel p-4 text-right text-sm"
        >
          <span className="text-xs text-subtle">Next →</span>
          <span className="block font-semibold text-ink-900">{next[1]}</span>
        </Link>
      )}
    </div>
  );
}
