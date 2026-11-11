"use client";
import Link from "next/link";
import { useWallet } from "../lib/wallet";
import { Button } from "./ui";

const LINKS = [
  ["/merchant", "Merchant"],
  ["/merchant/capital", "Capital"],
  ["/merchant/settings", "Settings"],
  ["/lend", "Lend"],
  ["/audit", "Audit"],
  ["/verify", "Verify"],
] as const;

export function Nav() {
  const w = useWallet();
  return (
    <header className="border-b border-line bg-panel">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
        <Link href="/" className="font-semibold">
          Runway <span className="text-xs font-normal text-subtle">testnet</span>
        </Link>
        <nav className="flex flex-wrap gap-3 text-sm">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className="text-subtle hover:text-fg">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          {w.accountId ? (
            <Button variant="secondary" onClick={() => void w.signOut()}>
              {w.accountId}
            </Button>
          ) : (
            <Button onClick={w.signIn}>Connect wallet</Button>
          )}
        </div>
      </div>
    </header>
  );
}
