import type { Metadata } from "next";
import GuideLayout from "../GuideLayout";
import { guideMetadata } from "../../lib/seo";

export const metadata: Metadata = guideMetadata(
  "Free Bet Blackjack Rules | Ashwin's Blackjack",
  "Play Free Bet blackjack with practice tokens. Learn when free doubles and free splits apply, and why a dealer 22 pushes standing hands.",
  "/free-bet",
);

export default function FreeBetPage() {
  return (
    <GuideLayout eyebrow="Table guide · Free Bet" title="Free Bet blackjack" intro="Free Bet adds house-covered doubles and splits to the Classic game. In exchange, a dealer total of 22 pushes eligible standing hands.">
      <section>
        <h2>Free doubles</h2>
        <p>With a two-card hard total of 9, 10, or 11, you can take a free double. The house covers the additional stake, and you receive one more card. A regular paid double is also available where the table rules allow it.</p>
      </section>
      <section>
        <h2>Free splits</h2>
        <p>You can split a matching-value pair for free, except a pair of ten-value cards. The house covers the added stake on the new hand. Other eligible splits use the regular paid split option.</p>
      </section>
      <section>
        <h2>The dealer 22 rule</h2>
        <p>If the dealer finishes on 22, standing hands push instead of winning. Busted and surrendered hands remain losses. Other scoring follows this site&apos;s Classic blackjack rules, including 3:2 blackjack and the dealer hitting soft 17.</p>
        <p>Opening side bets are available in Free Bet. The game uses a six-deck shoe and reveals one burned card after each shuffle.</p>
      </section>
    </GuideLayout>
  );
}
