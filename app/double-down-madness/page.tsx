import type { Metadata } from "next";
import GuideLayout from "../GuideLayout";
import { guideMetadata } from "../../lib/seo";

export const metadata: Metadata = guideMetadata(
  "Double Down Madness Rules | Ashwin's Blackjack",
  "Learn the one-card deal, repeated doubles, ace rule, and dealer 22 push in Double Down Madness blackjack.",
  "/double-down-madness",
);

export default function DoubleDownMadnessPage() {
  return (
    <GuideLayout eyebrow="Table guide · Double Down Madness" title="Double Down Madness" intro="Start with one player card and decide when to hit, stand, or raise the stakes with another double. This mode is available in solo play.">
      <section>
        <h2>One card to start</h2>
        <p>You receive one opening card instead of two. You can hit and keep playing, or double and take another card. After drawing, you may have another chance to hit or double again. Every paid double adds to your main stake.</p>
      </section>
      <section>
        <h2>What happens with an ace?</h2>
        <p>You can double when your only card is an ace. In that case, you receive exactly one additional card and your hand then stands. The same one-card limit applies when you hit an opening ace.</p>
      </section>
      <section>
        <h2>Other table rules</h2>
        <p>Splitting and surrender are unavailable in this mode. A dealer total of 22 pushes eligible standing hands. The dealer hits soft 17. Opening side bets and insurance are not offered because the player starts with one card.</p>
        <p>The six-deck shoe burns and reveals one card after every shuffle.</p>
      </section>
    </GuideLayout>
  );
}
