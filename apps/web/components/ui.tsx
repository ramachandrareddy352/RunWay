import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

// ---------- layout ----------

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

/** Title block at the top of a page: what the page is for, in one or two sentences. */
export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-sand-600">{eyebrow}</p>
        )}
        <h1 className="text-3xl font-semibold text-ink-900 sm:text-4xl">{title}</h1>
        {children && <div className="mt-3 text-base leading-relaxed text-subtle">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  children,
  aside,
  description,
  className = "",
  id,
}: {
  title?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  /** one line under the title saying what this card is for */
  description?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`rounded-2xl border border-line bg-panel p-5 shadow-[0_1px_0_rgba(23,42,44,0.04),0_10px_30px_-22px_rgba(23,42,44,0.35)] sm:p-6 ${className}`}
    >
      {(title || aside) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-lg font-semibold text-ink-900">{title}</h2>}
            {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------- controls ----------

type Variant = "primary" | "secondary" | "danger" | "sand" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-strong shadow-sm",
  secondary: "border border-line bg-panel text-fg hover:border-sand-400 hover:bg-muted",
  danger: "bg-bad text-white hover:opacity-90",
  sand: "bg-sand-300 text-ink-900 hover:bg-sand-200 shadow-sm",
  ghost: "text-ink-700 hover:bg-muted",
};

export function Button({
  variant = "primary",
  className = "",
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function LinkButton({
  href,
  variant = "primary",
  children,
  className = "",
  external,
}: {
  href: string;
  variant?: Variant;
  children: ReactNode;
  className?: string;
  external?: boolean;
}) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition active:scale-[0.98] ${VARIANTS[variant]} ${className}`;
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-semibold text-ink-900">{label}</span>
      <input
        {...p}
        className="w-full rounded-xl border border-line bg-sand-50 px-3.5 py-2.5 font-mono text-sm text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-ink-500 focus:bg-white focus:ring-4 focus:ring-ink-100"
      />
      {hint && <span className="mt-1.5 block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "bad" | "warn" | "ink";
  children: ReactNode;
}) {
  const t = {
    neutral: "bg-muted text-fg",
    good: "bg-good/12 text-good ring-1 ring-good/25",
    bad: "bg-bad/12 text-bad ring-1 ring-bad/25",
    warn: "bg-warn/12 text-warn ring-1 ring-warn/25",
    ink: "bg-ink-700 text-sand-300",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  help,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** plain-language meaning, shown on hover/focus of the (i) */
  help?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-sand-50 p-3.5">
      <div className="flex items-center gap-1 text-xs font-medium text-subtle">
        {label}
        {help && <InfoTip>{help}</InfoTip>}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold text-ink-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-subtle">{sub}</div>}
    </div>
  );
}

/** A small (i) that explains a term on hover or keyboard focus. */
export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-hidden
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-ink-100 text-[10px] font-bold text-ink-700 outline-none"
      >
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-xl bg-ink-800 px-3 py-2 text-xs font-normal leading-relaxed text-sand-100 opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

/** "How this works" panel: closed by default, so a page stays short for people who know it. */
export function Explain({
  title = "How this works",
  children,
  open,
}: {
  title?: ReactNode;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="group rounded-xl border border-ink-100 bg-ink-50/70 px-4 py-3 text-sm">
      <summary className="flex items-center gap-2 font-semibold text-ink-700">
        <span className="details-chevron inline-block transition-transform">›</span>
        {title}
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed text-ink-800">{children}</div>
    </details>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "tip" | "warn" | "good";
  title?: ReactNode;
  children: ReactNode;
}) {
  const t = {
    info: "border-ink-200 bg-ink-50 text-ink-800",
    tip: "border-sand-400 bg-sand-100 text-ink-900",
    warn: "border-warn/40 bg-warn/10 text-ink-900",
    good: "border-good/30 bg-good/10 text-ink-900",
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${t}`}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

/** Numbered steps; `done` ticks a step off, `current` highlights it. */
export function Steps({
  items,
}: {
  items: { title: ReactNode; body?: ReactNode; done?: boolean; current?: boolean }[];
}) {
  return (
    <ol className="space-y-3">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span
            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ${
              s.done
                ? "bg-good text-white"
                : s.current
                  ? "bg-ink-700 text-sand-300 ring-4 ring-sand-300/60"
                  : "bg-muted text-subtle"
            }`}
          >
            {s.done ? "✓" : i + 1}
          </span>
          <div className="min-w-0 text-sm">
            <p className={`font-semibold ${s.current ? "text-ink-900" : "text-ink-800"}`}>{s.title}</p>
            {s.body && <div className="mt-0.5 leading-relaxed text-subtle">{s.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A live "what will happen" box next to a form. */
export function Preview({
  title = "What will happen",
  children,
}: {
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-sand-400/70 bg-gradient-to-br from-sand-100 to-sand-50 p-4 text-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-sand-700">{title}</p>
      <div className="space-y-1.5 text-ink-900">{children}</div>
    </div>
  );
}

/** One line of a Preview or a breakdown: label on the left, value on the right. */
export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "font-semibold" : ""}`}>
      <span className="text-ink-800">{label}</span>
      <span className="text-right font-mono">{value}</span>
    </div>
  );
}

export function Progress({ value, tone = "ink" }: { value: number; tone?: "ink" | "good" | "warn" }) {
  const pct = Math.max(0, Math.min(100, value));
  const t = { ink: "bg-ink-700", good: "bg-good", warn: "bg-warn" }[tone];
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full transition-[width] duration-700 ${t}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SimulatedBanner({ children }: { children?: ReactNode }) {
  return (
    <div role="note" className="rounded-xl border border-warn/35 bg-warn/10 px-4 py-2.5 text-sm">
      <strong className="text-warn">SIMULATED (testnet)</strong>{" "}
      {children ?? "Mock USDC on NEAR testnet. No real money moves."}
    </div>
  );
}

// ---------- errors ----------

/** Contract and network errors, translated into what to do next. */
const ERROR_HINTS: [RegExp, string][] = [
  [/ERR_COOLDOWN/, "The 120-second waiting period isn't over yet. Wait for the countdown, then claim."],
  [/ERR_HANDLE_TAKEN/, "Someone already registered this handle. Pick another one."],
  [/ERR_ALREADY_REGISTERED/, "This wallet is already a merchant. Reload the page."],
  [/ERR_BOUNDS_LIMIT/, "The amount must be between 50 USDC and the offer's limit."],
  [/ERR_OFFER_EXPIRED/, "Offers are valid for 1 hour. Request a new one."],
  [/ERR_OFFER_NOT_OPEN/, "This offer was already used or replaced. Request a new one."],
  [/ERR_ACTIVE_LOAN/, "You already have a loan. Repay it before taking another."],
  [/ERR_DEFAULTED/, "This merchant has a defaulted loan, so new loans are blocked."],
  [
    /ERR_LIQUIDITY|ERR_UTILIZATION/,
    "The vault doesn't have enough free cash right now. Try a smaller amount.",
  ],
  [/ERR_DAILY_CAP/, "Today's limit for first-time borrowers is used up. Try again tomorrow (UTC)."],
  [/ERR_NOTHING_TO_CLAIM/, "There is nothing to claim yet."],
  [/ERR_INSUFFICIENT_SHARES/, "You don't have that many shares."],
  [/rate limited/i, "Too many requests in a minute. Wait a moment and try again."],
  [/test USDC in the last 10 minutes/, "The faucet gives each account 1,000 test USDC every 10 minutes."],
  [
    /Failed to fetch|NetworkError|fetch failed|Load failed/i,
    "The backend may be waking up (free hosting sleeps when idle). Wait a minute and try again.",
  ],
  [/User (rejected|cancelled)|rejected the request/i, "You cancelled it in your wallet. Nothing happened."],
];

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  const hint = ERROR_HINTS.find(([re]) => re.test(msg))?.[1];
  return (
    <div role="alert" className="rounded-xl border border-bad/30 bg-bad/8 px-4 py-3 text-sm text-bad">
      {hint && <p className="mb-1 font-semibold text-ink-900">{hint}</p>}
      <p className="break-words">{msg}</p>
    </div>
  );
}
