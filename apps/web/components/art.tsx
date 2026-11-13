// Logo, icons and the animated money-flow diagram. Pure SVG, no dependencies.
import type { ReactNode, SVGProps } from "react";

export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect width="40" height="40" rx="11" fill="#dfd6ae" />
      <path d="M11 30 L19 10 h4 L15 30 Z" fill="#274245" />
      <path d="M20 30 L25.5 16 h4 L24 30 Z" fill="#274245" opacity="0.75" />
      <path d="M29 30 L31.5 23.5 h3.5 L32.5 30 Z" fill="#274245" opacity="0.5" />
    </svg>
  );
}

type IconName =
  | "store"
  | "vault"
  | "user"
  | "shield"
  | "bolt"
  | "rupee"
  | "arrow"
  | "chart"
  | "check"
  | "clock"
  | "lock"
  | "book"
  | "calc"
  | "spark"
  | "link"
  | "coins";

const PATHS: Record<IconName, ReactNode> = {
  store: <path d="M4 10h16M5 10l1-5h12l1 5M6 10v9h12v-9M10 19v-5h4v5" />,
  vault: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 8.5v1M12 14.5v1M8.5 12h1M14.5 12h1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" />
    </>
  ),
  shield: (
    <path d="M12 3.5 5 6.5v5.2c0 4.3 2.9 7.4 7 8.8 4.1-1.4 7-4.5 7-8.8V6.5l-7-3Zm-3 8.8 2.2 2.2L15.5 10" />
  ),
  bolt: <path d="M13 3 5.5 13.5H11L10 21l7.5-10.5H12L13 3Z" />,
  rupee: <path d="M7 5h10M7 9h10M7 5c5 0 7.5 1.5 7.5 4S12 13 7.5 13L15 20" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  chart: <path d="M4 19h16M7 16v-4M11 16V8M15 16v-6M19 16V5" />,
  check: <path d="M5 12.5 10 17l9-10" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  book: (
    <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5v-15ZM5 20.5A2.5 2.5 0 0 1 7.5 18H19" />
  ),
  calc: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="M8 7h8M8.5 12h1M12 12h1M15.5 12h1M8.5 16h1M12 16h1M15.5 16h1" />
    </>
  ),
  spark: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />,
  link: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
  coins: (
    <>
      <ellipse cx="9" cy="7" rx="5" ry="2.5" />
      <path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7M10 15.4c.9.4 2 .6 3 .6 2.8 0 5-1.1 5-2.5v-4" />
      <path d="M14 9.6c2.3.2 4 1.2 4 2.4" />
    </>
  ),
};

export function Icon({ name, className = "h-5 w-5", ...p }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...p}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Customer → (1Click | INR gateway) → keyless settlement account → vault (repay share) + merchant. */
export function FlowDiagram({ className = "" }: { className?: string }) {
  const node = (x: number, y: number, w: number, title: string, sub: string, strong = false) => (
    <g transform={`translate(${x - w / 2} ${y - 26})`}>
      <rect
        width={w}
        height="52"
        rx="14"
        fill={strong ? "#dfd6ae" : "rgba(223,214,174,0.08)"}
        stroke="rgba(223,214,174,0.55)"
      />
      <text
        x={w / 2}
        y="22"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill={strong ? "#172a2c" : "#f5f1de"}
      >
        {title}
      </text>
      <text x={w / 2} y="39" textAnchor="middle" fontSize="10.5" fill={strong ? "#34585c" : "#c9dbdc"}>
        {sub}
      </text>
    </g>
  );
  const dot = (path: string, dur: string, begin: string, color = "#dfd6ae") => (
    <circle r="4" fill={color}>
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" path={path} />
    </circle>
  );
  const P = {
    toOneclick: "M98 180 C 130 180, 135 112, 165 112",
    toGateway: "M98 180 C 130 180, 135 248, 165 248",
    oneclickToSettle: "M277 112 C 300 112, 300 180, 319 180",
    gatewayToSettle: "M277 248 C 300 248, 300 180, 319 180",
    toVault: "M419 180 C 440 180, 440 96, 464 96",
    toMerchant: "M419 180 C 440 180, 440 264, 464 264",
    loan: "M512 122 L 512 236",
  };
  return (
    <svg
      viewBox="0 0 560 360"
      className={className}
      role="img"
      aria-label="How a payment moves through Runway"
    >
      <defs>
        <marker
          id="rw-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="rgba(223,214,174,0.8)" />
        </marker>
      </defs>
      {Object.entries(P).map(([k, d]) => (
        <path
          key={k}
          d={d}
          fill="none"
          stroke={k === "loan" ? "rgba(157,188,190,0.9)" : "rgba(223,214,174,0.55)"}
          strokeWidth="2"
          className="flow-line"
          markerEnd="url(#rw-arrow)"
        />
      ))}
      {node(52, 180, 92, "Customer", "pays ₹ or crypto")}
      {node(222, 112, 110, "1Click", "crypto → USDC")}
      {node(222, 248, 110, "INR gateway", "₹ → USDC")}
      {node(370, 180, 98, "Settlement", "keyless account", true)}
      {node(512, 96, 92, "Vault", "repay share")}
      {node(512, 264, 92, "Merchant", "the rest")}
      <text x="522" y="186" fontSize="10.5" fill="#c9dbdc">
        loan
      </text>
      <g className="flow-dots">
        {dot(P.toOneclick, "3.2s", "0s")}
        {dot(P.oneclickToSettle, "3.2s", "1.6s")}
        {dot(P.toGateway, "3.2s", "0.8s")}
        {dot(P.gatewayToSettle, "3.2s", "2.4s")}
        {dot(P.toVault, "2.6s", "0.4s", "#9dbcbe")}
        {dot(P.toMerchant, "2.6s", "1.2s")}
        {dot(P.loan, "2.8s", "0.2s", "#9dbcbe")}
      </g>
    </svg>
  );
}
