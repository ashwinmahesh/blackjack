import type { Metadata } from "next";
import GuideLayout from "../GuideLayout";
import { guideMetadata } from "../../lib/seo";

export const metadata: Metadata = guideMetadata(
  "Classic Blackjack Rules | Ashwin's Blackjack",
  "Learn the Classic six-deck blackjack rules used at Ashwin's Blackjack: 3:2 naturals, dealer hits soft 17, doubling, splitting, and late surrender.",
  "/rules",
);

export default function RulesPage() {
  return (
    <GuideLayout eyebrow="Table guide · Classic" title="Classic blackjack rules" intro="Beat the dealer by getting closer to 21 without going over. These are the rules used for solo Classic games and private multiplayer rooms on this site.">
      <section>
        <h2>How a hand works</h2>
        <p>Number cards count at face value, face cards count as 10, and aces count as 1 or 11, whichever helps the hand most. A two-card ace and ten-value card is blackjack. A hand over 21 busts.</p>
        <p>Place a main bet, receive two cards, then choose to hit or stand. The dealer draws after the players finish and hits soft 17. A higher total than the dealer wins; equal totals push. A blackjack pays 3:2 unless the dealer also has blackjack.</p>
      </section>
      <section>
        <h2>Your choices</h2>
        <dl className="guideDefinitionList">
          <div><dt>Hit</dt><dd>Take another card. You can keep hitting until you stand or bust.</dd></div>
          <div><dt>Stand</dt><dd>Keep your total and wait for the dealer.</dd></div>
          <div><dt>Double</dt><dd>Double your main stake on the first two cards, take exactly one more card, then stand.</dd></div>
          <div><dt>Split</dt><dd>Separate a matching-value pair into two hands with an additional main stake. Ten-value cards can match each other.</dd></div>
          <div><dt>Late surrender</dt><dd>End an eligible hand and get half its main bet back.</dd></div>
        </dl>
        <p>Insurance is not offered. You can choose one, two, or three starting hands in solo Classic play.</p>
      </section>
      <section>
        <h2>The shoe and multiplayer table</h2>
        <p>Each shoe has six decks. One card is burned and revealed after a shuffle before dealing begins. Private rooms use the same Classic rules, with up to five seats. Players can join an open seat or leave while the room is running.</p>
      </section>
    </GuideLayout>
  );
}
