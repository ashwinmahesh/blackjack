import type { Metadata } from "next";
import GuideLayout from "../GuideLayout";
import { guideMetadata } from "../../lib/seo";

export const metadata: Metadata = guideMetadata(
  "Double Up Blackjack Rules & Bonus 16 Payouts | Ashwin's Blackjack",
  "Play Double Up Blackjack with practice tokens. Learn when the dealer stops at 16, how the Double Up wager settles, and the Bonus 16 payouts.",
  "/double-up",
);

export default function DoubleUpPage() {
  return (
    <GuideLayout eyebrow="Table guide · Double Up" title="Double Up blackjack"
      intro="Add a second wager to a two-card hand and stand immediately, or play the hand with the usual hit, stand, double, and split choices.">
      <section>
        <h2>Double Up wager</h2>
        <p>After receiving two cards, place a Double Up wager equal to your main hand wager. You must stand on that hand and receive no more cards. A winning hand pays 1:1 on both wagers. If the player and dealer finish with the same total, the main wager pushes but the Double Up wager loses. You cannot Double Up on a natural blackjack.</p>
      </section>
      <section>
        <h2>Dealer 16 rule</h2>
        <p>The dealer stops on any hard or soft 16. A live player hand totaling 21 wins against dealer 16; other live wagers push, including Double Up wagers. Otherwise the dealer hits soft 17, winning blackjacks pay 3:2, and standard winning hands pay 1:1. This table uses six decks and burns one card after each shuffle.</p>
        <p>Double down is available on two cards and draws one card. Splits are limited to four hands; split aces receive one card each. Surrender and insurance are unavailable.</p>
      </section>
      <section>
        <h2>Bonus 16 side bet</h2>
        <p>The optional Bonus 16 wager wins when the dealer stops at 16. Its payout depends on how many cards the dealer used, using the second paytable in the published Nevada rules.</p>
        <table className="guidePaytable"><thead><tr><th scope="col">Dealer cards</th><th scope="col">Pays</th></tr></thead><tbody>
          {[["2", "4:1"], ["3", "5:1"], ["4", "10:1"], ["5", "50:1"], ["6", "100:1"], ["7+", "500:1"]].map(([cards, payout]) =>
            <tr key={cards}><td>{cards}</td><td>{payout}</td></tr>)}
        </tbody></table>
      </section>
      <section>
        <h2>Solo and multiplayer</h2>
        <p>Choose Double Up on the home screen before taking a solo seat or creating a private room. Each player controls their own hand and Double Up wager. All wagers use practice tokens with no cash value.</p>
      </section>
    </GuideLayout>
  );
}
