import type { Metadata } from "next";
import GuideLayout from "../GuideLayout";
import { guideMetadata } from "../../lib/seo";

export const metadata: Metadata = guideMetadata(
  "Blackjack Side Bet Payouts | Ashwin's Blackjack",
  "See blackjack side bet payouts for Perfect Pairs, 21+3, Match the Dealer, Top 3, Dealer Bust, Bonus 16, Breakout Tie, and Breakout Bonus.",
  "/side-bets",
);

const paytables = [
  { name: "Perfect Pairs", detail: "Uses your two opening cards.", rows: [["Mixed pair", "6:1"], ["Colored pair", "12:1"], ["Perfect pair", "25:1"]] },
  { name: "21 + 3", detail: "Uses your two opening cards and the dealer's upcard.", rows: [["Flush", "5:1"], ["Straight", "10:1"], ["Three of a kind", "30:1"], ["Straight flush", "40:1"], ["Suited three of a kind", "100:1"]] },
  { name: "Match the Dealer", detail: "Each of your opening cards can match the dealer's upcard.", rows: [["Rank match", "4:1"], ["Suited match", "11:1"]] },
  { name: "Top 3", detail: "Uses your two opening cards and the dealer's upcard.", rows: [["Three of a kind", "90:1"], ["Straight flush", "180:1"], ["Suited three of a kind", "270:1"]] },
];

export default function SideBetsPage() {
  return (
    <GuideLayout eyebrow="Table guide · Side bets" title="Blackjack side bet payouts" intro="These opening-card side bets settle separately from your main hand in Classic and Free Bet, including private multiplayer rooms.">
      {paytables.map((table) => (
        <section key={table.name}>
          <h2>{table.name}</h2>
          <p>{table.detail}</p>
          <table className="guidePaytable"><thead><tr><th scope="col">Result</th><th scope="col">Pays</th></tr></thead><tbody>
            {table.rows.map(([result, payout]) => <tr key={result}><td>{result}</td><td>{payout}</td></tr>)}
          </tbody></table>
        </section>
      ))}
      <section><h2>Other modes</h2><p>Double Down Madness offers a <a href="/double-down-madness">Dealer Bust side bet</a>. Double Up offers <a href="/double-up">Bonus 16</a>, which pays when the dealer stops at 16. Breakout offers a 15:1 <a href="/breakout">Tie side bet</a> and Breakout Bonus with either main wager. These settle after the dealer plays. All payouts shown are profit odds on practice-token wagers.</p></section>
    </GuideLayout>
  );
}
