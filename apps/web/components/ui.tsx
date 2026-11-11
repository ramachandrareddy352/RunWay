import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Card({
  title,
  children,
  aside,
}: {
  title?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5 shadow-sm">
      {(title || aside) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const v =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-strong"
      : variant === "danger"
        ? "bg-bad text-white"
        : "border border-line bg-panel hover:bg-muted";
  return (
    <button
      {...p}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        {...p}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
      />
      {hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "bad" | "warn";
  children: ReactNode;
}) {
  const t = {
    neutral: "bg-muted text-fg",
    good: "bg-good/15 text-good",
    bad: "bg-bad/15 text-bad",
    warn: "bg-warn/15 text-warn",
  }[tone];
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-bg p-3">
      <div className="text-xs text-subtle">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-subtle">{sub}</div>}
    </div>
  );
}

export function SimulatedBanner({ children }: { children?: ReactNode }) {
  return (
    <div role="note" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
      <strong className="text-warn">SIMULATED (testnet)</strong>{" "}
      {children ?? "Mock USDC on NEAR testnet. No real money moves."}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-bad">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
