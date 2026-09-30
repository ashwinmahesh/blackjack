import type { Metadata } from "next";
import GuideLayout from "../GuideLayout";
import { guideMetadata } from "../../lib/seo";

export const metadata: Metadata = guideMetadata(
  "Breakout Blackjack Rules & Tie Payouts | Ashwin's Blackjack",
  "Play Breakout blackjack with practice tokens. Bet on the player, the dealer, or a tie, and see Breakout Bonus and tie payouts.",
  "/breakout",
);

export default function BreakoutPage() {
  return (
    <GuideLayout eyebrow="Table guide · Breakout" title="Breakout blackjack"
      intro="Choose which side wins, or bet on a tie. Once bets close, the player hand and dealer hand play automatically.">
      <section>
        <h2>Pick one outcome</h2>
        <p>Before each deal, put your main wager on Player wins, Dealer wins, or Tie. Both hands hit totals below 17 and hit soft 17. You do not choose hit, stand, double, split, or surrender in this mode. The table uses six decks and burns one card after each shuffle.</p>
        <p>A winning Player or Dealer bet pays 1:1. A winning two-card blackjack pays 3:2. Matching blackjacks push Player and Dealer bets. A Dealer bet also pushes when both hands bust or the player busts against dealer 17.</p>
      </section>
      <section>
        <h2>Tie payouts</h2>
        <p>The Tie choice uses the published Super Tie outcome odds, paid here entirely in practice tokens: both hands bust 1:1; matching totals of 17, 18, or 19 pay 3:1; 20 pays 8:1; a non-blackjack 21 pays 15:1; and matching blackjacks pay 25:1. Other results lose the Tie wager.</p>
      </section>
      <section>
        <h2>Breakout Bonus side bet</h2>
        <p>When your main wager is Dealer wins, you may also bet on both the player and dealer busting. Add the cards in both finished hands to determine the payout. This optional bet settles separately from the main outcome.</p>
        <table className="guidePaytable"><thead><tr><th scope="col">Combined cards</th><th scope="col">Pays</th></tr></thead><tbody>
          {[["6–7", "5:1"], ["8", "15:1"], ["9", "30:1"], ["10", "100:1"], ["11", "150:1"], ["12+", "250:1"]].map(([cards, payout]) =>
            <tr key={cards}><td>{cards}</td><td>{payout}</td></tr>)}
        </tbody></table>
      </section>
      <section>
        <h2>Multiplayer</h2>
        <p>Each seated player chooses their own outcome and wager before the deal. Everyone receives a separate player hand against the shared dealer hand. Payouts go only to the player whose wager wins.</p>
      </section>
    </GuideLayout>
  );
}
