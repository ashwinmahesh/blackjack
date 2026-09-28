import type { Metadata } from "next";
import GuideLayout from "../GuideLayout";
import { guideMetadata } from "../../lib/seo";

export const metadata: Metadata = guideMetadata(
  "Blackjack Side Bet Payouts | Ashwin's Blackjack",
  "See the Perfect Pairs, 21+3, Match the Dealer, and Top 3 side bet paytables in Ashwin's Blackjack, including 270:1 suited trips.",
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
    <GuideLayout eyebrow="Table guide · Side bets" title="Blackjack side bet payouts" intro="Side bets are optional wagers on the opening cards. They settle separately from your main hand in Classic and Free Bet, including private multiplayer rooms.">
      {paytables.map((table) => (
        <section key={table.name}>
          <h2>{table.name}</h2>
          <p>{table.detail}</p>
          <table className="guidePaytable"><thead><tr><th scope="col">Result</th><th scope="col">Pays</th></tr></thead><tbody>
            {table.rows.map(([result, payout]) => <tr key={result}><td>{result}</td><td>{payout}</td></tr>)}
          </tbody></table>
        </section>
      ))}
      <section><h2>When can I place them?</h2><p>Choose side bets before the opening deal. Double Down Madness starts the player with one card, so these opening-card bets are unavailable in that mode. All payouts shown are profit odds on practice-token wagers.</p></section>
    </GuideLayout>
  );
}
