import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "../components/Footer";
import { Nav } from "../components/Nav";
import "./globals.css";
import { Providers } from "./providers";

const sans = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });

export const metadata: Metadata = {
  title: "Runway · credit that repays itself from sales",
  description:
    "Revenue-based working capital for merchants paid in stablecoins or UPI, funded by lenders, on NEAR (testnet).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="flex min-h-screen flex-col">
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
