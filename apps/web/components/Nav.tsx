"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { Logo } from "./art";

const LINKS = [
  ["/merchant", "Merchants"],
  ["/lend", "Lenders"],
  ["/simulator", "Simulator"],
  ["/docs", "Docs"],
  ["/verify", "Verify"],
  ["/audit", "Audit"],
] as const;

export function Nav() {
  const w = useWallet();
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-40 border-b border-ink-600/40 bg-ink-700/95 text-sand-100 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <Logo />
          <span className="font-display text-xl font-semibold text-sand-100">Runway</span>
          <span className="hidden rounded-full border border-sand-300/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sand-300 sm:inline">
            testnet
          </span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {LINKS.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                active(href)
                  ? "bg-sand-300/15 text-sand-300"
                  : "text-sand-100/80 hover:bg-white/5 hover:text-sand-100"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {w.accountId ? (
            <button
              onClick={() => void w.signOut()}
              title="Sign out"
              className="max-w-[11rem] truncate rounded-xl border border-sand-300/40 px-3 py-2 text-sm font-semibold text-sand-200 transition hover:bg-white/5"
            >
              {w.accountId}
            </button>
          ) : (
            <button
              onClick={w.signIn}
              className="rounded-xl bg-sand-300 px-4 py-2 text-sm font-semibold text-ink-900 shadow-sm transition hover:bg-sand-200 active:scale-[0.98]"
            >
              Connect wallet
            </button>
          )}
          <button
            className="rounded-lg p-2 text-sand-200 hover:bg-white/5 lg:hidden"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-ink-600/40 px-4 pb-4 pt-2 lg:hidden">
          {LINKS.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-2.5 text-sm font-medium ${
                active(href) ? "bg-sand-300/15 text-sand-300" : "text-sand-100/85"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
