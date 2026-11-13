import Link from "next/link";
import type { ReactNode } from "react";
import { FlowDiagram, Icon } from "../components/art";
import { LiveStats } from "../components/LiveStats";
import { Reveal } from "../components/motion";
import { MiniSplit } from "../components/sim/MiniSplit";
import { Container, LinkButton, Steps } from "../components/ui";

const EXIT_PAGE = "https://ipfs.filebase.io/ipfs/bafybeiaybfhshzhm24gfgzly2zy5zd3lvecb5b3sj2agg4fheti2g6nns4";

function Section({
  id,
  eyebrow,
  title,
  children,
  intro,
}: {
  id?: string;
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="py-16 sm:py-20">
      <Container>
        <Reveal className="mb-10 max-w-2xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-sand-600">{eyebrow}</p>
          <h2 className="text-3xl font-semibold text-ink-900 sm:text-4xl">{title}</h2>
          {intro && <p className="mt-3 text-base leading-relaxed text-subtle">{intro}</p>}
        </Reveal>
        {children}
      </Container>
    </section>
  );
}

const ROLES = [
  {
    icon: "store",
    who: "Merchants",
    line: "Get paid in crypto or rupees, then borrow against those sales.",
    does: [
      "Register a payment handle",
      "Share your payment link or QR",
      "Get an offer from your revenue",
      "Repay automatically from sales",
    ],
    needs: "A testnet wallet with about 4 NEAR",
    href: "/merchant",
    cta: "Open the merchant dashboard",
  },
  {
    icon: "vault",
    who: "Lenders",
    line: "Fund merchants' working capital and earn their loan fees.",
    does: [
      "Deposit USDC or rupees",
      "Get runUSDC shares",
      "Watch the share price grow",
      "Withdraw after a 2-minute wait",
    ],
    needs: "A wallet; test USDC is free on the site",
    href: "/lend",
    cta: "Open the lender page",
  },
  {
    icon: "user",
    who: "Customers",
    line: "Pay a merchant with any crypto, or with UPI in rupees.",
    does: [
      "Open the merchant's payment link",
      "Pick crypto or UPI",
      "See the live price first",
      "Pay; the merchant is paid in seconds",
    ],
    needs: "Nothing on testnet: payments are simulated",
    href: "/pay/e2ed573wq?amount=25",
    cta: "See a payment page",
  },
  {
    icon: "shield",
    who: "Judges & auditors",
    line: "Check every claim yourself, without trusting Runway.",
    does: [
      "Verify the agents' keys on-chain",
      "Audit any offer's terms",
      "See every UPI receipt and payout",
      "Use the exit page with no server",
    ],
    needs: "Nothing; no wallet needed to look",
    href: "/verify",
    cta: "Verify the agents",
  },
] as const;

const HOW = [
  {
    icon: "link",
    title: "Get paid through Runway",
    text: "Each merchant gets a keyless settlement account and a payment link. Customers pay any crypto (swapped to USDC by NEAR Intents) or rupees by UPI.",
  },
  {
    icon: "chart",
    title: "Revenue builds a record",
    text: "Every payment is counted on-chain in time windows (5 minutes on testnet, 30 days on mainnet). No bank statements needed.",
  },
  {
    icon: "lock",
    title: "A private underwriter makes an offer",
    text: "An AI-assisted agent in a secure enclave scores the revenue and signs an offer: a limit, a fee and a repay share. Its keys are checked on-chain.",
  },
  {
    icon: "bolt",
    title: "Sales repay the loan",
    text: "While a loan is open, the settlement account sends a fixed share of every payment to the lenders' vault. Busy week, faster repayment; quiet week, smaller payments.",
  },
] as const;

const FAQ: [string, ReactNode][] = [
  [
    "Is any of this real money?",
    "No. This is NEAR testnet: USDC is a mock token, UPI is a mock provider where you press “Simulate success”, and NEAR comes from a free faucet. Every contract call is real and visible on NearBlocks.",
  ],
  [
    "Who decides how much a merchant can borrow?",
    "The underwriter agent, from the merchant's routed revenue. The contract then re-checks every bound (minimum, caps, fee and repay-share ranges), so even a faulty agent can't issue an out-of-policy loan. Try the Simulator to see the exact rule.",
  ],
  [
    "What happens if a merchant stops paying?",
    "Each 5-minute loan period needs at least 10% of what's owed. One miss makes the loan Delinquent and sets aside half the unpaid principal; two misses make it Defaulted. A first-loss reserve pays lenders first.",
  ],
  [
    "Where do the rupees go?",
    "UPI payments land in Runway's payment-provider account, and the INR gateway sends the same value in USDC from its on-chain float, minus a 0.5% spread. Rupee payouts work the other way round. No rupee is ever on-chain.",
  ],
  [
    "Can Runway take the merchants' money?",
    "Settlement accounts have no keys at all: nobody, Runway included, can sign for them. They only split and forward payments by fixed rules, and the exit page lets anyone settle or claim without Runway's servers.",
  ],
  [
    "Do I need to read a guide first?",
    "No. Every page explains what it does and what to enter, and shows what will happen before you confirm. The Docs and the Simulator are there when you want the details.",
  ],
];

export default function Home() {
  return (
    <>
      {/* hero */}
      <section className="ink-texture relative overflow-hidden text-sand-100">
        <Container className="grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-[1.05fr_1fr]">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-sand-300/40 bg-white/5 px-3 py-1 text-xs font-semibold text-sand-300">
              <span className="h-2 w-2 animate-pulse-soft rounded-full bg-sand-300" /> Live on NEAR testnet ·
              simulated money
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] text-sand-100 sm:text-5xl lg:text-6xl">
              Working capital that <span className="shimmer-text">repays itself</span> from your sales.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-sand-100/80">
              Merchants get paid in crypto or rupees and borrow against that revenue. A fixed share of every
              sale repays the loan automatically. Lenders fund the vault and earn the fees. All of it
              on-chain, checkable by anyone.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/merchant" variant="sand">
                <Icon name="store" /> I&apos;m a merchant
              </LinkButton>
              <LinkButton
                href="/lend"
                variant="secondary"
                className="!border-sand-300/50 !bg-transparent !text-sand-100 hover:!bg-white/10"
              >
                <Icon name="vault" /> I want to lend
              </LinkButton>
              <LinkButton href="#how" variant="ghost" className="!text-sand-300 hover:!bg-white/5">
                How it works ↓
              </LinkButton>
            </div>
          </div>
          <div className="animate-float rounded-3xl border border-sand-300/25 bg-ink-800/60 p-4 shadow-2xl backdrop-blur">
            <FlowDiagram className="h-auto w-full" />
            <p className="px-2 pb-1 text-center text-xs text-sand-100/65">
              Every payment lands in the merchant&apos;s keyless settlement account, then splits on-chain.
            </p>
          </div>
        </Container>
      </section>

      <Container className="-mt-8 relative z-10">
        <Reveal>
          <LiveStats />
        </Reveal>
      </Container>

      {/* plain-language summary */}
      <Section eyebrow="In one minute" title="What is Runway?">
        <div className="grid gap-5 md:grid-cols-3">
          {(
            [
              [
                "The problem",
                "Small merchants who sell online or by UPI wait days for cash and can't get a loan without a long credit history or collateral.",
              ],
              [
                "Runway's answer",
                "Route your sales through a Runway payment link. Your revenue history appears on-chain as it happens, and a private underwriter turns it into a credit line within minutes.",
              ],
              [
                "Why lenders can trust it",
                "Repayment is taken from sales by code, not by chasing anyone. Offers are bounded by the contract, agents are verified on-chain, and a reserve absorbs the first losses.",
              ],
            ] as const
          ).map(([t, b], i) => (
            <Reveal key={t} delay={i * 120} className="card-lift rounded-2xl border border-line bg-panel p-6">
              <p className="font-display text-xl font-semibold text-ink-900">{t}</p>
              <p className="mt-2 leading-relaxed text-subtle">{b}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* how it works */}
      <div className="bg-sand-100/70">
        <Section
          id="how"
          eyebrow="How it works"
          title="Four steps, all on-chain"
          intro="From the first sale to a repaid loan. On testnet the whole cycle takes about 30 minutes."
        >
          <ol className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {HOW.map((s, i) => (
              <Reveal
                as="li"
                key={s.title}
                delay={i * 110}
                className="card-lift relative rounded-2xl border border-line bg-panel p-6"
              >
                <span className="absolute right-5 top-4 font-display text-5xl font-semibold text-sand-300/70">
                  {i + 1}
                </span>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-700 text-sand-300">
                  <Icon name={s.icon} />
                </span>
                <p className="mt-4 font-semibold text-ink-900">{s.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-subtle">{s.text}</p>
              </Reveal>
            ))}
          </ol>
        </Section>
      </div>

      {/* interactive */}
      <Section
        eyebrow="Try it"
        title="Watch a payment split"
        intro="Drag the slider. This is the same rule the settlement contract applies to every payment."
      >
        <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_1fr]">
          <Reveal>
            <MiniSplit />
          </Reveal>
          <Reveal delay={150} className="space-y-4">
            {(
              [
                [
                  "The share is fixed when the loan starts",
                  "A first loan of 100 USDC with a 10% fee means 110 owed. If your typical window brings 400 USDC, the share is 110 ÷ (3 × 400) = 9.17%, so about three windows of normal sales repay it.",
                ],
                [
                  "It never takes too much",
                  "The loan only takes what is still owed. The last payment's extra goes back to you, and once it's repaid, 100% of every sale is yours again.",
                ],
                [
                  "Everything is visible",
                  "Each split is a public transaction: what repaid the loan, what was principal, what was fee, and what went to the merchant.",
                ],
              ] as const
            ).map(([t, b]) => (
              <div key={t} className="flex gap-3">
                <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sand-300 text-ink-900">
                  <Icon name="check" className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="font-semibold text-ink-900">{t}</p>
                  <p className="text-sm leading-relaxed text-subtle">{b}</p>
                </div>
              </div>
            ))}
            <LinkButton href="/simulator" variant="primary">
              <Icon name="calc" /> Open the full simulator
            </LinkButton>
          </Reveal>
        </div>
      </Section>

      {/* roles */}
      <div className="bg-sand-100/70">
        <Section
          eyebrow="Pick your role"
          title="What can you do here?"
          intro="Four kinds of people use Runway. Pick yours: every page explains itself as you go."
        >
          <div className="grid gap-5 md:grid-cols-2">
            {ROLES.map((r, i) => (
              <Reveal
                key={r.who}
                delay={i * 100}
                className="card-lift flex flex-col rounded-2xl border border-line bg-panel p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sand-300 text-ink-800">
                    <Icon name={r.icon} />
                  </span>
                  <div>
                    <p className="font-display text-xl font-semibold text-ink-900">{r.who}</p>
                    <p className="text-sm text-subtle">{r.line}</p>
                  </div>
                </div>
                <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  {r.does.map((d) => (
                    <li key={d} className="flex items-start gap-2">
                      <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-good" /> {d}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-subtle">You need: {r.needs}</p>
                <div className="mt-auto pt-5">
                  <Link
                    href={r.href}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-700 hover:text-ink-900"
                  >
                    {r.cta} <Icon name="arrow" className="h-4 w-4" />
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>
      </div>

      {/* rupees */}
      <Section
        eyebrow="Rupees and crypto"
        title="Pay and get paid in either"
        intro="The protocol itself only ever holds USDC. Rupees are converted at the edges by the INR gateway."
      >
        <div className="grid gap-5 md:grid-cols-3">
          {(
            [
              [
                "rupee",
                "UPI in",
                "A customer pays ₹ by UPI. The rupees go to Runway's payment provider; the gateway sends the same value in USDC from its float to the merchant's settlement account, at the live rate minus 0.5%.",
              ],
              [
                "coins",
                "Crypto in",
                "A customer pays any token on any supported chain. NEAR Intents (1Click) swaps it and delivers USDC on NEAR to the settlement account. The quote is checked in the browser first.",
              ],
              [
                "arrow",
                "Rupees out",
                "Merchants and lenders can choose rupees. The vault sends USDC to the gateway, which pays ₹ to the registered UPI ID or bank account and records the rate and a bank-reference hash on-chain.",
              ],
            ] as const
          ).map(([ic, t, b], i) => (
            <Reveal key={t} delay={i * 110} className="card-lift rounded-2xl border border-line bg-panel p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-700 text-sand-300">
                <Icon name={ic} />
              </span>
              <p className="mt-4 font-semibold text-ink-900">{t}</p>
              <p className="mt-2 text-sm leading-relaxed text-subtle">{b}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* trust */}
      <section className="ink-texture py-16 text-sand-100 sm:py-20">
        <Container>
          <Reveal className="mb-10 max-w-2xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-sand-300">
              Don&apos;t trust, verify
            </p>
            <h2 className="text-3xl font-semibold text-sand-100 sm:text-4xl">Every claim is checkable</h2>
          </Reveal>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {(
              [
                [
                  "lock",
                  "Keyless settlement",
                  "Merchants' settlement accounts have zero access keys. They can only split and forward by fixed rules.",
                  "/audit",
                  "Audit",
                ],
                [
                  "shield",
                  "Verified agents",
                  "The underwriter and the INR gateway publish session keys on-chain; your browser checks them before encrypting anything.",
                  "/verify",
                  "Verify",
                ],
                [
                  "chart",
                  "Auditable offers",
                  "Every offer's terms and evidence are on-chain, and the contract's bounds are re-checked in your browser.",
                  "/audit/offer/2",
                  "See an offer",
                ],
                [
                  "book",
                  "An exit page",
                  "A single static file on IPFS lets anyone settle, claim or withdraw with just a wallet, even if Runway disappears.",
                  EXIT_PAGE,
                  "Open it",
                ],
              ] as const
            ).map(([ic, t, b, href, cta], i) => (
              <Reveal
                key={t}
                delay={i * 100}
                className="rounded-2xl border border-sand-300/20 bg-white/5 p-6 backdrop-blur"
              >
                <Icon name={ic} className="h-6 w-6 text-sand-300" />
                <p className="mt-3 font-semibold">{t}</p>
                <p className="mt-2 text-sm leading-relaxed text-sand-100/75">{b}</p>
                <a
                  href={href}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sand-300 hover:text-sand-100"
                >
                  {cta} <Icon name="arrow" className="h-4 w-4" />
                </a>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* quick start */}
      <Section
        eyebrow="Try it on testnet"
        title="Your first loan in about 30 minutes"
        intro="Follow these steps in order; each page tells you what to do next."
      >
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <Reveal className="rounded-2xl border border-line bg-panel p-6">
            <Steps
              items={[
                {
                  title: "Get a testnet wallet and some NEAR",
                  body: (
                    <>
                      Install Meteor Wallet, switch it to testnet and get at least 4 NEAR from the{" "}
                      <a
                        className="font-semibold text-ink-700 underline"
                        href="https://near-faucet.io"
                        target="_blank"
                        rel="noreferrer"
                      >
                        NEAR faucet
                      </a>
                      .
                    </>
                  ),
                },
                {
                  title: "Get test USDC first",
                  body: (
                    <>
                      On{" "}
                      <Link className="font-semibold text-ink-700 underline" href="/lend">
                        Lenders
                      </Link>
                      , press “Get 1,000 test USDC”. This also registers your wallet with the USDC token so
                      payouts and loans can reach you.
                    </>
                  ),
                },
                {
                  title: "Register as a merchant",
                  body: (
                    <>
                      On{" "}
                      <Link className="font-semibold text-ink-700 underline" href="/merchant">
                        Merchants
                      </Link>
                      , pick a handle. About 2 NEAR pays for your keyless settlement account.
                    </>
                  ),
                },
                {
                  title: "Get paid in 3 windows in a row",
                  body: "Pay yourself 400 test USDC once in each of three 5-minute windows, using the payment link on your dashboard. The dashboard counts them for you.",
                },
                {
                  title: "Request and accept an offer",
                  body: "In the next window, sign a request on the Capital page. Expect grade C, 100 USDC. Accept it and the USDC arrives in your wallet.",
                },
                {
                  title: "Repay within 5 minutes",
                  body: "Pay yourself 1,200: 110 repays the loan in one go and the rest is yours. Then try rupees, lending and the exit page.",
                },
              ]}
            />
          </Reveal>
          <Reveal delay={150} className="space-y-4">
            <div className="rounded-2xl border border-sand-400/60 bg-sand-100 p-6">
              <p className="font-display text-xl font-semibold text-ink-900">New here? Start with the docs</p>
              <p className="mt-2 text-sm leading-relaxed text-subtle">
                Plain-language guides for merchants, lenders and customers, a glossary, and worked examples of
                every calculation with real numbers.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <LinkButton href="/docs">
                  <Icon name="book" /> Read the docs
                </LinkButton>
                <LinkButton href="/docs/math" variant="secondary">
                  Worked examples
                </LinkButton>
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-panel p-6 text-sm leading-relaxed text-subtle">
              <p className="mb-1 font-semibold text-ink-900">Real vs simulated on testnet</p>
              Real: every contract call, the 1Click price quotes, NEAR AI private inference and its
              attestation, the live INR rate. Simulated: the USDC (a mock token), UPI (a mock provider), and
              TEE isolation (agents run in local mode).
            </div>
          </Reveal>
        </div>
      </Section>

      {/* FAQ */}
      <div className="bg-sand-100/70">
        <Section eyebrow="Questions" title="Frequently asked">
          <div className="grid gap-3 md:grid-cols-2">
            {FAQ.map(([q, a], i) => (
              <Reveal key={q} delay={(i % 2) * 100}>
                <details className="group rounded-2xl border border-line bg-panel p-5 transition hover:border-sand-400">
                  <summary className="flex items-center justify-between gap-3 font-semibold text-ink-900">
                    {q}
                    <span className="details-chevron text-xl text-sand-600 transition-transform">›</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-subtle">{a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
