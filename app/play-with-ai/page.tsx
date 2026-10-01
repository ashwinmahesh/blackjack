import type { Metadata } from "next";
import GuideLayout from "../GuideLayout";
import { guideMetadata } from "../../lib/seo";

export const metadata: Metadata = guideMetadata(
  "Play Blackjack with AI Tools | Ashwin's Blackjack MCP",
  "Connect an MCP-compatible AI tool to Ashwin's Blackjack and play practice-token blackjack in solo or multiplayer rooms.",
  "/play-with-ai",
);

export default function PlayWithAiPage() {
  return (
    <GuideLayout eyebrow="Play with AI" title="Blackjack through your AI tools"
      intro="Connect an MCP-compatible AI assistant to the same server-run blackjack table used by the website. Play solo or invite friends with a room code.">
      <section>
        <h2>Connect</h2>
        <p>Add a remote Streamable HTTP MCP server in your AI tool&apos;s connector settings. Use this endpoint:</p>
        <pre><code>https://ashwinblackjack.com/mcp</code></pre>
        <p>Your AI tool must support remote MCP servers. It discovers the game actions automatically after connecting.</p>
      </section>
      <section>
        <h2>Play a round</h2>
        <ol>
          <li>Ask your assistant to call <code>start_game</code>. Choose Classic, Free Bet, Double Down Madness, Breakout, or Double Up Blackjack.</li>
          <li>Call <code>get_rules</code> for the selected mode, then <code>place_bet</code> and <code>get_game</code> to see your cards and available actions.</li>
          <li>Call <code>play_hand</code> with a listed action such as hit, stand, double, or split. The server deals and settles the hand.</li>
          <li>Call <code>next_round</code> when the round is settled.</li>
        </ol>
      </section>
      <section>
        <h2>Invite friends</h2>
        <p><code>start_game</code> returns a room code and passcode. Share those with friends so they can join on the website or with <code>join_game</code>. Players may join during a game when a seat is open. <code>wait_for_game</code> waits for another player&apos;s move instead of repeatedly checking the table.</p>
        <p>Keep your <code>gameId</code> private. It authorizes your actions at the table; the room code and passcode are the invitation details.</p>
      </section>
      <section>
        <h2>Practice tokens</h2>
        <p>AI sessions begin with 500 practice tokens by default. They are separate from tokens saved in your browser and have no cash value. Games live in server memory and expire after six hours of inactivity or a server restart.</p>
      </section>
    </GuideLayout>
  );
}
