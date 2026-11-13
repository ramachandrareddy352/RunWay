// Long-form text styling for the docs (headings, paragraphs, lists, tables, code).
import type { ReactNode } from "react";

export function Prose({ children }: { children: ReactNode }) {
  return (
    <div
      className={[
        "max-w-3xl text-[15px] leading-relaxed text-ink-800",
        "[&_h1]:mb-3 [&_h1]:text-4xl [&_h1]:font-semibold [&_h1]:text-ink-900",
        "[&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-ink-900",
        "[&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink-900",
        "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6",
        "[&_a]:font-semibold [&_a]:text-ink-700 [&_a]:underline [&_a]:decoration-sand-400 [&_a]:underline-offset-2",
        "[&_code]:rounded [&_code]:bg-sand-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-ink-900",
        "[&_strong]:font-semibold [&_strong]:text-ink-900",
        "[&_table]:my-5 [&_table]:w-full [&_table]:overflow-hidden [&_table]:rounded-xl [&_table]:text-sm",
        "[&_th]:bg-ink-700 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-sand-200",
        "[&_td]:border-t [&_td]:border-line [&_td]:bg-panel [&_td]:px-3 [&_td]:py-2 [&_td]:align-top",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/** A formula with its numbers substituted, in a highlighted box. */
export function Formula({ children, result }: { children: ReactNode; result?: ReactNode }) {
  return (
    <div className="my-4 flex flex-wrap items-baseline justify-between gap-3 rounded-xl border border-sand-400/60 bg-sand-100 px-4 py-3 font-mono text-sm text-ink-900">
      <span>{children}</span>
      {result && <span className="font-semibold text-ink-700">= {result}</span>}
    </div>
  );
}

/** Lead paragraph at the top of a docs page. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="!mt-0 text-lg leading-relaxed text-subtle">{children}</p>;
}
