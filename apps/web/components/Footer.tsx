import Link from "next/link";
import { Logo } from "./art";

const EXIT_PAGE = "https://ipfs.filebase.io/ipfs/bafybeiaybfhshzhm24gfgzly2zy5zd3lvecb5b3sj2agg4fheti2g6nns4";

export function Footer() {
  const col = (title: string, links: [string, string, boolean?][]) => (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-sand-300">{title}</p>
      <ul className="space-y-2 text-sm">
        {links.map(([href, label, ext]) => (
          <li key={href}>
            {ext ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-sand-100/80 hover:text-sand-100"
              >
                {label} ↗
              </a>
            ) : (
              <Link href={href} className="text-sand-100/80 hover:text-sand-100">
                {label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <footer className="ink-texture mt-16 text-sand-100">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-xl font-semibold">Runway</span>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-sand-100/75">
            Working capital that repays itself from sales. Built on NEAR, with private underwriting and
            keyless settlement accounts.
          </p>
          <p className="mt-4 inline-block rounded-full border border-sand-300/40 px-3 py-1 text-xs text-sand-300">
            NEAR testnet · mock USDC · simulated UPI · no real money
          </p>
        </div>
        {col("Use it", [
          ["/merchant", "Merchant dashboard"],
          ["/lend", "Lend to the vault"],
          ["/simulator", "Simulator"],
        ])}
        {col("Learn", [
          ["/docs", "Docs overview"],
          ["/docs/math", "Worked examples"],
          ["/docs/glossary", "Glossary & FAQ"],
        ])}
        {col("Check it", [
          ["/verify", "Verify the agents"],
          ["/audit", "Audit loans & receipts"],
          [EXIT_PAGE, "Exit page (IPFS)", true],
        ])}
      </div>
    </footer>
  );
}
