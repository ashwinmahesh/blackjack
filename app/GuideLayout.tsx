import Link from "next/link";
import type { ReactNode } from "react";

const guides = [
  { href: "/rules", label: "Classic rules" },
  { href: "/free-bet", label: "Free Bet" },
  { href: "/double-down-madness", label: "Double Down Madness" },
  { href: "/breakout", label: "Breakout" },
  { href: "/side-bets", label: "Side bet payouts" },
];

export default function GuideLayout({ eyebrow, title, intro, children }: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="guideShell">
      <header className="guideTopBar">
        <Link className="guideBrand" href="/">♠ <span>Ashwin&apos;s Blackjack</span></Link>
        <Link className="guidePlay" href="/">Play free →</Link>
      </header>
      <main className="guideMain">
        <div className="guideHero">
          <p className="guideEyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="guideIntro">{intro}</p>
        </div>
        <div className="guideContent">{children}</div>
        <nav className="guideNav" aria-label="More blackjack guides">
          <h2>Explore the table</h2>
          <div>{guides.map((guide) => <Link key={guide.href} href={guide.href}>{guide.label} <span aria-hidden="true">↗</span></Link>)}</div>
        </nav>
      </main>
      <footer className="guideFooter">Play with practice tokens only. Tokens have no cash value.</footer>
    </div>
  );
}
