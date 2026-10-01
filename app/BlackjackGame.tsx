"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  type BasicStrategyAdvice,
  canSplit,
  bustPhrase,
  createBurnedShoe,
  Card as CardType,
  createCutPoint,
  DECK_COUNT,
  dealerShouldHit,
  doubleUpDealerShouldHit,
  EMPTY_SIDE_BETS,
  getBasicStrategyAdvice,
  getDoubleDownMadnessStrategyAdvice,
  getDoubleUpStrategyAdvice,
  getFreeBetStrategyAdvice,
  isBlackjack,
  isFreeDouble,
  isFreeSplit,
  isValidTokenBalance,
  MAX_SPLIT_HANDS,
  OPENING_SIDE_BET_KEYS,
  playDealer,
  playDoubleUpDealer,
  scoreHand,
  settleBreakoutBet,
  settleDoubleUpHand,
  settleFinalSideBets,
  settleSideBets,
  SIDE_BET_LABELS,
  SHOE_SIZE,
  type GameMode,
  type BreakoutBet,
  type SideBetKey,
  type SideBetOutcome,
  type SideBets,
} from "../lib/blackjack";

type Phase = "betting" | "dealing" | "playing" | "dealerTurn" | "settled" | "shuffling";
type HandStatus = "active" | "standing" | "busted" | "won" | "lost" | "push" | "surrendered";
type SeenCardCounts = Record<CardType["rank"], number>;
type SoloHandCount = 1 | 2 | 3;
type SoundKind = "deal" | "flip" | "win" | "sidebet" | "blackjack" | "achievement" | "lose" | "tableBust" | "shuffle" | "chip" | "entry" | "click";
type NavigatorWithAudioSession = Navigator & {
  audioSession?: { type: "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record" };
};

type PlayerHand = {
  cards: CardType[];
  bet: number;
  doubleUpStake?: number;
  splitAces?: boolean;
  status: HandStatus;
  result?: string;
  fromSplit?: boolean;
  freeStake?: number;
  profit?: number;
};

type GameState = {
  bankroll: number;
  startingBankroll: number;
  currentBet: number;
  sideBets: SideBets;
  roundSideBetOutcomes: SideBetOutcome[];
  seenCardCounts: SeenCardCounts;
  dealerHoleSeen: boolean;
  shoe: CardType[];
  cutPoint: number;
  dealer: CardType[];
  hands: PlayerHand[];
  startingHandCount: SoloHandCount;
  activeHand: number;
  phase: Phase;
  message: string;
  tone: "neutral" | "win" | "loss";
  round: number;
  mode: GameMode;
  breakoutBet: BreakoutBet;
  burnedCard: CardType;
  shoeSerial: number;
};

type RoomPlayerView = {
  id: string;
  name: string;
  bankroll: number;
  bet: number;
  breakoutBet: BreakoutBet;
  ready: boolean;
  joinedAt: number;
  hands: Array<{
    cards: CardType[];
    bet: number;
    doubleUpStake?: number;
    fromSplit?: boolean;
    splitAces?: boolean;
    freeStake?: number;
    profit?: number;
    status: HandStatus;
    result?: string;
  }>;
  activeHand: number;
  sideBets: SideBets;
  sideBetResults: SideBetOutcome[];
};

type RoomView = {
  code: string;
  hostId: string;
  mode: GameMode;
  phase: "lobby" | "betting" | "playing" | "settled";
  table: { id: string; name: string; minimum: number; chips: number[] };
  players: RoomPlayerView[];
  dealer: Array<CardType | null>;
  currentPlayerId: string | null;
  message: string;
  round: number;
  shoeRemaining: number;
  burnedCard: CardType;
  shoeSerial: number;
  version: number;
  updatedAt: number;
};

type RoomSession = {
  code: string;
  playerId: string;
  seatId: string;
  passcode: string;
  room: RoomView;
};

type PendingRoomAction = {
  action: "bet" | "hit" | "stand" | "double" | "double-up" | "split" | "surrender";
  round: number;
  amount?: number;
  sideBets?: SideBets;
};

const TABLES = [
  { id: "club", name: "Club table", minimum: 10, chips: [10, 25, 50, 100] },
  { id: "silver", name: "Silver table", minimum: 50, chips: [50, 100, 500, 1000] },
  { id: "gold", name: "Gold table", minimum: 100, chips: [100, 500, 1000, 5000] },
  { id: "high-limit", name: "High limit", minimum: 1000, chips: [1000, 5000, 10000, 25000] },
] as const;
const WALLET_KEY = "dealers-edge-token-balance";
const ACHIEVEMENTS_KEY = "dealers-edge-token-achievements-v2";
const SOLO_HAND_COUNT_KEY = "ashwins-blackjack-solo-hand-count";
const RESET_BALANCE = 500;
const ACHIEVEMENT_THRESHOLDS = [
  1000,
  2500,
  5000,
  10000,
  25000,
  50000,
  100000,
  250000,
  500000,
  1000000,
] as const;
const GAME_MODES: Array<{ id: GameMode; name: string; description: string }> = [
  { id: "classic", name: "Classic", description: "Traditional blackjack, splits and surrender" },
  { id: "doubleDownMadness", name: "Double Down Madness", description: "Start with one card, redouble and keep hitting; dealer 22 pushes" },
  { id: "freeBet", name: "Free Bet", description: "Free doubles on hard 9–11 and free non-ten splits; dealer 22 pushes" },
  { id: "breakout", name: "Breakout", description: "Pick player or dealer; both hands play automatically" },
  { id: "doubleUp", name: "Double Up Blackjack", description: "Double your wager and stand; dealer 16 pushes" },
];
const CARD_COUNT_RANKS: CardType["rank"][] = [
  "A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2",
];

const DEAL_DELAY = 330;
const ROOM_DEAL_DELAY = DEAL_DELAY;
const cardBounceAnimations = new WeakMap<HTMLDivElement, Animation>();

function pause(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function recordRoomPerformance(kind: string, duration: number) {
  const root = document.documentElement;
  let previous: Array<{ kind: string; ms: number }> = [];
  try {
    previous = JSON.parse(root.dataset.blackjackPerformance ?? "[]");
  } catch {
    // A bad debug attribute should never affect play.
  }
  root.dataset.blackjackPerformance = JSON.stringify([
    ...previous.slice(-29),
    { kind, ms: Math.round(duration * 10) / 10 },
  ]);
}
const SUIT_MARKS: Record<CardType["suit"], string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

function tokenAmount(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function chipValueClass(value: number) {
  return `chipValue${value}`;
}

function emptySeenCardCounts(): SeenCardCounts {
  return Object.fromEntries(CARD_COUNT_RANKS.map((rank) => [rank, 0])) as SeenCardCounts;
}

function addSeenCards(counts: SeenCardCounts, cards: CardType[]): SeenCardCounts {
  const next = { ...counts };
  cards.forEach((card) => {
    next[card.rank] += 1;
  });
  return next;
}

function draw(shoe: CardType[]) {
  const card = shoe.pop();
  if (!card) throw new Error("The shoe is empty");
  return card;
}

function sideBetStake(sideBets: SideBets) {
  return Object.values(sideBets).reduce((total, wager) => total + wager, 0);
}

function availableSideBetKeys(mode: GameMode): SideBetKey[] {
  if (mode === "doubleDownMadness") return ["dealerBust"];
  if (mode === "breakout") return ["breakoutTie", "breakoutBonus"];
  if (mode === "doubleUp") return ["bonus16"];
  return [...OPENING_SIDE_BET_KEYS];
}

function totalOpeningStake(mainBet: number, sideBets: SideBets, handCount: number) {
  return (mainBet + sideBetStake(sideBets)) * handCount;
}

function roundTokenTotals(
  hands: Array<Pick<PlayerHand, "bet" | "result" | "freeStake" | "profit">>,
  sideBetOutcomes: SideBetOutcome[],
) {
  let tokensWon = 0;
  let tokensLost = 0;
  for (const hand of hands) {
    if (hand.profit !== undefined) {
      if (hand.profit > 0) tokensWon += hand.profit;
      else tokensLost -= hand.profit;
      continue;
    }
    if (hand.result === "BLACKJACK") tokensWon += hand.bet * 1.5;
    else if (hand.result === "WIN" || hand.result === "DEALER BUST") {
      tokensWon += hand.bet + (hand.freeStake ?? 0);
    } else if (hand.result === "SURRENDER") tokensLost += hand.bet - Math.floor(hand.bet / 2);
    else if (["BUST", "DEALER WINS", "DEALER BLACKJACK"].includes(hand.result ?? "")) {
      tokensLost += hand.bet;
    }
  }
  for (const outcome of sideBetOutcomes) {
    if (outcome.won) tokensWon += outcome.profit;
    else tokensLost += outcome.stake;
  }
  return { tokens_won: tokensWon, tokens_lost: tokensLost };
}

function settleBreakoutRound(state: GameState): GameState {
  let payout = 0;
  let netProfit = 0;
  const finalSideBets = state.hands.map((hand) => settleFinalSideBets(hand.cards, state.dealer, state.sideBets));
  const sideBetPayout = finalSideBets.reduce((total, result) => total + result.payout, 0);
  const hands = state.hands.map((hand) => {
    const outcome = settleBreakoutBet(hand.cards, state.dealer, state.breakoutBet, hand.bet);
    payout += outcome.payout;
    netProfit += outcome.profit;
    return { ...hand, status: outcome.status, result: outcome.result, profit: outcome.profit };
  });
  return {
    ...state,
    hands,
    bankroll: state.bankroll + payout + sideBetPayout,
    roundSideBetOutcomes: finalSideBets.flatMap((result) => result.outcomes),
    phase: "settled",
    message: hands.length === 1 ? hands[0].result ?? "Breakout settled" : `Breakout — ${hands.filter((hand) => hand.status === "won").length} winning hands`,
    tone: netProfit > 0 ? "win" : netProfit < 0 ? "loss" : "neutral",
  };
}

function settleRound(state: GameState): GameState {
  if (state.mode === "breakout") return settleBreakoutRound(state);
  const hasLiveHand = state.hands.some(
    (hand) => ["active", "standing"].includes(hand.status) && scoreHand(hand.cards).total <= 21,
  );
  const dealerPlay = hasLiveHand || state.mode === "doubleDownMadness" && state.sideBets.dealerBust > 0 ||
    state.mode === "doubleUp" && state.sideBets.bonus16 > 0
    ? state.mode === "doubleUp" ? playDoubleUpDealer(state.dealer, state.shoe) : playDealer(state.dealer, state.shoe)
    : { cards: state.dealer, shoe: state.shoe };
  const dealerScore = scoreHand(dealerPlay.cards).total;
  const finalSideBets = state.hands.map((hand) => settleFinalSideBets(hand.cards, dealerPlay.cards, state.sideBets));
  const sideBetPayout = finalSideBets.reduce((total, result) => total + result.payout, 0);
  if (state.mode === "doubleUp") {
    let payout = 0;
    let netProfit = 0;
    const hands = state.hands.map((hand) => {
      if (hand.result === "BLACKJACK") return hand;
      const result = settleDoubleUpHand(hand.cards, dealerPlay.cards, hand.bet, hand.doubleUpStake);
      payout += result.payout;
      netProfit += result.profit;
      return { ...hand, status: result.status, result: result.result, profit: result.profit };
    });
    return {
      ...state,
      bankroll: state.bankroll + payout + sideBetPayout,
      roundSideBetOutcomes: [...state.roundSideBetOutcomes, ...finalSideBets.flatMap((result) => result.outcomes)],
      dealer: dealerPlay.cards,
      shoe: dealerPlay.shoe,
      hands,
      phase: "settled",
      message: dealerScore === 16 ? "Dealer 16 — live hands push, 21 wins"
        : dealerScore > 21 ? "Dealer busts — round settled" : `Dealer stands on ${dealerScore}`,
      tone: netProfit > 0 ? "win" : netProfit < 0 ? "loss" : "neutral",
    };
  }
  let payout = 0;
  let won = 0;
  let lost = 0;
  let pushed = 0;

  const hands = state.hands.map((hand) => {
    const playerScore = scoreHand(hand.cards).total;

    if (hand.result === "BLACKJACK") {
      won += 1;
      return hand;
    }
    if (hand.status === "surrendered") {
      lost += 1;
      return hand;
    }

    if (hand.status === "busted" || playerScore > 21) {
      lost += 1;
      return { ...hand, status: "lost" as const, result: "BUST" };
    }
    if ((state.mode !== "classic" && dealerScore === 22) || playerScore === dealerScore) {
      payout += hand.bet;
      pushed += 1;
      return { ...hand, status: "push" as const, result: dealerScore === 22 ? "PUSH 22" : "PUSH" };
    }
    if (dealerScore > 21 || playerScore > dealerScore) {
      payout += hand.bet * 2 + (hand.freeStake ?? 0);
      won += 1;
      return {
        ...hand,
        status: "won" as const,
        result: dealerScore > 21 ? "DEALER BUST" : "WIN",
      };
    }
    lost += 1;
    return { ...hand, status: "lost" as const, result: "DEALER WINS" };
  });

  const message =
    won > 0 && lost === 0
      ? dealerScore > 21
        ? "Dealer busts — you win"
        : hands.length > 1
          ? "Winning hands paid"
          : "You beat the dealer"
      : pushed === hands.length
        ? "Push — your bet is returned"
        : won > 0
          ? "A split decision"
          : "Dealer takes the hand";

  return {
    ...state,
    bankroll: state.bankroll + payout + sideBetPayout,
    roundSideBetOutcomes: [...state.roundSideBetOutcomes, ...finalSideBets.flatMap((result) => result.outcomes)],
    dealer: dealerPlay.cards,
    shoe: dealerPlay.shoe,
    hands,
    phase: "settled",
    message: pushed === hands.length && dealerScore === 22 ? "Dealer 22 — standing hands push" : message,
    tone: won > lost ? "win" : won === lost ? "neutral" : "loss",
  };
}

function advanceOrSettle(state: GameState): GameState {
  const nextIndex = state.hands.findIndex(
    (hand, index) => index > state.activeHand && hand.status === "active",
  );

  if (nextIndex !== -1) {
    return {
      ...state,
      activeHand: nextIndex,
      message: `Playing hand ${nextIndex + 1}`,
      tone: "neutral",
    };
  }

  return {
    ...state,
    phase: "dealerTurn",
    message: "Dealer’s hand",
    tone: "neutral",
  };
}

function PlayingCard({
  card,
  hidden = false,
  revealed = false,
  motion,
  delayMs = 0,
  animated = true,
  onInteract,
}: {
  card?: CardType;
  hidden?: boolean;
  revealed?: boolean;
  motion?: "dealer" | "player";
  delayMs?: number;
  animated?: boolean;
  onInteract?: () => void;
}) {
  const motionClass = motion === "dealer"
    ? "cardMotionDealer"
    : motion === "player"
      ? "cardMotionPlayer"
      : "";
  const motionStyle = delayMs
    ? ({ animationDelay: `${delayMs}ms` } as CSSProperties)
    : undefined;
  const bounceCard = (element: HTMLDivElement) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    cardBounceAnimations.get(element)?.cancel();
    const animation = element.animate(
      [
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(-8px) scale(1.035)", offset: 0.42 },
        { transform: "translateY(1px) scale(.995)", offset: 0.72 },
        { transform: "translateY(0) scale(1)" },
      ],
      { duration: 460, easing: "cubic-bezier(.2,.78,.3,1.18)" },
    );
    cardBounceAnimations.set(element, animation);
    animation.addEventListener("finish", () => {
      if (cardBounceAnimations.get(element) === animation) {
        cardBounceAnimations.delete(element);
      }
    }, { once: true });
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    onInteract?.();
    bounceCard(event.currentTarget);
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onInteract?.();
    bounceCard(event.currentTarget);
  };
  const interactionProps = {
    onKeyDown: handleKeyDown,
    onPointerDown: handlePointerDown,
    role: "button",
    tabIndex: 0,
  } as const;

  if (hidden || !card) {
    return (
      <div
        className={`playingCard cardBack ${motionClass} ${animated ? "" : "cardNoMotion"}`}
        style={motionStyle}
        aria-label="Face-down card"
        {...interactionProps}
      >
        <span className="backFrame">
          <span>DE</span>
        </span>
      </div>
    );
  }

  const isRed = card.suit === "hearts" || card.suit === "diamonds";
  const mark = SUIT_MARKS[card.suit];
  return (
    <div
      className={`playingCard cardFace ${isRed ? "redCard" : "blackCard"} ${motionClass} ${revealed ? "cardReveal" : ""} ${animated ? "" : "cardNoMotion"}`}
      style={motionStyle}
      aria-label={`${card.rank} of ${card.suit}`}
      {...interactionProps}
    >
      <span className="cardCorner">
        <strong>{card.rank}</strong>
        <span>{mark}</span>
      </span>
      <span className="cardSuit">{mark}</span>
      <span className="cardCorner bottomCorner">
        <strong>{card.rank}</strong>
        <span>{mark}</span>
      </span>
    </div>
  );
}

function roomHandTotalLabel(cards: CardType[]) {
  const score = scoreHand(cards);
  const hasAce = cards.some((card) => card.rank === "A");
  if (!hasAce) return String(score.total);
  return `${score.isSoft ? "Soft" : "Hard"} ${score.total}`;
}

function roomDealerTotalLabel(cards: Array<CardType | null>) {
  const visibleCards = cards.filter((card): card is CardType => Boolean(card));
  if (!visibleCards.length) return null;
  return roomHandTotalLabel(visibleCards);
}

function RoomPlayerSeatView({
  player,
  isLocal,
  isActive,
  tableMinimum,
  roomPhase,
  roomMode,
  dealIndex,
  dealPlayerCount,
  dealExtraOffset,
  revealComplete,
  onCardInteract,
  onSelect,
}: {
  player: RoomPlayerView;
  isLocal: boolean;
  isActive: boolean;
  tableMinimum: number;
  roomPhase: RoomView["phase"];
  roomMode: GameMode;
  dealIndex: number;
  dealPlayerCount: number;
  dealExtraOffset: number;
  revealComplete: boolean;
  onCardInteract: () => void;
  onSelect?: (playerId: string) => void;
}) {
  const canPlayNextRound = player.bankroll >= tableMinimum;
  return (
    <article
      className={`roomPlayerSeat ${isLocal ? "roomLocalPlayer" : "roomOpponentPlayer"} ${isActive ? "activeTurn" : ""}`}
      aria-current={isActive ? "true" : undefined}
    >
      {isActive ? (
        <span className="roomTurnBadge">
          <i /> {isLocal ? "Your turn" : "Playing"}
        </span>
      ) : null}
      <header className="roomPlayerSeatHeader">
        {onSelect ? <button className="roomPlayerIdentity roomPlayerSelect" type="button" onClick={() => onSelect(player.id)} aria-label={`Send tokens to ${player.name}`}>
          <i className="roomPlayerAvatar">{player.name.slice(0, 1).toUpperCase()}</i>
          <span><small>Player</small><strong>{player.name}</strong></span>
        </button> : <span className="roomPlayerIdentity">
          <i className="roomPlayerAvatar">{player.name.slice(0, 1).toUpperCase()}</i>
          <span>
            <small>{isLocal ? "Your hand" : "Player"}</small>
            <strong>{player.name}</strong>
          </span>
        </span>}
        <span className="roomPlayerBalance">◎ {tokenAmount(player.bankroll)}</span>
        {onSelect ? <button className="roomSendButton" type="button" onClick={() => onSelect(player.id)}>Send tokens</button> : null}
      </header>
      {player.hands.length ? (
        <div
          className={`roomHands ${isLocal ? "roomLocalHands" : "roomOpponentHands"}`}
          data-hand-count={player.hands.length}
        >
          {player.hands.map((hand, handIndex) => (
            <div
              className={`roomHand ${isActive && handIndex === player.activeHand ? "activeRoomHand" : ""}`}
              key={handIndex}
            >
              <div className={isLocal ? "roomLocalCardFan" : "miniCardFan"}>
                {hand.cards.map((card, cardIndex) => (
                  <PlayingCard
                    animated
                    card={card}
                    delayMs={handIndex === 0 && player.hands.length === 1 && dealIndex >= 0 &&
                      (roomMode === "breakout" || (roomMode === "doubleDownMadness" ? hand.cards.length === 1 : hand.cards.length === 2))
                      ? (roomMode === "breakout" && cardIndex >= 2
                        ? 2 * (dealPlayerCount + 1) + 1 + dealExtraOffset + cardIndex - 2
                        : 1 + (roomMode === "doubleDownMadness" ? dealIndex : cardIndex * (dealPlayerCount + 1) + dealIndex)) * ROOM_DEAL_DELAY
                      : 0}
                    key={card.id}
                    motion={isLocal ? "player" : undefined}
                    onInteract={onCardInteract}
                  />
                ))}
              </div>
              <small>{roomMode === "breakout" && !revealComplete ? "Dealing" : roomHandTotalLabel(hand.cards)} · {roomMode === "breakout"
                ? `${player.breakoutBet} bet ${tokenAmount(hand.bet)}`
                : hand.bet ? `bet ${tokenAmount(hand.bet)}${hand.doubleUpStake ? ` + ${tokenAmount(hand.doubleUpStake)} up` : ""}` : `free bet ${tokenAmount(hand.freeStake ?? 0)}`}</small>
              {hand.result && revealComplete ? <b className={hand.result === "BUST" ? "bust" : ""}>{hand.result}</b> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="roomWaiting">
          {player.bet
            ? `Bet ${tokenAmount(player.bet)}${roomMode === "breakout" ? ` on ${player.breakoutBet}` : ""}`
            : canPlayNextRound
              ? roomPhase === "playing" || roomPhase === "settled" ? "Joins next round" : "Waiting for bet"
              : "Out of tokens"}
        </div>
      )}
      {player.sideBetResults?.filter((outcome) => outcome.won).map((outcome) => (
        <div className="roomSideBetWin" key={outcome.name}>{outcome.name}: {outcome.detail}</div>
      ))}
    </article>
  );
}

const RoomPlayerSeat = memo(RoomPlayerSeatView, (previous, next) =>
  previous.isLocal === next.isLocal &&
  previous.isActive === next.isActive &&
  previous.tableMinimum === next.tableMinimum &&
  previous.roomPhase === next.roomPhase &&
  previous.roomMode === next.roomMode &&
  previous.dealIndex === next.dealIndex &&
  previous.dealPlayerCount === next.dealPlayerCount &&
  previous.dealExtraOffset === next.dealExtraOffset &&
  previous.revealComplete === next.revealComplete &&
  previous.onCardInteract === next.onCardInteract &&
  previous.onSelect === next.onSelect &&
  previous.player.id === next.player.id &&
  previous.player.name === next.player.name &&
  previous.player.bankroll === next.player.bankroll &&
  previous.player.bet === next.player.bet &&
  previous.player.breakoutBet === next.player.breakoutBet &&
  previous.player.activeHand === next.player.activeHand &&
  JSON.stringify(previous.player.hands) === JSON.stringify(next.player.hands) &&
  JSON.stringify(previous.player.sideBetResults) === JSON.stringify(next.player.sideBetResults),
);

function DeckIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="9" y="4" width="16" height="22" rx="3" />
      <path d="M6.5 8.5v16a3 3 0 0 0 3 3h11" />
      <path d="m17 10 4 5-4 5-4-5 4-5Z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.35 2.35 0 0 1 4.56.8c0 1.78-2.36 2.15-2.36 3.7" />
      <path d="M12 17.25h.01" />
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 10v4h3l4 3V7l-4 3H5Z" />
      {muted ? (
        <path d="m16 10 4 4m0-4-4 4" />
      ) : (
        <path d="M16 9.5a4 4 0 0 1 0 5m2-7a7 7 0 0 1 0 9" />
      )}
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.95 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.58 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.95a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.05 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.184 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.866-.014-1.7-2.782.605-3.369-1.344-3.369-1.344-.455-1.158-1.11-1.466-1.11-1.466-.908-.621.069-.608.069-.608 1.004.071 1.532 1.033 1.532 1.033.892 1.531 2.341 1.089 2.91.833.091-.648.349-1.089.635-1.339-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.254-.446-1.272.098-2.65 0 0 .84-.269 2.75 1.027A9.535 9.535 0 0 1 12 6.852a9.55 9.55 0 0 1 2.504.337c1.909-1.296 2.748-1.027 2.748-1.027.545 1.378.202 2.396.099 2.65.64.7 1.028 1.595 1.028 2.688 0 3.848-2.337 4.695-4.566 4.943.359.31.679.923.679 1.86 0 1.343-.012 2.426-.012 2.756 0 .269.18.58.688.482A10.025 10.025 0 0 0 22 12.021C22 6.484 17.523 2 12 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ModeIcon({ mode }: { mode: GameMode }) {
  if (mode === "classic") {
    return <svg viewBox="0 0 28 28" aria-hidden="true"><rect x="4" y="6" width="15" height="19" rx="2" /><rect x="10" y="3" width="15" height="19" rx="2" /><path d="M17.5 10.5 20 14l-2.5 3.5L15 14l2.5-3.5Z" /></svg>;
  }
  if (mode === "doubleDownMadness") {
    return <svg viewBox="0 0 28 28" aria-hidden="true"><path d="m16 2-9 13h7l-2 11 9-14h-7l2-10Z" /></svg>;
  }
  if (mode === "doubleUp") {
    return <svg viewBox="0 0 28 28" aria-hidden="true"><rect x="3" y="6" width="14" height="18" rx="2" /><rect x="11" y="3" width="14" height="18" rx="2" /><path d="M7 12h7M18 13h5M20.5 10.5v5" /></svg>;
  }
  if (mode === "breakout") {
    return <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 7h20M4 21h20M7 7v14M21 7v14M14 4v20M9 13l-2 2 2 2M19 13l2 2-2 2" /></svg>;
  }
  return <svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="10" /><circle cx="14" cy="14" r="7" /><path d="M14 9v10M9 14h10" /></svg>;
}

const BREAKOUT_BET_OPTIONS: Array<{ id: BreakoutBet; label: string; payout: string }> = [
  { id: "player", label: "Player wins", payout: "1:1 · BJ 3:2" },
  { id: "dealer", label: "Dealer wins", payout: "1:1 · BJ 3:2" },
];

function BreakoutBetPicker({ value, onChange }: { value: BreakoutBet; onChange: (bet: BreakoutBet) => void }) {
  return (
    <div className="breakoutBetPicker" role="group" aria-label="Breakout outcome bet">
      {BREAKOUT_BET_OPTIONS.map((option) => (
        <button key={option.id} type="button" className={value === option.id ? "selected" : ""}
          aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          <strong>{option.label}</strong><small>{option.payout}</small>
        </button>
      ))}
    </div>
  );
}

function HandValue({ cards, hidden = false }: { cards: CardType[]; hidden?: boolean }) {
  if (!cards.length) return null;
  const shownCards = hidden ? cards.slice(0, 1) : cards;
  const score = scoreHand(shownCards);
  return (
    <span className="handValue">
      {hidden ? `${score.total}+` : score.total}
      {!hidden && score.isSoft && score.total < 21 ? <small>soft</small> : null}
    </span>
  );
}

function ChipPile({ amount, denominations }: { amount: number; denominations: readonly number[] }) {
  const chips: Array<{ value: number }> = [];
  let remaining = amount;

  for (const denomination of [...denominations].reverse()) {
    const count = Math.floor(remaining / denomination);
    const visibleCount = Math.min(count, 3);
    for (let index = 0; index < visibleCount; index += 1) {
      chips.push({ value: denomination });
    }
    remaining -= count * denomination;
  }

  return (
    <span className={`wagerPile ${chips.length ? "hasChips" : ""}`} aria-hidden="true">
      {chips.slice(0, 9).map((chip, index) => (
        <i
          className={`wagerChipToken ${chipValueClass(chip.value)}`}
          style={{ "--chip-index": index } as CSSProperties}
          key={`${chip.value}-${index}`}
        >
          <b>{tokenAmount(chip.value)}</b>
        </i>
      ))}
    </span>
  );
}

function StrategyAdvisor({
  advice,
  mode,
  open,
  onToggle,
}: {
  advice: BasicStrategyAdvice | null;
  mode: GameMode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="strategyAdvisor">
      <button
        className="strategyToggle"
        type="button"
        aria-expanded={open}
        aria-controls="basic-strategy-advice"
        onClick={onToggle}
      >
        <span>Best move</span>
        <b>{advice?.move ?? "—"}</b>
        <i aria-hidden="true">⌄</i>
      </button>
      {open ? (
        <div className="strategyPanel" id="basic-strategy-advice" role="status">
          {advice ? (
            <>
              <header>
                <span>
                  <small>{mode === "classic" ? "Basic strategy says" : "Mode strategy says"}</small>
                  <strong>{advice.move}</strong>
                </span>
                <b>{advice.handLabel}</b>
              </header>
              <p>{advice.explanation}</p>
              {advice.fallback ? (
                <span className="strategyFallback">
                  If {advice.move.toLowerCase()} is unavailable: {advice.fallback}
                </span>
              ) : null}
              <footer>{mode === "doubleUp"
                ? "6 decks · H17 · dealer stops at 16 · no surrender"
                : mode === "doubleDownMadness"
                ? "6 decks · H17 · repeat doubles · dealer 22 pushes"
                : mode === "freeBet"
                  ? "6 decks · H17 · free bets · dealer 22 pushes"
                  : "6 decks · H17 · DAS · late surrender · no card count"}</footer>
            </>
          ) : (
            <p className="strategyWaiting">Deal a hand to see the recommended move.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function BlackjackGame() {
  const [wallet, setWallet] = useState(RESET_BALANCE);
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string>(TABLES[0].id);
  const [selectedMode, setSelectedMode] = useState<GameMode>("classic");
  const modeDropdownRef = useRef<HTMLDetailsElement | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetTokensOpen, setResetTokensOpen] = useState(false);
  const [soloHandCount, setSoloHandCount] = useState<SoloHandCount>(1);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [roomMode, setRoomMode] = useState<"create" | "join" | null>(null);
  const [roomName, setRoomName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roomPasscode, setRoomPasscode] = useState("");
  const [roomError, setRoomError] = useState("");
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomSession, setRoomSession] = useState<RoomSession | null>(null);
  const [homeNotice, setHomeNotice] = useState("");
  const [roomWager, setRoomWager] = useState(10);
  const [pendingRoomAction, setPendingRoomAction] = useState<PendingRoomAction | null>(null);
  const [roomSideBets, setRoomSideBets] = useState<SideBets>({ ...EMPTY_SIDE_BETS });
  const [roomBreakoutBet, setRoomBreakoutBet] = useState<BreakoutBet>("player");
  const [revealedBreakoutRound, setRevealedBreakoutRound] = useState("");
  const [revealedBreakoutHole, setRevealedBreakoutHole] = useState("");
  const [donationTarget, setDonationTarget] = useState<string | null>(null);
  const [donationAmount, setDonationAmount] = useState("");
  const [roomLinkCopied, setRoomLinkCopied] = useState(false);
  const [cardCountOpen, setCardCountOpen] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [unlockedAchievements, setUnlockedAchievements] = useState<number[]>([]);
  const [achievementsLoaded, setAchievementsLoaded] = useState(false);
  const [achievementBanner, setAchievementBanner] = useState<number | null>(null);
  const [tableBustNotice, setTableBustNotice] = useState<{
    id: number;
    balance: number;
    minimum: number;
    phrase: string | null;
  } | null>(null);
  const [sideBetCelebration, setSideBetCelebration] = useState<{
    id: number;
    outcomes: SideBetOutcome[];
  } | null>(null);
  const [burnReveal, setBurnReveal] = useState<{ key: string; rank: CardType["rank"]; suit: CardType["suit"] } | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const soundEnabledRef = useRef(true);
  const soloHandCountRef = useRef<SoloHandCount>(1);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNeedsRebuildRef = useRef(false);
  const previousRoomRef = useRef<RoomView | null>(null);
  const roomVersionReceivedAtRef = useRef(new Map<number, number>());
  const previousAchievementBalanceRef = useRef<number | null>(null);
  const previousAchievementSourceRef = useRef("");
  const achievementQueueRef = useRef<number[]>([]);
  const lastTableBustRoundRef = useRef("");
  const roomBustTrackerRef = useRef<{ source: string; announced: boolean } | null>(null);
  const lastBurnRevealKeyRef = useRef("");
  const analyticsSessionIdRef = useRef(0);
  const trackedRoundsRef = useRef(new Set<string>());
  const activeRoomCode = roomSession?.code;
  const activeRoomSeatId = roomSession?.seatId;
  const activeRoomVersion = roomSession?.room.version;
  const activeRoomPhase = roomSession?.room.phase;
  const breakoutRevealKey = roomSession?.room.mode === "breakout" && activeRoomPhase === "settled"
    ? `${roomSession.code}:${roomSession.room.round}` : "";
  const breakoutRevealCardCount = breakoutRevealKey && roomSession
    ? roomSession.room.dealer.length + roomSession.room.players.reduce((total, player) =>
      total + player.hands.reduce((handTotal, hand) => handTotal + hand.cards.length, 0), 0)
    : 0;
  const breakoutDealtPlayers = breakoutRevealKey && roomSession
    ? roomSession.room.players.filter((player) => player.hands.length > 0) : [];
  const breakoutPlayerExtraCards = breakoutDealtPlayers.reduce((total, player) =>
    total + Math.max(0, (player.hands[0]?.cards.length ?? 2) - 2), 0);
  const breakoutFlipStep = 2 * (breakoutDealtPlayers.length + 1) + breakoutPlayerExtraCards + 2;
  const breakoutDealerExtraCards = breakoutRevealKey && roomSession
    ? Math.max(0, roomSession.room.dealer.length - 2) : 0;
  const breakoutRevealPending = Boolean(breakoutRevealKey && revealedBreakoutRound !== breakoutRevealKey);
  const screenKey = roomSession
    ? roomSession.room.phase === "lobby" ? "lobby" : "roomGame"
    : game ? "solo" : "home";
  const burnShoeKey = roomSession
    ? `${roomSession.code}:${roomSession.room.shoeSerial}`
    : game ? `solo:${analyticsSessionIdRef.current}:${game.shoeSerial}` : "";
  const burnRank = roomSession?.room.burnedCard.rank ?? game?.burnedCard.rank;
  const burnSuit = roomSession?.room.burnedCard.suit ?? game?.burnedCard.suit;
  const canRevealBurn = roomSession
    ? roomSession.room.phase === "betting"
    : game?.phase === "betting";
  const burnRevealActive = burnReveal?.key === burnShoeKey;
  const gameBankroll = game?.bankroll;
  const selectedTable = TABLES.find((table) => table.id === selectedTableId) ?? TABLES[0];
  const sideBetValues = [0, selectedTable.minimum / 2, selectedTable.minimum, selectedTable.minimum * 2];
  const seenCardTotal = game
    ? Object.values(game.seenCardCounts).reduce((total, count) => total + count, 0)
    : 0;

  useEffect(() => {
    const closeModeMenu = (event: PointerEvent) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
        modeDropdownRef.current.open = false;
      }
    };
    document.addEventListener("pointerdown", closeModeMenu);
    return () => document.removeEventListener("pointerdown", closeModeMenu);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screenKey]);

  useEffect(() => {
    if (!burnShoeKey || !burnRank || !burnSuit || !canRevealBurn || lastBurnRevealKeyRef.current === burnShoeKey) return;
    lastBurnRevealKeyRef.current = burnShoeKey;
    const start = window.setTimeout(() => setBurnReveal({ key: burnShoeKey, rank: burnRank, suit: burnSuit }), 0);
    return () => window.clearTimeout(start);
  }, [burnShoeKey, burnRank, burnSuit, canRevealBurn]);

  useEffect(() => {
    if (!burnReveal) return;
    const end = window.setTimeout(() => setBurnReveal((current) => current?.key === burnReveal.key ? null : current), 2300);
    return () => window.clearTimeout(end);
  }, [burnReveal]);

  useEffect(() => {
    if (!breakoutRevealKey) return;
    const flip = window.setTimeout(() => setRevealedBreakoutHole(breakoutRevealKey),
      breakoutFlipStep * ROOM_DEAL_DELAY);
    return () => window.clearTimeout(flip);
  }, [breakoutRevealKey, breakoutFlipStep]);

  useEffect(() => {
    if (!breakoutRevealKey) return;
    const end = window.setTimeout(() => setRevealedBreakoutRound(breakoutRevealKey),
      (breakoutRevealCardCount + (breakoutDealerExtraCards ? 3 : 2)) * ROOM_DEAL_DELAY + 650);
    return () => window.clearTimeout(end);
  }, [breakoutRevealKey, breakoutRevealCardCount, breakoutDealerExtraCards]);

  const applyRoomUpdate = useCallback((nextRoom: RoomView) => {
    roomVersionReceivedAtRef.current.set(nextRoom.version, performance.now());
    setRoomSession((current) => {
      if (!current || current.code !== nextRoom.code || nextRoom.version <= current.room.version) return current;
      return { ...current, room: nextRoom };
    });
  }, []);

  useLayoutEffect(() => {
    const version = roomSession?.room.version;
    if (!version) return;
    const receivedAt = roomVersionReceivedAtRef.current.get(version);
    if (receivedAt === undefined) return;
    roomVersionReceivedAtRef.current.delete(version);
    const committedAt = performance.now();
    performance.measure("blackjack:room-render-commit", { start: receivedAt, end: committedAt });
    recordRoomPerformance("renderCommit", committedAt - receivedAt);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const paintedAt = performance.now();
        performance.measure("blackjack:room-paint", { start: receivedAt, end: paintedAt });
        recordRoomPerformance("paint", paintedAt - receivedAt);
      });
    });
  }, [roomSession?.room.version]);

  useEffect(() => {
    if (!activeRoomVersion || activeRoomPhase === "lobby") return;
    const animations = Array.from(document.querySelectorAll<HTMLElement>(
      ".roomGameScreen .playingCard.cardMotionDealer, .roomLocalPlayer .playingCard.cardMotionPlayer",
    )).flatMap((element) => element.getAnimations());
    if (!animations.length) return;
    const startedAt = performance.now();
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      const finishedAt = performance.now();
      performance.measure("blackjack:room-card-animation", { start: startedAt, end: finishedAt });
      recordRoomPerformance("cardAnimation", finishedAt - startedAt);
    });
  }, [activeRoomVersion, activeRoomPhase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const joinParams = new URLSearchParams(window.location.search);
      const inviteCode = joinParams.get("room")?.trim().toUpperCase() ?? "";
      const invitePasscode = joinParams.get("passcode") ?? "";
      if (inviteCode && invitePasscode) {
        setRoomMode("join");
        setRoomName((name) => name || "Player");
        setRoomCode(inviteCode.slice(0, 5));
        setRoomPasscode(invitePasscode.slice(0, 32));
      }

      const cachedBalanceValue = window.localStorage.getItem(WALLET_KEY);
      const cachedBalance = Number(cachedBalanceValue);
      const startingBalance =
        cachedBalanceValue !== null && isValidTokenBalance(cachedBalance)
          ? cachedBalance
          : RESET_BALANCE;
      let storedAchievements: number[] = [];
      try {
        const parsed = JSON.parse(window.localStorage.getItem(ACHIEVEMENTS_KEY) ?? "[]");
        if (Array.isArray(parsed)) {
          storedAchievements = parsed.filter(
            (value): value is number =>
              typeof value === "number" &&
              (ACHIEVEMENT_THRESHOLDS as readonly number[]).includes(value),
          );
        }
      } catch {
        // A malformed cache should not prevent the game from loading.
      }
      const initialAchievements = [...new Set(storedAchievements)];
      const storedHandCount = Number(window.localStorage.getItem(SOLO_HAND_COUNT_KEY));
      const initialHandCount: SoloHandCount = storedHandCount === 2 || storedHandCount === 3
        ? storedHandCount
        : 1;
      setWallet(startingBalance);
      soloHandCountRef.current = initialHandCount;
      setSoloHandCount(initialHandCount);
      setUnlockedAchievements(initialAchievements);
      setAchievementsLoaded(true);
      previousAchievementBalanceRef.current = startingBalance;
      previousAchievementSourceRef.current = "wallet";
      window.localStorage.setItem(WALLET_KEY, String(startingBalance));
      window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(initialAchievements));
      setWalletLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!walletLoaded || gameBankroll === undefined) return;
    const timer = window.setTimeout(() => {
      setWallet(gameBankroll);
      window.localStorage.setItem(WALLET_KEY, String(gameBankroll));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [gameBankroll, walletLoaded]);

  useEffect(() => {
    if (!achievementsLoaded) return;
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(unlockedAchievements));
  }, [achievementsLoaded, unlockedAchievements]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    soloHandCountRef.current = soloHandCount;
  }, [soloHandCount]);

  useEffect(() => {
    if (!sideBetCelebration) return;
    const timer = window.setTimeout(() => setSideBetCelebration(null), 2600);
    return () => window.clearTimeout(timer);
  }, [sideBetCelebration]);

  useEffect(() => {
    if (!activeRoomCode) return;
    let cancelled = false;
    let fallbackInterval: number | undefined;
    const events = new EventSource(`/api/rooms/${activeRoomCode}/events`);

    const acceptRoom = (nextRoom: RoomView | null) => {
      if (cancelled) return;
      if (!nextRoom || !nextRoom.players.some((player) => player.id === activeRoomSeatId)) {
        events.close();
        setRoomSession(null);
        setHomeNotice(nextRoom ? "You left the room or the host removed your seat." : "This room has closed.");
        return;
      }
      applyRoomUpdate(nextRoom);
    };

    async function refreshRoom() {
      try {
        const response = await fetch(`/api/rooms/${activeRoomCode}`, { cache: "no-store" });
        if (response.status === 404) return acceptRoom(null);
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { room: RoomView };
        acceptRoom(data.room);
      } catch {
        // The event stream reconnects; the fallback check can recover separately.
      }
    }

    events.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { room: RoomView | null };
        acceptRoom(data.room);
      } catch {
        // Ignore a malformed event; the next version replaces it.
      }
    };
    events.onopen = () => {
      if (fallbackInterval) window.clearInterval(fallbackInterval);
      fallbackInterval = undefined;
    };
    events.onerror = () => {
      if (!fallbackInterval) fallbackInterval = window.setInterval(() => void refreshRoom(), 4000);
      void refreshRoom();
    };
    return () => {
      cancelled = true;
      events.close();
      if (fallbackInterval) window.clearInterval(fallbackInterval);
    };
  }, [activeRoomCode, activeRoomSeatId, applyRoomUpdate]);

  const unlockAudio = useCallback(() => {
    if (!soundEnabledRef.current || typeof window === "undefined") return null;
    try {
      const audioSession = (window.navigator as NavigatorWithAudioSession).audioSession;
      if (audioSession && audioSession.type !== "playback") {
        audioSession.type = "playback";
      }
      if (audioNeedsRebuildRef.current) {
        const staleContext = audioContextRef.current;
        audioContextRef.current = null;
        audioNeedsRebuildRef.current = false;
        if (staleContext && staleContext.state !== "closed") {
          void staleContext.close().catch(() => {
            // A broken iOS context can reject close(); it is no longer reused either way.
          });
        }
      }
      const existingContext = audioContextRef.current;
      const context = !existingContext || existingContext.state === "closed"
        ? new AudioContext()
        : existingContext;
      audioContextRef.current = context;
      if (context.state !== "running") {
        void context.resume().catch(() => {
          // Mobile browsers may require the next direct user gesture to resume audio.
        });
      }
      return context;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const markAudioForRebuild = () => {
      if (audioContextRef.current) audioNeedsRebuildRef.current = true;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") markAudioForRebuild();
    };
    const unlockFromInteraction = () => {
      unlockAudio();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", markAudioForRebuild);
    window.addEventListener("pagehide", markAudioForRebuild);
    window.addEventListener("pointerdown", unlockFromInteraction, { capture: true });
    window.addEventListener("keydown", unlockFromInteraction, { capture: true });
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", markAudioForRebuild);
      window.removeEventListener("pagehide", markAudioForRebuild);
      window.removeEventListener("pointerdown", unlockFromInteraction, { capture: true });
      window.removeEventListener("keydown", unlockFromInteraction, { capture: true });
    };
  }, [unlockAudio]);

  function toggleSound() {
    const enabled = !soundEnabledRef.current;
    soundEnabledRef.current = enabled;
    setSoundEnabled(enabled);
    if (enabled) unlockAudio();
  }

  const playCardSound = useCallback(function playSound(kind: SoundKind) {
    if (!soundEnabledRef.current || typeof window === "undefined") return;

    const context = unlockAudio();
    if (!context) return;
    if (context.state !== "running") {
      void context.resume().then(() => {
        if (audioContextRef.current === context && context.state === "running") {
          playSound(kind);
        }
      }).catch(() => {
        // The next direct interaction will retry with a fresh context.
      });
      return;
    }

    if (kind === "win") {
      const winChime = [
        [0, 659.25],
        [0.12, 783.99],
        [0.24, 987.77],
      ] as const;
      winChime.forEach(([offset, frequency]) => {
        const start = context.currentTime + offset;
        [frequency, frequency * 2].forEach((partial, partialIndex) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(partial, start);
          gain.gain.setValueAtTime(0.001, start);
          gain.gain.exponentialRampToValueAtTime(
            partialIndex === 0 ? 0.065 : 0.018,
            start + 0.012,
          );
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.42);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.44);
        });
      });
      return;
    }

    if (kind === "sidebet") {
      const sideBetChime = [
        [0, 440],
        [0.16, 554.37],
      ] as const;
      sideBetChime.forEach(([offset, frequency], index) => {
        const start = context.currentTime + offset;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(index === 1 ? 0.065 : 0.055, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.34);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.36);
      });
      return;
    }

    if (kind === "blackjack") {
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * 0.1;
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.095, start + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.38);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.4);
      });
      return;
    }

    if (kind === "achievement") {
      const start = context.currentTime;
      const masterGain = context.createGain();
      masterGain.gain.setValueAtTime(0.001, start);
      masterGain.gain.exponentialRampToValueAtTime(0.085, start + 0.025);
      masterGain.gain.exponentialRampToValueAtTime(0.001, start + 1.05);
      masterGain.connect(context.destination);

      [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const noteStart = start + index * 0.11;
        oscillator.type = index < 3 ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, noteStart);
        gain.gain.setValueAtTime(0.001, noteStart);
        gain.gain.exponentialRampToValueAtTime(index === 4 ? 0.7 : 0.42, noteStart + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.5);
        oscillator.connect(gain);
        gain.connect(masterGain);
        oscillator.start(noteStart);
        oscillator.stop(noteStart + 0.52);
      });
      return;
    }

    if (kind === "tableBust") {
      const notes = [
        { offset: 0, frequency: 392, duration: 0.34 },
        { offset: 0.2, frequency: 329.63, duration: 0.34 },
        { offset: 0.4, frequency: 261.63, duration: 0.38 },
        { offset: 0.64, frequency: 196, duration: 0.62 },
      ];

      notes.forEach(({ offset, frequency, duration }, index) => {
        const start = context.currentTime + offset;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = index === notes.length - 1 ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(index === notes.length - 1 ? 0.09 : 0.065, start + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.02);
      });
      return;
    }

    if (kind === "lose") {
      const start = context.currentTime;
      const filter = context.createBiquadFilter();
      const masterGain = context.createGain();

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(760, start);
      filter.frequency.exponentialRampToValueAtTime(300, start + 0.72);
      filter.Q.value = 2.1;
      masterGain.gain.setValueAtTime(0.001, start);
      masterGain.gain.exponentialRampToValueAtTime(0.075, start + 0.025);
      masterGain.gain.exponentialRampToValueAtTime(0.001, start + 0.74);
      filter.connect(masterGain);
      masterGain.connect(context.destination);

      const hornVoices: Array<{
        type: OscillatorType;
        from: number;
        to: number;
        level: number;
      }> = [
        { type: "sawtooth", from: 220, to: 76, level: 0.55 },
        { type: "triangle", from: 174, to: 60, level: 0.42 },
      ];

      hornVoices.forEach((voice) => {
        const oscillator = context.createOscillator();
        const voiceGain = context.createGain();
        oscillator.type = voice.type;
        oscillator.frequency.setValueAtTime(voice.from, start);
        oscillator.frequency.exponentialRampToValueAtTime(voice.to, start + 0.68);
        voiceGain.gain.value = voice.level;
        oscillator.connect(voiceGain);
        voiceGain.connect(filter);
        oscillator.start(start);
        oscillator.stop(start + 0.76);
      });
      return;
    }

    if (kind === "chip") {
      [1480, 2290].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * 0.008;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(index === 0 ? 0.045 : 0.022, start + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.075);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.08);
      });
      return;
    }

    if (kind === "entry") {
      [392, 523.25, 659.25].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * 0.075;
        oscillator.type = index === 0 ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.045, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.32);
      });
      return;
    }

    const duration = kind === "shuffle" ? 0.72 : kind === "flip" ? 0.09 : kind === "click" ? 0.035 : 0.075;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      const progress = index / samples.length;
      samples[index] = (Math.random() * 2 - 1) * (1 - progress) ** 2;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = "bandpass";
    filter.frequency.value = kind === "shuffle" ? 820 : kind === "flip" ? 2100 : kind === "click" ? 1650 : 1150;
    filter.Q.value = kind === "flip" ? 0.8 : 0.55;
    gain.gain.setValueAtTime(
      kind === "shuffle" ? 0.13 : kind === "flip" ? 0.11 : kind === "click" ? 0.045 : 0.085,
      context.currentTime,
    );
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start();
  }, [unlockAudio]);

  useEffect(() => {
    const nextRoom = roomSession?.room ?? null;
    const previousRoom = previousRoomRef.current;
    previousRoomRef.current = nextRoom;

    if (!nextRoom || !previousRoom || previousRoom.code !== nextRoom.code) return;
    if (previousRoom.version === nextRoom.version) return;

    const previousCardIds = new Set(
      previousRoom.players.flatMap((player) =>
        player.hands.flatMap((hand) => hand.cards.map((card) => card.id)),
      ),
    );
    const addedPlayerCards = nextRoom.players.reduce(
      (total, player) => total + player.hands.reduce(
        (handTotal, hand) =>
          handTotal + hand.cards.filter((card) => !previousCardIds.has(card.id)).length,
        0,
      ),
      0,
    );
    const addedDealerCards = Math.max(0, nextRoom.dealer.length - previousRoom.dealer.length);
    const dealSoundCount = addedPlayerCards + addedDealerCards;
    const holeRevealed = Boolean(
      previousRoom.dealer.length > 1 &&
      previousRoom.dealer[1] === null &&
      nextRoom.dealer[1],
    );
    const shuffled = nextRoom.shoeRemaining > previousRoom.shoeRemaining;
    const soundSpacing = ROOM_DEAL_DELAY;
    const openingDeal = previousRoom.phase === "betting" &&
      (nextRoom.phase === "playing" || nextRoom.mode === "breakout" && nextRoom.phase === "settled");
    const dealSoundStart = openingDeal ? ROOM_DEAL_DELAY : holeRevealed ? 160 : 0;

    if (shuffled) playCardSound("shuffle");
    const breakoutOpening = openingDeal && nextRoom.mode === "breakout";
    if (breakoutOpening) {
      const dealtPlayers = nextRoom.players.filter((player) => player.hands.length > 0);
      const openingCards = 2 * (dealtPlayers.length + 1);
      const playerExtraCards = Math.max(0, addedPlayerCards - 2 * dealtPlayers.length);
      const flipStep = openingCards + playerExtraCards + 2;
      for (let step = 1; step <= openingCards + playerExtraCards; step += 1) {
        window.setTimeout(() => playCardSound("deal"), step * soundSpacing);
      }
      window.setTimeout(() => playCardSound("flip"), flipStep * soundSpacing);
      for (let index = 0; index < Math.max(0, addedDealerCards - 2); index += 1) {
        window.setTimeout(() => playCardSound("deal"), (flipStep + 2 + index) * soundSpacing);
      }
    } else {
      if (holeRevealed) playCardSound("flip");
      for (let index = 0; index < dealSoundCount; index += 1) {
        window.setTimeout(() => playCardSound("deal"), dealSoundStart + index * soundSpacing);
      }
    }

    const previousPlayer = previousRoom.players.find(
      (player) => player.id === roomSession?.seatId,
    );
    const nextPlayer = nextRoom.players.find((player) => player.id === roomSession?.seatId);
    const previousResults = new Set(
      previousPlayer?.hands
        .filter((hand) => hand.result)
        .map((hand) => `${hand.cards.map((card) => card.id).join(",")}:${hand.result}`) ?? [],
    );
    const newResults = nextPlayer?.hands.filter(
      (hand) => hand.result &&
        !previousResults.has(`${hand.cards.map((card) => card.id).join(",")}:${hand.result}`),
    ) ?? [];
    const resultDelay = breakoutOpening
      ? (dealSoundCount + (addedDealerCards > 2 ? 3 : 2)) * soundSpacing + 650
      : dealSoundStart + dealSoundCount * soundSpacing + (nextRoom.mode === "breakout" ? 650 : 120);
    const previousWinningSideBets = new Set(
      previousPlayer?.sideBetResults.filter((outcome) => outcome.won)
        .map((outcome) => `${outcome.name}:${outcome.detail}:${outcome.profit}`) ?? [],
    );
    const winningSideBets = nextPlayer?.sideBetResults.filter((outcome) =>
      outcome.won && (nextRoom.round !== previousRoom.round ||
        !previousWinningSideBets.has(`${outcome.name}:${outcome.detail}:${outcome.profit}`)),
    ) ?? [];

    if (nextRoom.mode === "breakout") {
      if (newResults.some((hand) => hand.status === "won" && hand.result?.includes("BLACKJACK"))) {
        window.setTimeout(() => playCardSound("blackjack"), resultDelay);
      } else if (newResults.some((hand) => hand.status === "won")) {
        window.setTimeout(() => playCardSound("win"), resultDelay);
      } else if (newResults.some((hand) => hand.status === "lost")) {
        window.setTimeout(() => playCardSound("lose"), resultDelay);
      }
    } else if (newResults.some((hand) => hand.result === "BLACKJACK")) {
      window.setTimeout(() => playCardSound("blackjack"), resultDelay);
    } else if (newResults.some((hand) => ["WIN", "WIN ON 16", "DEALER BUST"].includes(hand.result ?? ""))) {
      window.setTimeout(() => playCardSound("win"), resultDelay);
    } else if (newResults.some((hand) => ["DEALER WINS", "DEALER BLACKJACK"].includes(hand.result ?? ""))) {
      const bankrollBusted = Boolean(
        nextPlayer &&
        nextRoom.phase === "settled" &&
        nextPlayer.bankroll < nextRoom.table.minimum,
      );
      if (!bankrollBusted) window.setTimeout(() => playCardSound("lose"), resultDelay);
    }
    if (winningSideBets.length) {
      const sideBetDelay = resultDelay + (newResults.some((hand) => hand.result === "BLACKJACK") ? 650 : 180);
      window.setTimeout(() => {
        if (previousRoomRef.current?.code !== nextRoom.code || previousRoomRef.current.round !== nextRoom.round) return;
        setSideBetCelebration({ id: Date.now(), outcomes: winningSideBets });
        playCardSound("sidebet");
      }, sideBetDelay);
    }
  }, [playCardSound, roomSession]);

  const showTableBust = useCallback((balance: number, minimum: number, resetAchievements = false) => {
    if (resetAchievements) {
      achievementQueueRef.current = [];
      previousAchievementBalanceRef.current = balance;
      setAchievementBanner(null);
      setUnlockedAchievements([]);
    }
    setTableBustNotice({ id: Date.now(), balance, minimum, phrase: resetAchievements ? bustPhrase() : null });
    playCardSound("tableBust");
  }, [playCardSound]);

  const playCardClick = useCallback(() => {
    playCardSound("click");
  }, [playCardSound]);

  useEffect(() => {
    if (!tableBustNotice) return;
    const timer = window.setTimeout(() => setTableBustNotice(null), 3300);
    return () => window.clearTimeout(timer);
  }, [tableBustNotice]);

  const dealerSequenceKey = game?.phase === "dealerTurn" ? game.round : null;

  useEffect(() => {
    if (dealerSequenceKey === null) return;
    const startingState = gameRef.current;
    if (!startingState || startingState.phase !== "dealerTurn") return;

    let cancelled = false;

    async function playDealerSequence() {
      playCardSound("flip");
      const dealerHoleCard = startingState!.dealer[1];
      if (dealerHoleCard && !startingState!.dealerHoleSeen) {
        setGame((current) =>
          current?.phase === "dealerTurn" && current.round === dealerSequenceKey
            ? {
                ...current,
                dealerHoleSeen: true,
                seenCardCounts: addSeenCards(current.seenCardCounts, [dealerHoleCard]),
              }
            : current,
        );
      }
      await pause(650);
      if (cancelled) return;

      const dealer = [...startingState!.dealer];
      const shoe = [...startingState!.shoe];
      const hasLiveHand = startingState!.hands.some(
        (hand) =>
          ["active", "standing"].includes(hand.status) &&
          scoreHand(hand.cards).total <= 21,
      );
      const resolveFinalSideBet = startingState!.mode === "doubleDownMadness" && startingState!.sideBets.dealerBust > 0 ||
        startingState!.mode === "doubleUp" && startingState!.sideBets.bonus16 > 0;

      while ((hasLiveHand || resolveFinalSideBet) &&
        (startingState!.mode === "doubleUp" ? doubleUpDealerShouldHit(dealer) : dealerShouldHit(dealer))) {
        await pause(540);
        if (cancelled) return;
        const dealtCard = draw(shoe);
        dealer.push(dealtCard);
        playCardSound("deal");
        setGame((current) =>
          current?.phase === "dealerTurn" && current.round === dealerSequenceKey
            ? {
                ...current,
                dealer: [...dealer],
                shoe: [...shoe],
                seenCardCounts: addSeenCards(current.seenCardCounts, [dealtCard]),
                message: "Dealer draws",
              }
            : current,
        );
      }

      await pause(520);
      if (cancelled) return;
      setGame((current) =>
        current?.phase === "dealerTurn" && current.round === dealerSequenceKey
          ? (() => {
              const settled = settleRound({ ...current, dealer: [...dealer], shoe: [...shoe] });
              if (settled.tone === "win") window.setTimeout(() => playCardSound("win"), 120);
              const winningSideBets = settled.roundSideBetOutcomes.filter((outcome) =>
                outcome.won && (outcome.name === SIDE_BET_LABELS.dealerBust.name ||
                  outcome.name === SIDE_BET_LABELS.bonus16.name));
              if (winningSideBets.length) window.setTimeout(() => {
                setSideBetCelebration({ id: Date.now(), outcomes: winningSideBets });
                playCardSound("sidebet");
              }, 450);
              return settled;
            })()
          : current,
      );
    }

    void playDealerSequence();
    return () => {
      cancelled = true;
    };
  }, [dealerSequenceKey, playCardSound]);

  const activeHand = game?.hands[game.activeHand];
  const canDouble = Boolean(
    game &&
      activeHand &&
      game.phase === "playing" &&
      (game.mode === "doubleDownMadness"
        ? activeHand.cards.length >= 1 && scoreHand(activeHand.cards).total < 21
        : activeHand.cards.length === 2) &&
      !(game.mode === "doubleUp" && activeHand.splitAces) &&
      (game.mode === "freeBet" && isFreeDouble(activeHand.cards) ||
        game.bankroll >= (activeHand.bet || activeHand.freeStake || game.currentBet)),
  );
  const canDoubleUp = Boolean(game && activeHand && game.mode === "doubleUp" && game.phase === "playing" &&
    activeHand.cards.length === 2 && (!isBlackjack(activeHand.cards) || activeHand.fromSplit) &&
    game.bankroll >= activeHand.bet);
  const splitPairAvailable = Boolean(
    game &&
      activeHand &&
      game.phase === "playing" &&
      game.hands.length < (game.mode === "doubleUp" ? 4 : MAX_SPLIT_HANDS) &&
      game.mode !== "doubleDownMadness" && !(game.mode === "doubleUp" && activeHand.splitAces) && canSplit(activeHand.cards),
  );
  const splitAvailable = Boolean(
    splitPairAvailable && game && activeHand &&
      (game.mode === "freeBet" && isFreeSplit(activeHand.cards) ||
        game.bankroll >= (activeHand.bet || activeHand.freeStake || game.currentBet)),
  );
  const surrenderAvailable = Boolean(
    game &&
      activeHand &&
      game.phase === "playing" &&
      activeHand.cards.length === 2 &&
      !activeHand.fromSplit && game.mode !== "doubleDownMadness" && game.mode !== "doubleUp",
  );
  const strategyAdvice = useMemo(() => {
    if (
      !game ||
      game.phase !== "playing" ||
      !activeHand ||
      !game.dealer[0]
    ) return null;
    if (game.mode === "doubleDownMadness") {
      return getDoubleDownMadnessStrategyAdvice(activeHand.cards, game.dealer[0], canDouble);
    }
    if (game.mode === "doubleUp") {
      return getDoubleUpStrategyAdvice(activeHand.cards, game.dealer[0], {
        allowDouble: canDouble,
        allowDoubleUp: canDoubleUp,
        allowSplit: splitAvailable,
        splitAces: activeHand.splitAces,
      });
    }
    if (game.mode === "freeBet") {
      return getFreeBetStrategyAdvice(activeHand.cards, game.dealer[0], {
        allowDouble: canDouble,
        allowSplit: splitAvailable,
        allowSurrender: surrenderAvailable,
        isFreeHand: activeHand.bet === 0 && Boolean(activeHand.freeStake),
      });
    }
    return getBasicStrategyAdvice(activeHand.cards, game.dealer[0], {
      allowDouble: game.mode === "classic" && activeHand.cards.length === 2,
      allowSplit: game.mode === "classic" && game.hands.length < MAX_SPLIT_HANDS && canSplit(activeHand.cards),
      allowSurrender: game.mode === "classic" && activeHand.cards.length === 2 && !activeHand.fromSplit,
    });
  }, [activeHand, canDouble, canDoubleUp, game, splitAvailable, surrenderAvailable]);
  const shoePercent = useMemo(
    () => (game ? Math.max(4, (game.shoe.length / SHOE_SIZE) * 100) : 100),
    [game],
  );
  const cutCardReached = Boolean(game && game.shoe.length <= game.cutPoint);
  const tableBusted = Boolean(game && game.bankroll < selectedTable.minimum);
  const handCountQueued = Boolean(
    game && game.phase !== "betting" && game.startingHandCount !== soloHandCount,
  );
  const roomPlayer = roomSession?.room.players.find(
    (player) => player.id === roomSession.seatId,
  );
  const roomBankroll = roomPlayer?.bankroll;
  useEffect(() => {
    if (!walletLoaded || roomBankroll === undefined) return;
    setWallet(roomBankroll);
    window.localStorage.setItem(WALLET_KEY, String(roomBankroll));
  }, [roomBankroll, walletLoaded]);
  const visibleRoomPlayer = roomPlayer && pendingRoomAction?.action === "bet" &&
    roomSession?.room.phase === "betting" && pendingRoomAction.round === roomSession.room.round && !roomPlayer.bet
    ? {
        ...roomPlayer,
        bet: pendingRoomAction.amount ?? 0,
        bankroll: roomPlayer.bankroll - (pendingRoomAction.amount ?? 0) - sideBetStake(pendingRoomAction.sideBets ?? EMPTY_SIDE_BETS),
      }
    : roomPlayer;
  const selectedDonationPlayer = roomSession?.room.players.find((player) => player.id === donationTarget);
  const selectDonationPlayer = useCallback((playerId: string) => {
    setRoomError("");
    setDonationAmount("");
    setDonationTarget(playerId);
  }, []);
  const roomOpponents = roomSession
    ? roomSession.room.players.filter((player) => player.id !== roomSession.seatId)
    : [];
  const roomDealtPlayers = roomSession?.room.players.filter((player) => player.hands.length > 0) ?? [];
  const roomDealIndex = new Map(roomDealtPlayers.map((player, index) => [player.id, index]));
  const roomExtraDealOffsets = new Map<string, number>();
  let roomExtraCardCount = 0;
  for (const player of roomDealtPlayers) {
    roomExtraDealOffsets.set(player.id, roomExtraCardCount);
    roomExtraCardCount += Math.max(0, (player.hands[0]?.cards.length ?? 2) - 2);
  }
  const leftRoomOpponents = roomOpponents.filter((_, index) => index % 2 === 0);
  const rightRoomOpponents = roomOpponents.filter((_, index) => index % 2 === 1);
  const roomActiveHand = roomPlayer?.hands[roomPlayer.activeHand];
  const isRoomHost = Boolean(roomSession && roomSession.room.hostId === roomSession.seatId);
  const isRoomTurn = Boolean(
    roomSession && roomSession.room.currentPlayerId === roomSession.seatId,
  );
  const roomDoubleAvailable = Boolean(roomSession && roomPlayer && roomActiveHand && isRoomTurn &&
    (roomSession.room.mode === "doubleDownMadness"
      ? roomActiveHand.cards.length >= 1 && scoreHand(roomActiveHand.cards).total < 21
      : roomActiveHand.cards.length === 2) &&
    !(roomSession.room.mode === "doubleUp" && roomActiveHand.splitAces) &&
    (roomSession.room.mode === "freeBet" && isFreeDouble(roomActiveHand.cards) ||
      roomPlayer.bankroll >= (roomActiveHand.bet || roomActiveHand.freeStake || roomPlayer.bet)));
  const roomDoubleUpAvailable = Boolean(roomSession && roomPlayer && roomActiveHand && isRoomTurn &&
    roomSession.room.mode === "doubleUp" && roomActiveHand.cards.length === 2 &&
    (!isBlackjack(roomActiveHand.cards) || roomActiveHand.fromSplit) && roomPlayer.bankroll >= roomActiveHand.bet);
  const roomSplitAvailable = Boolean(roomSession && roomPlayer && roomActiveHand && isRoomTurn &&
    roomSession.room.mode !== "doubleDownMadness" && !(roomSession.room.mode === "doubleUp" && roomActiveHand.splitAces) && canSplit(roomActiveHand.cards) &&
    roomPlayer.hands.length < (roomSession.room.mode === "doubleUp" ? 4 : MAX_SPLIT_HANDS) &&
    (roomSession.room.mode === "freeBet" && isFreeSplit(roomActiveHand.cards) ||
      roomPlayer.bankroll >= (roomActiveHand.bet || roomActiveHand.freeStake || roomPlayer.bet)));
  const roomSurrenderAvailable = Boolean(roomSession && roomPlayer && roomActiveHand && isRoomTurn &&
    roomSession.room.mode !== "doubleDownMadness" && roomSession.room.mode !== "doubleUp" && roomActiveHand.cards.length === 2 && roomPlayer.hands.length === 1);
  const roomStrategyAdvice = useMemo(() => {
    if (!roomSession || !roomActiveHand || !roomSession.room.dealer[0] || !isRoomTurn) return null;
    const upCard = roomSession.room.dealer[0];
    if (roomSession.room.mode === "doubleDownMadness") {
      return getDoubleDownMadnessStrategyAdvice(roomActiveHand.cards, upCard, roomDoubleAvailable);
    }
    if (roomSession.room.mode === "doubleUp") {
      return getDoubleUpStrategyAdvice(roomActiveHand.cards, upCard, {
        allowDouble: roomDoubleAvailable,
        allowDoubleUp: roomDoubleUpAvailable,
        allowSplit: roomSplitAvailable,
        splitAces: roomActiveHand.splitAces,
      });
    }
    if (roomSession.room.mode === "freeBet") {
      return getFreeBetStrategyAdvice(roomActiveHand.cards, upCard, {
        allowDouble: roomDoubleAvailable,
        allowSplit: roomSplitAvailable,
        allowSurrender: roomSurrenderAvailable,
        isFreeHand: roomActiveHand.bet === 0 && Boolean(roomActiveHand.freeStake),
      });
    }
    return getBasicStrategyAdvice(roomActiveHand.cards, upCard, {
      allowDouble: roomDoubleAvailable,
      allowSplit: roomSplitAvailable,
      allowSurrender: roomSurrenderAvailable,
    });
  }, [isRoomTurn, roomActiveHand, roomDoubleAvailable, roomDoubleUpAvailable, roomSession, roomSplitAvailable, roomSurrenderAvailable]);
  const roomPlayerCanBet = Boolean(
    roomSession && roomPlayer && roomPlayer.bankroll >= roomSession.room.table.minimum,
  );
  const achievementBalance = roomPlayer?.bankroll ?? game?.bankroll ?? wallet;
  const achievementSource = roomPlayer
    ? `room:${roomSession?.code}:${roomPlayer.id}`
    : game
      ? "solo"
      : "wallet";
  const completedTableBustKey = game?.phase === "settled" ? `solo:${game.round}` : null;
  const completedTableBalance = roomPlayer?.bankroll ?? game?.bankroll ?? wallet;
  const completedTableMinimum = roomSession?.room.table.minimum ?? selectedTable.minimum;

  useEffect(() => {
    const isRoomRound = roomSession?.room.phase === "settled";
    const isSoloRound = !roomSession && game?.phase === "settled";
    if (!isRoomRound && !isSoloRound) return;

    const hands = isRoomRound ? roomPlayer?.hands : game?.hands;
    if (!hands?.length) return;
    const roundKey = isRoomRound
      ? `room:${roomSession!.code}:${roomSession!.seatId}:${roomSession!.room.round}`
      : `solo:${analyticsSessionIdRef.current}:${game!.round}`;
    if (trackedRoundsRef.current.has(roundKey)) return;
    trackedRoundsRef.current.add(roundKey);

    const totals = roundTokenTotals(
      hands,
      isRoomRound ? roomPlayer?.sideBetResults ?? [] : game?.roundSideBetOutcomes ?? [],
    );
    sendGAEvent("event", "blackjack_round_settled", {
      ...totals,
      game_mode: isRoomRound ? roomSession!.room.mode : game!.mode,
      play_context: isRoomRound ? "multiplayer" : "solo",
      token_unit: "practice_tokens",
    });
  }, [game, roomPlayer, roomSession]);

  useEffect(() => {
    if (!walletLoaded || !achievementsLoaded) return;

    if (previousAchievementSourceRef.current !== achievementSource) {
      previousAchievementSourceRef.current = achievementSource;
      previousAchievementBalanceRef.current = achievementBalance;
      return;
    }

    const previousBalance = previousAchievementBalanceRef.current;
    previousAchievementBalanceRef.current = achievementBalance;
    if (previousBalance === null || achievementBalance <= previousBalance) return;

    const newlyUnlocked = ACHIEVEMENT_THRESHOLDS.filter(
      (threshold) =>
        previousBalance < threshold &&
        achievementBalance >= threshold &&
        !unlockedAchievements.includes(threshold),
    );
    if (!newlyUnlocked.length) return;

    setUnlockedAchievements((current) =>
      [...new Set([...current, ...newlyUnlocked])].sort((left, right) => left - right),
    );
    achievementQueueRef.current.push(...newlyUnlocked);
    if (achievementBanner === null) {
      const nextAchievement = achievementQueueRef.current.shift() ?? null;
      setAchievementBanner(nextAchievement);
      if (nextAchievement !== null) playCardSound("achievement");
    }
  }, [
    achievementBalance,
    achievementBanner,
    achievementSource,
    achievementsLoaded,
    playCardSound,
    unlockedAchievements,
    walletLoaded,
  ]);

  useEffect(() => {
    if (achievementBanner === null) return;
    const timer = window.setTimeout(() => {
      const nextAchievement = achievementQueueRef.current.shift() ?? null;
      setAchievementBanner(nextAchievement);
      if (nextAchievement !== null) playCardSound("achievement");
    }, 3800);
    return () => window.clearTimeout(timer);
  }, [achievementBanner, playCardSound]);

  useEffect(() => {
    if (!completedTableBustKey || lastTableBustRoundRef.current === completedTableBustKey) return;
    lastTableBustRoundRef.current = completedTableBustKey;
    if (completedTableBalance >= completedTableMinimum) return;
    const timer = window.setTimeout(() => {
      showTableBust(completedTableBalance, completedTableMinimum, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    completedTableBalance,
    completedTableBustKey,
    completedTableMinimum,
    showTableBust,
  ]);

  useEffect(() => {
    if (!roomSession || !roomPlayer) {
      roomBustTrackerRef.current = null;
      return;
    }
    const source = `${roomSession.code}:${roomPlayer.id}`;
    if (roomBustTrackerRef.current?.source !== source) {
      roomBustTrackerRef.current = {
        source,
        announced: roomPlayer.bankroll < roomSession.room.table.minimum &&
          (roomSession.room.phase === "settled" || roomPlayer.hands.some((hand) => hand.result === "BUST")),
      };
      return;
    }
    const tracker = roomBustTrackerRef.current;
    const minimum = roomSession.room.table.minimum;
    if (roomPlayer.bankroll >= minimum) {
      tracker.announced = false;
      return;
    }
    if (tracker.announced) return;
    const hasBustedHand = roomPlayer.hands.some((hand) => hand.status === "busted" || hand.result === "BUST");
    const couldStillPay = roomPlayer.hands.some((hand) => ["active", "standing"].includes(hand.status));
    if ((hasBustedHand && !couldStillPay) || (roomSession.room.phase === "settled" && roomPlayer.hands.length > 0)) {
      tracker.announced = true;
      window.setTimeout(() => showTableBust(roomPlayer.bankroll, minimum, true), 0);
    }
  }, [roomPlayer, roomSession, showTableBust]);

  function selectSoloHandCount(handCount: SoloHandCount) {
    playCardSound("click");
    soloHandCountRef.current = handCount;
    setSoloHandCount(handCount);
    window.localStorage.setItem(SOLO_HAND_COUNT_KEY, String(handCount));
    setGame((current) => {
      if (!current || current.phase !== "betting") return current;
      const maximumPerHand = Math.floor(current.bankroll / handCount);
      const affordableBet =
        Math.floor(maximumPerHand / selectedTable.minimum) * selectedTable.minimum;
      const currentBet = Math.min(current.currentBet, affordableBet);
      const sideBets = totalOpeningStake(currentBet, current.sideBets, handCount) <= current.bankroll
        ? current.sideBets
        : { ...EMPTY_SIDE_BETS };
      return { ...current, startingHandCount: handCount, currentBet, sideBets };
    });
  }

  function startSession() {
    const requiredMinimum = selectedTable.minimum * soloHandCount;
    if (wallet < requiredMinimum) {
      if (wallet < selectedTable.minimum) showTableBust(wallet, selectedTable.minimum);
      setHomeNotice(
        `${soloHandCount} hands at ${selectedTable.name} require ${tokenAmount(requiredMinimum)} tokens. Your balance is ${tokenAmount(wallet)}.`,
      );
      return;
    }
    playCardSound("entry");
    setHomeNotice("");
    const startingBalance = wallet;
    const freshShoe = createBurnedShoe(DECK_COUNT);
    analyticsSessionIdRef.current += 1;
    setGame({
      bankroll: startingBalance,
      startingBankroll: startingBalance,
      currentBet: selectedTable.minimum,
      sideBets: { ...EMPTY_SIDE_BETS },
      roundSideBetOutcomes: [],
      seenCardCounts: addSeenCards(emptySeenCardCounts(), [freshShoe.burnedCard]),
      dealerHoleSeen: false,
      shoe: freshShoe.shoe,
      burnedCard: freshShoe.burnedCard,
      shoeSerial: 1,
      cutPoint: createCutPoint(),
      dealer: [],
      hands: [],
      startingHandCount: soloHandCount,
      activeHand: 0,
      phase: "betting",
      message: "Place your bet",
      tone: "neutral",
      round: 1,
      mode: selectedMode,
      breakoutBet: "player",
    });
  }

  function changeBet(amount: number) {
    if (amount > 0) playCardSound("chip");
    setGame((current) => {
      if (!current || current.phase !== "betting") return current;
      const nextBet = current.currentBet + amount;
      if (
        totalOpeningStake(nextBet, current.sideBets, current.startingHandCount) > current.bankroll ||
        nextBet < 0
      ) return current;
      return { ...current, currentBet: nextBet };
    });
  }

  function cycleSideBet(key: SideBetKey) {
    if (game?.phase === "betting") {
      const currentValue = game.sideBets[key];
      const nextValue = sideBetValues[(sideBetValues.indexOf(currentValue) + 1) % sideBetValues.length];
      const previewBets = { ...game.sideBets, [key]: nextValue };
      if (
        nextValue > currentValue &&
        totalOpeningStake(game.currentBet, previewBets, game.startingHandCount) <= game.bankroll
      ) {
        playCardSound("chip");
      }
    }
    setGame((current) => {
      if (!current || current.phase !== "betting") return current;
      const valueIndex = sideBetValues.indexOf(current.sideBets[key]);
      const nextValue = sideBetValues[(valueIndex + 1) % sideBetValues.length];
      const sideBets = { ...current.sideBets, [key]: nextValue };
      if (totalOpeningStake(current.currentBet, sideBets, current.startingHandCount) > current.bankroll) return current;
      return { ...current, sideBets };
    });
  }

  async function dealRound() {
    const current = game;
    const handCount = current?.startingHandCount ?? 1;
    if (
      burnRevealActive ||
      !current ||
      current.phase !== "betting" ||
      current.currentBet < selectedTable.minimum ||
      totalOpeningStake(current.currentBet, current.sideBets, handCount) > current.bankroll
    ) {
      return;
    }

    if (soundEnabledRef.current) {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      if (context.state === "suspended") void context.resume();
    }

    const emergencyShuffle = current.shoe.length < (current.mode === "breakout" ? handCount * 10 + 12 : handCount * 2 + 2);
    const freshShoe = emergencyShuffle ? createBurnedShoe(DECK_COUNT) : null;
    const shoe = freshShoe ? freshShoe.shoe : [...current.shoe];
    const playerCards: CardType[][] = Array.from({ length: handCount }, () => []);
    const dealerCards: CardType[] = [];
    const dealSteps: Array<{
      recipient: "player" | "dealer";
      card: CardType;
      visible: boolean;
      handIndex?: number;
    }> = [];

    for (let pass = 0; pass < (current.mode === "doubleDownMadness" ? 1 : 2); pass += 1) {
      for (let handIndex = 0; handIndex < handCount; handIndex += 1) {
        const card = draw(shoe);
        playerCards[handIndex].push(card);
        dealSteps.push({ recipient: "player", card, visible: true, handIndex });
      }
      const dealerCard = draw(shoe);
      dealerCards.push(dealerCard);
      dealSteps.push({
        recipient: "dealer",
        card: dealerCard,
        visible: pass === 0,
      });
    }
    if (current.mode === "doubleDownMadness") {
      const holeCard = draw(shoe);
      dealerCards.push(holeCard);
      dealSteps.push({ recipient: "dealer", card: holeCard, visible: false });
    }

    const bet = current.currentBet;
    const openingStake = totalOpeningStake(bet, current.sideBets, handCount);
    const sideBetResults = playerCards.map((cards) =>
      current.mode === "doubleDownMadness" || current.mode === "breakout" || current.mode === "doubleUp"
        ? { payout: 0, outcomes: [] as SideBetOutcome[] }
        : settleSideBets(cards, dealerCards[0], current.sideBets),
    );
    const sideBetPayout = sideBetResults.reduce((total, result) => total + result.payout, 0);
    const roundSideBetOutcomes = sideBetResults.flatMap((result) => result.outcomes);
    const dealRoundNumber = current.round;

    setGame({
      ...current,
      bankroll: current.bankroll - openingStake,
      roundSideBetOutcomes,
      dealer: [],
      shoe,
      burnedCard: freshShoe?.burnedCard ?? current.burnedCard,
      shoeSerial: current.shoeSerial + (freshShoe ? 1 : 0),
      seenCardCounts: freshShoe
        ? addSeenCards(emptySeenCardCounts(), [freshShoe.burnedCard])
        : current.seenCardCounts,
      dealerHoleSeen: false,
      hands: Array.from({ length: handCount }, () => ({
        cards: [],
        bet,
        status: "active" as const,
        fromSplit: false,
      })),
      activeHand: 0,
      phase: "dealing",
      message: "Cards coming out",
      tone: "neutral",
    });

    for (const step of dealSteps) {
      await pause(DEAL_DELAY);
      const liveState = gameRef.current;
      if (!liveState || liveState.phase !== "dealing" || liveState.round !== dealRoundNumber) return;
      playCardSound("deal");
      setGame((latest) => {
        if (!latest || latest.phase !== "dealing" || latest.round !== dealRoundNumber) return latest;
        return step.recipient === "player" && step.handIndex !== undefined
          ? {
              ...latest,
              seenCardCounts: addSeenCards(latest.seenCardCounts, [step.card]),
              hands: latest.hands.map((hand, index) =>
                index === step.handIndex
                  ? { ...hand, cards: [...hand.cards, step.card] }
                  : hand,
              ),
            }
          : {
              ...latest,
              dealer: [...latest.dealer, step.card],
              seenCardCounts: step.visible
                ? addSeenCards(latest.seenCardCounts, [step.card])
                : latest.seenCardCounts,
            };
      });
    }

    if (current.mode === "breakout") {
      const breakoutShoe = [...shoe];
      const dealerNatural = isBlackjack(dealerCards);
      if (!dealerNatural) {
        for (let handIndex = 0; handIndex < handCount; handIndex += 1) {
          if (isBlackjack(playerCards[handIndex])) continue;
          while (dealerShouldHit(playerCards[handIndex])) {
            await pause(DEAL_DELAY);
            const liveState = gameRef.current;
            if (!liveState || liveState.phase !== "dealing" || liveState.round !== dealRoundNumber) return;
            const card = draw(breakoutShoe);
            playerCards[handIndex].push(card);
            playCardSound("deal");
            setGame((latest) => latest && latest.phase === "dealing" && latest.round === dealRoundNumber
              ? { ...latest, shoe: [...breakoutShoe], seenCardCounts: addSeenCards(latest.seenCardCounts, [card]),
                  hands: latest.hands.map((hand, index) => index === handIndex
                    ? { ...hand, cards: [...hand.cards, card] } : hand), message: "Breakout plays the player hand" }
              : latest);
          }
        }
      }

      await pause(DEAL_DELAY);
      if (gameRef.current?.phase !== "dealing" || gameRef.current.round !== dealRoundNumber) return;
      playCardSound("flip");
      setGame((latest) => latest && latest.phase === "dealing" && latest.round === dealRoundNumber
        ? { ...latest, dealerHoleSeen: true, seenCardCounts: addSeenCards(latest.seenCardCounts, [dealerCards[1]]), message: "Dealer plays out the hand" }
        : latest);

      if (!dealerNatural && playerCards.some((cards) => !isBlackjack(cards))) {
        while (dealerShouldHit(dealerCards)) {
          await pause(dealerCards.length === 2 ? 600 : DEAL_DELAY);
          const liveState = gameRef.current;
          if (!liveState || liveState.phase !== "dealing" || liveState.round !== dealRoundNumber) return;
          const card = draw(breakoutShoe);
          dealerCards.push(card);
          playCardSound("deal");
          setGame((latest) => latest && latest.phase === "dealing" && latest.round === dealRoundNumber
            ? { ...latest, dealer: [...latest.dealer, card], shoe: [...breakoutShoe],
                seenCardCounts: addSeenCards(latest.seenCardCounts, [card]) }
            : latest);
        }
      }

      await pause(280);
      if (gameRef.current?.phase !== "dealing" || gameRef.current.round !== dealRoundNumber) return;
      const netProfit = playerCards.reduce((total, cards) => total +
        settleBreakoutBet(cards, dealerCards, current.breakoutBet, bet).profit, 0);
      const breakoutSideBetWins = playerCards.flatMap((cards, handIndex) =>
        settleFinalSideBets(cards, dealerCards, current.sideBets).outcomes
          .filter((outcome) => outcome.won)
          .map((outcome) => ({ ...outcome,
            name: handCount > 1 ? `Hand ${handIndex + 1} · ${outcome.name}` : outcome.name })),
      );
      setGame((latest) => latest && latest.phase === "dealing" && latest.round === dealRoundNumber
        ? settleBreakoutRound({ ...latest, dealer: [...dealerCards], shoe: [...breakoutShoe],
            hands: playerCards.map((cards) => ({ cards: [...cards], bet, status: "standing" as const })),
            dealerHoleSeen: true, roundSideBetOutcomes: [] })
        : latest);
      if (netProfit > 0) playCardSound(playerCards.some(isBlackjack) ? "blackjack" : "win");
      else if (netProfit < 0) playCardSound("lose");
      if (breakoutSideBetWins.length) window.setTimeout(() => {
        setSideBetCelebration({ id: Date.now(), outcomes: breakoutSideBetWins });
        playCardSound("sidebet");
      }, 450);
      return;
    }

    await pause(360);
    const naturalHands = playerCards.map((cards) => isBlackjack(cards));
    const naturalCount = naturalHands.filter(Boolean).length;
    const dealerNatural = isBlackjack(dealerCards);
    const winningSideBets = sideBetResults.flatMap((result, handIndex) =>
      result.outcomes
        .filter((outcome) => outcome.won)
        .map((outcome) => ({
          ...outcome,
          name: handCount > 1 ? `Hand ${handIndex + 1} · ${outcome.name}` : outcome.name,
        })),
    );
    if (winningSideBets.length) {
      setSideBetCelebration({ id: dealRoundNumber, outcomes: winningSideBets });
    }
    if (dealerNatural || naturalCount === handCount) playCardSound("flip");
    if (naturalCount > 0 && !dealerNatural) {
      window.setTimeout(() => playCardSound("blackjack"), 180);
    }
    if (winningSideBets.length) {
      window.setTimeout(
        () => playCardSound("sidebet"),
        naturalCount > 0 && !dealerNatural ? 650 : 180,
      );
    }

    setGame((latest) => {
      if (!latest || latest.phase !== "dealing" || latest.round !== dealRoundNumber) return latest;

      if (latest.mode === "doubleDownMadness") {
        if (dealerNatural) {
          return {
            ...latest,
            roundSideBetOutcomes: playerCards.flatMap((cards) =>
              settleFinalSideBets(cards, dealerCards, latest.sideBets).outcomes),
            hands: playerCards.map((cards) => ({ cards, bet, status: "lost" as const, result: "DEALER BLACKJACK" })),
            dealer: dealerCards,
            dealerHoleSeen: true,
            seenCardCounts: addSeenCards(latest.seenCardCounts, [dealerCards[1]]),
            phase: "settled",
            message: "Dealer blackjack",
            tone: "loss",
          };
        }
        return {
          ...latest,
          hands: playerCards.map((cards) => ({ cards, bet, status: "active" as const })),
          dealer: dealerCards,
          phase: "playing",
          message: "One card to start — hit or double",
        };
      }

      if (dealerNatural) {
        const naturalPushPayout = naturalCount * bet;
        const finalSideBets = latest.mode === "doubleUp"
          ? playerCards.map((cards) => settleFinalSideBets(cards, dealerCards, latest.sideBets)) : [];
        return {
          ...latest,
          bankroll: latest.bankroll + sideBetPayout + naturalPushPayout + finalSideBets.reduce((sum, result) => sum + result.payout, 0),
          roundSideBetOutcomes: [...latest.roundSideBetOutcomes, ...finalSideBets.flatMap((result) => result.outcomes)],
          dealer: dealerCards,
          dealerHoleSeen: true,
          seenCardCounts: addSeenCards(latest.seenCardCounts, [dealerCards[1]]),
          hands: playerCards.map((cards, index) => ({
            cards,
            bet,
            fromSplit: false,
            status: naturalHands[index] ? ("push" as const) : ("lost" as const),
            result: naturalHands[index] ? "PUSH" : "DEALER BLACKJACK",
          })),
          phase: "settled",
          message: naturalCount === handCount
            ? "Dealer blackjack — naturals push"
            : "Dealer has blackjack",
          tone: naturalCount === handCount ? "neutral" : "loss",
        };
      }

      const naturalPayout = naturalCount * bet * 2.5;
      const hands: PlayerHand[] = playerCards.map((cards, index) => ({
        cards,
        bet,
        fromSplit: false,
        status: naturalHands[index] ? "won" : "active",
        result: naturalHands[index] ? "BLACKJACK" : undefined,
      }));
      const firstActiveHand = hands.findIndex((hand) => hand.status === "active");
      const roundComplete = firstActiveHand === -1;
      const needsBonus16Dealer = roundComplete && latest.mode === "doubleUp" && latest.sideBets.bonus16 > 0;
      return {
        ...latest,
        bankroll: latest.bankroll + sideBetPayout + naturalPayout,
        dealer: dealerCards,
        dealerHoleSeen: roundComplete && !needsBonus16Dealer,
        seenCardCounts: roundComplete && !needsBonus16Dealer
          ? addSeenCards(latest.seenCardCounts, [dealerCards[1]])
          : latest.seenCardCounts,
        hands,
        activeHand: roundComplete ? 0 : firstActiveHand,
        phase: roundComplete ? needsBonus16Dealer ? "dealerTurn" : "settled" : "playing",
        message: roundComplete
          ? needsBonus16Dealer ? "Blackjack paid — dealer plays for Bonus 16"
            : naturalCount > 1
            ? `${naturalCount} blackjacks pay 3 to 2`
            : "Blackjack pays 3 to 2"
          : naturalCount > 0
            ? `Blackjack paid — playing hand ${firstActiveHand + 1}`
            : handCount > 1
              ? "Playing hand 1"
              : "Your move",
        tone: roundComplete ? "win" : "neutral",
      };
    });
  }

  function hit() {
    if (game?.mode === "doubleUp" && game.hands[game.activeHand]?.splitAces) return;
    playCardSound("deal");
    setGame((current) => {
      if (!current || current.phase !== "playing" || current.mode === "doubleUp" && current.hands[current.activeHand]?.splitAces) return current;
      const shoe = [...current.shoe];
      const dealtCard = draw(shoe);
      const hands = current.hands.map((hand, index) =>
        index === current.activeHand
          ? { ...hand, cards: [...hand.cards, dealtCard] }
          : hand,
      );
      const total = scoreHand(hands[current.activeHand].cards).total;
      const singleAceDraw = current.mode === "doubleDownMadness" && current.hands[current.activeHand].cards.length === 1 && current.hands[current.activeHand].cards[0].rank === "A";
      const madnessNatural = current.mode === "doubleDownMadness" &&
        hands[current.activeHand].cards.length === 2 && isBlackjack(hands[current.activeHand].cards);
      const next = {
        ...current,
        shoe,
        seenCardCounts: addSeenCards(current.seenCardCounts, [dealtCard]),
        hands: hands.map((hand, index) =>
          index === current.activeHand && (total >= 21 || madnessNatural || singleAceDraw)
            ? {
                ...hand,
                status: total > 21 ? ("busted" as const) : madnessNatural ? ("won" as const) : ("standing" as const),
                result: total > 21 ? "BUST" : madnessNatural ? "BLACKJACK" : hand.result,
              }
            : hand,
        ),
        bankroll: current.bankroll + (madnessNatural ? current.hands[current.activeHand].bet * 2.5 : 0),
        message: total > 21 ? bustPhrase() : madnessNatural ? "Blackjack pays 3 to 2" : singleAceDraw ? "Single ace draws once" : total === 21 ? "Twenty-one" : "Your move",
        tone: total > 21 ? ("loss" as const) : ("neutral" as const),
      };

      return total >= 21 || madnessNatural || singleAceDraw ? advanceOrSettle(next) : next;
    });
  }

  function stand() {
    setGame((current) => {
      if (!current || current.phase !== "playing") return current;
      const hands = current.hands.map((hand, index) =>
        index === current.activeHand ? { ...hand, status: "standing" as const } : hand,
      );
      return advanceOrSettle({ ...current, hands });
    });
  }

  function doubleUp() {
    if (!canDoubleUp) return;
    playCardSound("chip");
    setGame((current) => {
      if (!current || current.mode !== "doubleUp" || current.phase !== "playing") return current;
      const hand = current.hands[current.activeHand];
      if (!hand || hand.cards.length !== 2 || isBlackjack(hand.cards) && !hand.fromSplit || current.bankroll < hand.bet) return current;
      const hands = current.hands.map((candidate, index) => index === current.activeHand
        ? { ...candidate, doubleUpStake: candidate.bet, status: "standing" as const } : candidate);
      return advanceOrSettle({ ...current, bankroll: current.bankroll - hand.bet, hands,
        message: "Double Up placed — standing on this hand" });
    });
  }

  function doubleDown() {
    if (canDouble) playCardSound("deal");
    setGame((current) => {
      if (!current || current.phase !== "playing") return current;
      const hand = current.hands[current.activeHand];
      const freeDouble = current.mode === "freeBet" && isFreeDouble(hand.cards);
      const paidDoubleStake = hand.bet || hand.freeStake || current.currentBet;
      if (
        (current.mode === "doubleDownMadness"
          ? hand.cards.length < 1 || scoreHand(hand.cards).total >= 21
          : hand.cards.length !== 2) ||
        current.mode === "doubleUp" && hand.splitAces ||
        (!freeDouble && current.bankroll < paidDoubleStake)
      ) return current;

      const shoe = [...current.shoe];
      const dealtCard = draw(shoe);
      const hands = current.hands.map((candidate, index) => {
        if (index !== current.activeHand) return candidate;
        const cards = [...candidate.cards, dealtCard];
        const busted = scoreHand(cards).total > 21;
        const madnessNatural = current.mode === "doubleDownMadness" && cards.length === 2 && isBlackjack(cards);
        const singleAceDraw = current.mode === "doubleDownMadness" && candidate.cards.length === 1 && candidate.cards[0].rank === "A";
        return {
          ...candidate,
          cards,
          bet: freeDouble ? candidate.bet : candidate.bet + paidDoubleStake,
          freeStake: (candidate.freeStake ?? 0) + (freeDouble ? candidate.bet || candidate.freeStake || current.currentBet : 0),
          status: busted ? ("busted" as const) : madnessNatural ? ("won" as const) : current.mode === "doubleDownMadness" && !singleAceDraw ? ("active" as const) : ("standing" as const),
          result: busted ? "BUST" : madnessNatural ? "BLACKJACK" : candidate.result,
        };
      });
      const next = {
        ...current,
        bankroll: current.bankroll - (freeDouble ? 0 : paidDoubleStake) + (hands[current.activeHand].result === "BLACKJACK" ? hands[current.activeHand].bet * 2.5 : 0),
        shoe,
        seenCardCounts: addSeenCards(current.seenCardCounts, [dealtCard]),
        hands,
        message: hands[current.activeHand].result === "BUST" ? bustPhrase() : "Your move",
      };
      return hands[current.activeHand].status === "active" ? next : advanceOrSettle(next);
    });
  }

  function splitHand() {
    if (splitAvailable) {
      playCardSound("deal");
      window.setTimeout(() => playCardSound("deal"), 150);
    }
    setGame((current) => {
      if (!current || current.phase !== "playing") return current;
      const original = current.hands[current.activeHand];
      if (
        current.mode === "doubleDownMadness" ||
        current.mode === "doubleUp" && original.splitAces ||
        current.hands.length >= (current.mode === "doubleUp" ? 4 : MAX_SPLIT_HANDS) ||
        !canSplit(original.cards)
      ) {
        return current;
      }
      const freeSplit = current.mode === "freeBet" && isFreeSplit(original.cards);
      const splitStake = original.bet || original.freeStake || current.currentBet;
      if (!freeSplit && current.bankroll < splitStake) {
        return {
          ...current,
          message: `A split needs ${tokenAmount(splitStake)} more tokens`,
          tone: "neutral",
        };
      }

      const shoe = [...current.shoe];
      const firstDealtCard = draw(shoe);
      const secondDealtCard = draw(shoe);
      const firstCards = [original.cards[0], firstDealtCard];
      const secondCards = [original.cards[1], secondDealtCard];
      const splitAces = original.cards[0].rank === "A";
      const splitHands: PlayerHand[] = [firstCards, secondCards].map((cards, index) => ({
        cards,
        bet: index === 1 ? (freeSplit ? 0 : splitStake) : original.bet,
        freeStake: index === 1 && freeSplit ? splitStake : original.freeStake,
        fromSplit: true,
        splitAces: current.mode === "doubleUp" && splitAces,
        status:
          current.mode === "doubleUp" && splitAces ? ("active" as const) :
          splitAces || scoreHand(cards).total === 21
            ? ("standing" as const)
            : ("active" as const),
      }));
      const splitIndex = current.activeHand;
      const hands = [
        ...current.hands.slice(0, splitIndex),
        ...splitHands,
        ...current.hands.slice(splitIndex + 1),
      ];
      const firstActiveSplit = splitHands.findIndex((hand) => hand.status === "active");
      const nextActiveHand =
        firstActiveSplit === -1 ? splitIndex : splitIndex + firstActiveSplit;
      const next = {
        ...current,
        bankroll: current.bankroll - (freeSplit ? 0 : splitStake),
        shoe,
        seenCardCounts: addSeenCards(current.seenCardCounts, [firstDealtCard, secondDealtCard]),
        hands,
        activeHand: nextActiveHand,
        message: splitAces
          ? "Split aces receive one card each"
          : `Playing hand ${nextActiveHand + 1}`,
        tone: "neutral" as const,
      };

      return firstActiveSplit === -1 ? advanceOrSettle(next) : next;
    });
  }

  function surrender() {
    if (surrenderAvailable) playCardSound("flip");
    setGame((current) => {
      if (!current || current.phase !== "playing") return current;
      const hand = current.hands[current.activeHand];
      if (!hand || current.mode === "doubleDownMadness" || current.mode === "doubleUp" || hand.cards.length !== 2 || hand.fromSplit) return current;
      const hands = current.hands.map((candidate, index) =>
        index === current.activeHand
          ? { ...candidate, status: "surrendered" as const, result: "SURRENDER" }
          : candidate,
      );
      return advanceOrSettle({
        ...current,
        bankroll: current.bankroll + Math.floor(hand.bet / 2),
        hands,
        message: "Late surrender — moving to the next hand",
        tone: "neutral",
      });
    });
  }

  async function nextRound() {
    const roundState = game;
    if (roundState && roundState.shoe.length <= roundState.cutPoint) {
      playCardSound("shuffle");
      setGame({
        ...roundState,
        dealer: [],
        hands: [],
        phase: "shuffling",
        message: `Cut card reached — shuffling ${DECK_COUNT} decks`,
        tone: "neutral",
      });
      await pause(1400);
      setGame((current) => {
        if (!current || current.phase !== "shuffling" || current.round !== roundState.round) {
          return current;
        }
        const nextHandCount = soloHandCountRef.current;
        const freshShoe = createBurnedShoe(DECK_COUNT);
        const affordableBet = Math.floor(
          current.bankroll / nextHandCount / selectedTable.minimum,
        ) * selectedTable.minimum;
        return {
          ...current,
          currentBet: Math.min(current.currentBet, affordableBet),
          startingHandCount: nextHandCount,
          sideBets: { ...EMPTY_SIDE_BETS },
          seenCardCounts: addSeenCards(emptySeenCardCounts(), [freshShoe.burnedCard]),
          dealerHoleSeen: false,
          shoe: freshShoe.shoe,
          burnedCard: freshShoe.burnedCard,
          shoeSerial: current.shoeSerial + 1,
          cutPoint: createCutPoint(),
          phase: "betting",
          message:
            current.bankroll >= selectedTable.minimum * nextHandCount
              ? "Fresh shoe — place your bet"
              : current.bankroll >= selectedTable.minimum
                ? `Not enough for ${nextHandCount} hands — change settings`
                : "You’re below this table’s minimum",
          round: current.round + 1,
        };
      });
      return;
    }

    setGame((current) => {
      if (!current) return current;
      const nextHandCount = soloHandCountRef.current;
      const affordableBet = Math.floor(
        current.bankroll / nextHandCount / selectedTable.minimum,
      ) * selectedTable.minimum;
      const currentBet = Math.min(current.currentBet, affordableBet);
      const sideBets =
        totalOpeningStake(currentBet, current.sideBets, nextHandCount) <= current.bankroll
          ? current.sideBets
          : { ...EMPTY_SIDE_BETS };
      return {
        ...current,
        currentBet,
        sideBets,
        startingHandCount: nextHandCount,
        dealer: [],
        dealerHoleSeen: false,
        hands: [],
        activeHand: 0,
        phase: "betting",
        message:
          current.bankroll >= selectedTable.minimum * nextHandCount
            ? "Place your bet"
            : current.bankroll >= selectedTable.minimum
              ? `Not enough for ${nextHandCount} hands — change settings`
              : "You’re below this table’s minimum",
        tone: "neutral",
        round: current.round + 1,
      };
    });
  }

  function resetTableBankroll() {
    setWallet(RESET_BALANCE);
    window.localStorage.setItem(WALLET_KEY, String(RESET_BALANCE));
    setGame((current) => {
      if (!current) return current;
      const needsFreshShoe = current.shoe.length <= current.cutPoint;
      const freshShoe = needsFreshShoe ? createBurnedShoe(DECK_COUNT) : null;
      if (needsFreshShoe) playCardSound("shuffle");
      return {
        ...current,
        bankroll: RESET_BALANCE,
        startingBankroll: RESET_BALANCE,
        currentBet: selectedTable.minimum,
        sideBets: { ...EMPTY_SIDE_BETS },
        seenCardCounts: freshShoe
          ? addSeenCards(emptySeenCardCounts(), [freshShoe.burnedCard])
          : current.seenCardCounts,
        dealerHoleSeen: false,
        shoe: freshShoe?.shoe ?? current.shoe,
        burnedCard: freshShoe?.burnedCard ?? current.burnedCard,
        shoeSerial: current.shoeSerial + (freshShoe ? 1 : 0),
        cutPoint: needsFreshShoe ? createCutPoint() : current.cutPoint,
        dealer: [],
        hands: [],
        startingHandCount: soloHandCountRef.current,
        activeHand: 0,
        phase: "betting",
        message: "Bankroll reset — place your bet",
        tone: "neutral",
        round: current.phase === "settled" ? current.round + 1 : current.round,
      };
    });
  }

  function confirmTokenReset() {
    playCardSound("click");
    resetTableBankroll();
    setResetTokensOpen(false);
  }

  function openRoom(mode: "create" | "join") {
    setRoomMode(mode);
    setRoomError("");
    setRoomCode("");
    setRoomPasscode("");
  }

  const roomInviteLink = roomSession && typeof window !== "undefined"
    ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomSession.code)}&passcode=${encodeURIComponent(roomSession.passcode)}`
    : "";

  function copyRoomInviteLink() {
    if (!roomInviteLink) return;
    playCardSound("click");
    setRoomLinkCopied(true);
    void navigator.clipboard?.writeText(roomInviteLink);
    window.setTimeout(() => setRoomLinkCopied(false), 1800);
  }

  async function submitRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomMode || roomBusy || !walletLoaded) return;
    unlockAudio();
    setRoomBusy(true);
    setRoomError("");

    try {
      const endpoint =
        roomMode === "create"
          ? "/api/rooms"
          : `/api/rooms/${roomCode.trim().toUpperCase()}/join`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: roomName,
          passcode: roomPasscode,
          startingBankroll: wallet,
          ...(roomMode === "create" ? { mode: selectedMode } : {}),
        }),
      });
      const data = (await response.json()) as {
        room?: RoomView;
        playerId?: string;
        seatId?: string;
        error?: string;
      };
      if (!response.ok || !data.room || !data.playerId || !data.seatId) {
        throw new Error(data.error ?? "Could not open the room");
      }

      playCardSound("entry");
      setGame(null);
      setRoomSession({
        code: data.room.code,
        playerId: data.playerId,
        seatId: data.seatId,
        passcode: roomPasscode,
        room: data.room,
      });
      setRoomWager(data.room.table.minimum);
      setRoomSideBets({ ...EMPTY_SIDE_BETS });
      setRoomBreakoutBet("player");
      setRoomMode(null);
      if (roomMode === "join") setRoomPasscode("");
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "Could not open the room");
    } finally {
      setRoomBusy(false);
    }
  }

  async function toggleRoomReady() {
    if (!roomSession || roomBusy) return;
    const currentPlayer = roomSession.room.players.find(
      (player) => player.id === roomSession.seatId,
    );
    if (!currentPlayer) return;
    setRoomBusy(true);

    try {
      const response = await fetch(`/api/rooms/${roomSession.code}/ready`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: roomSession.playerId,
          ready: !currentPlayer.ready,
        }),
      });
      const data = (await response.json()) as { room?: RoomView; error?: string };
      if (!response.ok || !data.room) throw new Error(data.error ?? "Could not update your seat");
      applyRoomUpdate(data.room);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "Could not update your seat");
    } finally {
      setRoomBusy(false);
    }
  }

  async function startRoomTable() {
    if (!roomSession || roomBusy) return;
    setRoomBusy(true);
    setRoomError("");
    try {
      const response = await fetch(`/api/rooms/${roomSession.code}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: roomSession.playerId }),
      });
      const data = (await response.json()) as { room?: RoomView; error?: string };
      if (!response.ok || !data.room) throw new Error(data.error ?? "Could not start table");
      applyRoomUpdate(data.room);
      setRoomWager(data.room.table.minimum);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "Could not start table");
    } finally {
      setRoomBusy(false);
    }
  }

  async function sendRoomAction(
    action: "bet" | "hit" | "stand" | "double" | "double-up" | "split" | "surrender" | "next-round" | "donate" | "leave" | "kick",
    amount?: number,
    targetId?: string,
  ) {
    if (!roomSession || roomBusy || (action === "bet" && burnRevealActive)) return;
    unlockAudio();
    setRoomBusy(true);
    setRoomError("");
    if (["bet", "hit", "stand", "double", "double-up", "split", "surrender"].includes(action)) {
      setPendingRoomAction({
        action: action as PendingRoomAction["action"],
        round: roomSession.room.round,
        amount,
        sideBets: action === "bet" ? { ...roomSideBets } : undefined,
      });
    }
    const startedAt = performance.now();
    try {
      const response = await fetch(`/api/rooms/${roomSession.code}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: roomSession.playerId,
          action,
          amount,
          targetId,
          sideBets: action === "bet" ? roomSideBets : undefined,
          breakoutBet: action === "bet" && roomSession.room.mode === "breakout" ? roomBreakoutBet : undefined,
        }),
      });
      const respondedAt = performance.now();
      performance.measure(`blackjack:room-action:${action}`, { start: startedAt, end: respondedAt });
      recordRoomPerformance(`action:${action}`, respondedAt - startedAt);
      const data = (await response.json()) as { room?: RoomView; error?: string };
      if (!response.ok || (!data.room && action !== "leave")) throw new Error(data.error ?? "Could not update table");
      if (action === "leave") {
        setRoomSession(null);
        setDonationTarget(null);
        setHomeNotice("You left the room.");
        return;
      }
      applyRoomUpdate(data.room!);
      if (action === "next-round") {
        const updatedRoom = data.room!;
        const balance = updatedRoom.players.find((player) => player.id === roomSession.seatId)?.bankroll ?? 0;
        setRoomWager((current) => balance >= updatedRoom.table.minimum
          ? Math.min(Math.max(current, updatedRoom.table.minimum), balance)
          : current);
        setRoomSideBets({ ...EMPTY_SIDE_BETS });
      }
      if (action === "donate" || action === "kick") setDonationTarget(null);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "Could not update table");
      playCardSound("lose");
    } finally {
      setPendingRoomAction(null);
      setRoomBusy(false);
    }
  }

  return (
    <main className="gameShell">
      {achievementBanner !== null ? (
        <section
          className="achievementBanner"
          key={achievementBanner}
          role="status"
          aria-live="assertive"
        >
          <span className="achievementMedallion" aria-hidden="true">★</span>
          <span className="achievementCopy">
            <small>Achievement unlocked</small>
            <strong>{tokenAmount(achievementBanner)} tokens</strong>
            <b>New bankroll milestone</b>
          </span>
          <span className="achievementLaurel" aria-hidden="true">◆</span>
        </section>
      ) : null}
      {tableBustNotice ? (
        <section
          className="tableBustNotice"
          key={tableBustNotice.id}
          role="alert"
          aria-live="assertive"
        >
          <span className="bustedChipGraphic" aria-hidden="true">
            <i>◎</i>
            <b />
          </span>
          <span className="tableBustCopy">
            <small>Table minimum missed</small>
            <strong>BUSTED</strong>
            <b>
              {tokenAmount(tableBustNotice.balance)} tokens left · {tokenAmount(tableBustNotice.minimum)} required
            </b>
            {tableBustNotice.phrase ? <em>{tableBustNotice.phrase}</em> : null}
          </span>
        </section>
      ) : null}
      {sideBetCelebration ? (
        <div
          className="sideBetCelebration"
          key={sideBetCelebration.id}
          role="status"
          aria-live="polite"
        >
          <i aria-hidden="true">✦</i>
          <small>{sideBetCelebration.outcomes.length > 1 ? "Side bets hit" : "Side bet hit"}</small>
          {sideBetCelebration.outcomes.map((outcome) => (
            <span key={outcome.name}>
              <strong>{outcome.name}</strong>
              <b>{outcome.detail}</b>
            </span>
          ))}
        </div>
      ) : null}
      <header className="topBar">
        <button
          className="brand"
          type="button"
          onClick={() => {
            if (roomSession) void sendRoomAction("leave");
            else if (game) setGame(null);
          }}
          aria-label={game || roomSession ? "Leave table" : "Ashwin's Blackjack home"}
        >
          <span className="brandMark"><span>◆</span></span>
          <span className="brandWords">
            <strong>Ashwin’s</strong>
            <small>Blackjack</small>
          </span>
        </button>

        <div className="topActions">
          {game || roomPlayer || (!roomSession && walletLoaded) ? (
            <button
              className="balancePill"
              type="button"
              onClick={() => {
                if (!roomSession) setResetTokensOpen(true);
              }}
              aria-label={`Token balance: ${tokenAmount(roomPlayer?.bankroll ?? game?.bankroll ?? wallet)}${roomSession ? "" : ". Reset tokens"}`}
              title={roomSession ? "Token balance" : "Reset tokens"}
            >
              <span className="miniChip">◎</span>
              <span>
                <small>Balance</small>
                <strong>{tokenAmount(visibleRoomPlayer?.bankroll ?? game?.bankroll ?? wallet)}</strong>
              </span>
            </button>
          ) : null}
          {!roomSession ? (
            <button
              className="iconButton"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={`Single-player settings. ${soloHandCount} ${soloHandCount === 1 ? "hand" : "hands"} per deal`}
              title="Single-player settings"
            >
              <SettingsIcon />
            </button>
          ) : null}
          <button
            className="iconButton"
            type="button"
            onClick={toggleSound}
            aria-label={soundEnabled ? "Mute card sounds" : "Turn on card sounds"}
            title={soundEnabled ? "Mute card sounds" : "Turn on card sounds"}
          >
            <SoundIcon muted={!soundEnabled} />
          </button>
          <button className="iconButton" type="button" onClick={() => setRulesOpen(true)} aria-label="Game rules">
            <HelpIcon />
          </button>
        </div>
      </header>

      {roomSession?.room.phase === "lobby" ? (
        <section className="roomLobbyScreen">
          <div className="roomLobbyCard">
            <div className="welcomeEyebrow"><span /> Live private room</div>
            <h1>Table {roomSession.code}</h1>
            <p>{GAME_MODES.find((mode) => mode.id === roomSession.room.mode)?.name} · Share this invite link with up to four friends.</p>

            <button
              className="roomCodeDisplay"
              type="button"
              onClick={copyRoomInviteLink}
              title="Copy invite link"
            >
              <small>Invite link</small>
              <strong>{roomSession.code}</strong>
              <span>{roomLinkCopied ? "Copied" : "Copy link"}</span>
            </button>

            <div className="seatGrid">
              {Array.from({ length: 5 }, (_, index) => {
                const player = roomSession.room.players[index];
                const isCurrent = player?.id === roomSession.seatId;
                const isHost = player?.id === roomSession.room.hostId;
                return (
                  <div className={`roomSeat ${player ? "occupied" : ""}`} key={index}>
                    <span className="seatNumber">{index + 1}</span>
                    {player ? (
                      <>
                        <span className="playerAvatar">{player.name.slice(0, 1).toUpperCase()}</span>
                        <strong>{player.name}{isCurrent ? " (you)" : ""}</strong>
                        <small>{isHost ? "Host" : player.ready ? "Ready" : "Seated"}</small>
                        <i className={player.ready ? "ready" : ""} />
                        {isRoomHost && !isCurrent ? (
                          <button className="roomKickButton" type="button" disabled={roomBusy} onClick={() => void sendRoomAction("kick", undefined, player.id)}>Remove</button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="emptySeat">+</span>
                        <strong>Open seat</strong>
                        <small>Waiting</small>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="roomLobbyActions">
              <button className="textControl" type="button" onClick={() => void sendRoomAction("leave")}>
                Leave room
              </button>
              <button className="takeSeatButton" type="button" onClick={toggleRoomReady} disabled={roomBusy}>
                {roomPlayer?.ready ? "Not ready" : "Ready up"}
              </button>
              {isRoomHost ? (
                <button
                  className="takeSeatButton startRoomButton"
                  type="button"
                  onClick={startRoomTable}
                  disabled={roomBusy || !roomSession.room.players.every((player) => player.ready)}
                >
                  Start game
                </button>
              ) : null}
            </div>

            <div className="multiplayerStatus">
              <span className="statusDot" /> {roomSession.room.players.every((player) => player.ready)
                ? isRoomHost
                  ? "Everyone is ready — start the game"
                  : "Everyone is ready — waiting for the host"
                : "Every seated player must ready up"}
              {roomError ? <small className="roomErrorText">{roomError}</small> : null}
            </div>
          </div>
        </section>
      ) : roomSession ? (
        <section className="roomGameScreen">
          <div className="roomGameTopline">
            <span>Room {roomSession.code}</span>
            <strong>{roomSession.room.table.name} · {GAME_MODES.find((mode) => mode.id === roomSession.room.mode)?.name} · Round {roomSession.room.round}</strong>
            <span>{DECK_COUNT}-deck shoe · {roomSession.room.shoeRemaining} cards</span>
            <button type="button" className="roomExitButton" onClick={() => void sendRoomAction("leave")}>Leave</button>
          </div>

          <div className="roomDealerArea">
            <div className="zoneLabel">
              <span>Dealer</span>
              {!breakoutRevealPending && roomDealerTotalLabel(roomSession.room.dealer) ? (
                <span className="handValue">{roomDealerTotalLabel(roomSession.room.dealer)}</span>
              ) : null}
            </div>
            <div className="cardFan dealerCards">
              {roomSession.room.dealer.length ? roomSession.room.dealer.map((card, index) => (
                <PlayingCard
                  card={card ?? undefined}
                  delayMs={roomSession.room.mode === "breakout"
                    ? (index < 2
                      ? index === 1 && revealedBreakoutHole === breakoutRevealKey ? 0
                        : 1 + index * (roomDealtPlayers.length + 1) + roomDealtPlayers.length
                      : breakoutFlipStep + index) * ROOM_DEAL_DELAY
                    : roomSession.room.phase === "settled"
                      ? index < 2 ? 0 : 160 + (index - 2) * ROOM_DEAL_DELAY
                      : index < 2
                      ? (1 + (roomSession.room.mode === "doubleDownMadness" && index === 1
                        ? roomDealtPlayers.length + 1
                        : index * (roomDealtPlayers.length + 1) + roomDealtPlayers.length)) * ROOM_DEAL_DELAY
                      : 0}
                  hidden={!card || roomSession.room.mode === "breakout" && index === 1 &&
                    revealedBreakoutHole !== breakoutRevealKey}
                  key={card?.id ?? `hole-${index}`}
                  motion="dealer"
                  onInteract={playCardClick}
                  revealed={index === 1 && Boolean(card) && roomSession.room.phase === "settled" &&
                    (roomSession.room.mode !== "breakout" || revealedBreakoutHole === breakoutRevealKey)}
                />
              )) : <div className="emptyDealerMark"><span>◆</span></div>}
            </div>
          </div>

          <div className="roomGameMessage">{breakoutRevealPending
            ? "Breakout is playing both hands…"
            : pendingRoomAction && pendingRoomAction.round === roomSession.room.round
            ? pendingRoomAction.action === "bet"
              ? `Placing ${tokenAmount(pendingRoomAction.amount ?? 0)} tokens…`
              : `${pendingRoomAction.action[0].toUpperCase()}${pendingRoomAction.action.slice(1)} selected…`
            : roomSession.room.message}</div>

          <div className="roomPlayersStage">
            <div className="roomOpponentColumn roomOpponentColumnLeft" aria-label="Players to your left">
              {leftRoomOpponents.map((player) => (
                <RoomPlayerSeat
                  isActive={player.id === roomSession.room.currentPlayerId}
                  isLocal={false}
                  dealIndex={roomDealIndex.get(player.id) ?? -1}
                  dealPlayerCount={roomDealtPlayers.length}
                  dealExtraOffset={roomExtraDealOffsets.get(player.id) ?? 0}
                  revealComplete={!breakoutRevealPending}
                  key={player.id}
                  onCardInteract={playCardClick}
                  player={player}
                  tableMinimum={roomSession.room.table.minimum}
                  roomPhase={roomSession.room.phase}
                  roomMode={roomSession.room.mode}
                  onSelect={selectDonationPlayer}
                />
              ))}
            </div>
            {roomPlayer ? (
              <RoomPlayerSeat
                isActive={roomPlayer.id === roomSession.room.currentPlayerId}
                isLocal
                dealIndex={roomDealIndex.get(roomPlayer.id) ?? -1}
                dealPlayerCount={roomDealtPlayers.length}
                dealExtraOffset={roomExtraDealOffsets.get(roomPlayer.id) ?? 0}
                revealComplete={!breakoutRevealPending}
                onCardInteract={playCardClick}
                player={visibleRoomPlayer ?? roomPlayer}
                tableMinimum={roomSession.room.table.minimum}
                roomPhase={roomSession.room.phase}
                roomMode={roomSession.room.mode}
              />
            ) : null}
            <div className="roomOpponentColumn roomOpponentColumnRight" aria-label="Players to your right">
              {rightRoomOpponents.map((player) => (
                <RoomPlayerSeat
                  isActive={player.id === roomSession.room.currentPlayerId}
                  isLocal={false}
                  dealIndex={roomDealIndex.get(player.id) ?? -1}
                  dealPlayerCount={roomDealtPlayers.length}
                  dealExtraOffset={roomExtraDealOffsets.get(player.id) ?? 0}
                  revealComplete={!breakoutRevealPending}
                  key={player.id}
                  onCardInteract={playCardClick}
                  player={player}
                  tableMinimum={roomSession.room.table.minimum}
                  roomPhase={roomSession.room.phase}
                  roomMode={roomSession.room.mode}
                  onSelect={selectDonationPlayer}
                />
              ))}
            </div>
          </div>

          <div className="roomGameControls">
            {roomStrategyAdvice && roomSession.room.phase === "playing" ? (
              <div className="roomStrategyAdvisor">
                <StrategyAdvisor advice={roomStrategyAdvice} mode={roomSession.room.mode} open={strategyOpen}
                  onToggle={() => setStrategyOpen((open) => !open)} />
              </div>
            ) : null}
            {roomSession.room.phase === "betting" ? (
              !roomPlayerCanBet ? (
                <strong>You are out of tokens for this table. You can still watch{isRoomHost ? " and open the next round" : ""}.</strong>
              ) : roomPlayer?.bet || pendingRoomAction?.action === "bet" ? (
                <strong>Bet placed — waiting for the table</strong>
              ) : (
                <>
                  <div className="roomWagerPicker">
                    <button
                      className="roomWagerReset"
                      type="button"
                      onClick={() => setRoomWager(0)}
                    >
                      Clear
                    </button>
                    {roomSession.room.table.chips.map((chip) => (
                      <button
                        className="roomChipButton"
                        type="button"
                        key={chip}
                        aria-label={`Add ${tokenAmount(chip)} tokens to bet`}
                        onClick={() => {
                          playCardSound("chip");
                          setRoomWager((wager) => Math.min((roomPlayer?.bankroll ?? 0), wager + chip));
                        }}
                      >
                        <i className={`stakeChip ${chipValueClass(chip)}`}>{tokenAmount(chip)}</i>
                      </button>
                    ))}
                  </div>
                  {roomSession.room.mode === "breakout" ? <BreakoutBetPicker value={roomBreakoutBet} onChange={setRoomBreakoutBet} /> : null}
                  {availableSideBetKeys(roomSession.room.mode).length ? <div className="roomSideBetPicker" aria-label="Multiplayer side bets">
                    {availableSideBetKeys(roomSession.room.mode).map((key) => (
                      <button type="button" key={key} className={roomSideBets[key] ? "selected" : ""}
                        aria-label={`${SIDE_BET_LABELS[key].name}: ${roomSideBets[key]} tokens. Tap to change.`}
                        onClick={() => {
                          const choices = [0, roomSession.room.table.minimum / 2, roomSession.room.table.minimum];
                          const next = choices[(choices.indexOf(roomSideBets[key]) + 1) % choices.length];
                          setRoomSideBets((bets) => ({ ...bets, [key]: next }));
                        }}>
                        {SIDE_BET_LABELS[key].short} <b>{roomSideBets[key] || "—"}</b>
                      </button>
                    ))}
                  </div> : null}
          {roomSession.room.mode === "doubleDownMadness" ? <small className="sideBetPaytableHint">Dealer Bust pays 2:1 on 3–4 cards · 4:1 on 5 · 8:1 on 6 · 50:1 on 7+</small>
                    : roomSession.room.mode === "doubleUp" ? <small className="sideBetPaytableHint">Bonus 16 pays 4:1 on 2 cards · 5:1 on 3 · 10:1 on 4 · 50:1 on 5 · 100:1 on 6 · 500:1 on 7+</small>
                    : roomSession.room.mode === "breakout" ? <small className="sideBetPaytableHint">Tie pays 15:1. Breakout Bonus pays 5:1 to 250:1 when both hands bust.</small> : null}
                  <div className="roomWagerSummary" aria-live="polite">
                    <ChipPile amount={roomWager} denominations={roomSession.room.table.chips} />
                    <span>
                      <small>Current bet</small>
                      <strong>{tokenAmount(roomWager)}{sideBetStake(roomSideBets) ? ` + ${tokenAmount(sideBetStake(roomSideBets))} side` : ""}</strong>
                    </span>
                  </div>
                  <button
                    className="dealButton"
                    type="button"
                    onClick={() => sendRoomAction("bet", roomWager)}
                    disabled={roomBusy || burnRevealActive || roomWager < roomSession.room.table.minimum || roomWager + sideBetStake(roomSideBets) > (roomPlayer?.bankroll ?? 0)}
                  >
                    Place bet
                  </button>
                </>
              )
            ) : roomSession.room.phase === "playing" ? (
              pendingRoomAction ? <strong>{pendingRoomAction.action} selected — confirming with the table…</strong> : isRoomTurn ? (
                <div className={`playControls roomPlayControls${roomSession.room.mode === "doubleDownMadness" ? " madnessControls" : roomSession.room.mode === "doubleUp" ? " doubleUpControls" : ""}`}>
                  {roomSession.room.mode === "doubleUp" ? <button className="doubleUpAction" type="button" onClick={() => sendRoomAction("double-up")} disabled={!roomDoubleUpAvailable}>
                    <small>UP</small><span>Double Up</span>
                  </button> : <button type="button" onClick={() => sendRoomAction("stand")}><small>S</small><span>Stand</span></button>}
                  <button className="primaryAction" type="button" onClick={() => sendRoomAction("hit")} disabled={roomSession.room.mode === "doubleUp" && roomActiveHand?.splitAces}><small>H</small><span>Hit</span></button>
                  {roomSession.room.mode === "doubleUp" ? <button type="button" onClick={() => sendRoomAction("stand")}><small>S</small><span>Stand</span></button> : null}
                  <button type="button" onClick={() => sendRoomAction("double")} disabled={!roomDoubleAvailable}>
                    <small>2×</small><span>{roomSession.room.mode === "freeBet" && roomActiveHand && isFreeDouble(roomActiveHand.cards) ? "Free double" : "Double"}</span>
                  </button>
                  {roomSession.room.mode !== "doubleDownMadness" ? <>
                    <button type="button" onClick={() => sendRoomAction("split")} disabled={!roomSplitAvailable}>
                      <small>Ⅱ</small><span>{roomSession.room.mode === "freeBet" && roomActiveHand && isFreeSplit(roomActiveHand.cards) ? "Free split" : "Split"}</span>
                    </button>
                    {roomSession.room.mode !== "doubleUp" ? <button type="button" onClick={() => sendRoomAction("surrender")} disabled={!roomSurrenderAvailable}><small>½</small><span>Surrender</span></button> : null}
                  </> : null}
                </div>
              ) : <strong>Waiting for {roomSession.room.players.find((player) => player.id === roomSession.room.currentPlayerId)?.name}</strong>
            ) : breakoutRevealPending ? <strong>Breakout is dealing…</strong> : isRoomHost ? (
              <button className="dealButton" type="button" onClick={() => sendRoomAction("next-round")}>
                Open next round
              </button>
            ) : <strong>Round settled — waiting for the host</strong>}
            {roomError ? <span className="roomControlError">{roomError}</span> : null}
          </div>
        </section>
      ) : !game ? (
        <section className="welcomeScreen">
          <div className="welcomeEyebrow"><span /> Private {DECK_COUNT}-deck table</div>
          <div className="welcomeMark" aria-hidden="true">♠</div>
          <h1>Play free blackjack online.</h1>
          <p className="welcomeTagline">Ad-free blackjack. Play without distractions</p>
          <p className="welcomeCopy">
            Play Classic, Free Bet, Double Down Madness, Breakout, or Double Up solo, or join friends in a private room. Your practice-token balance stays on this device.
          </p>

          <div className="buyInCard">
            <div className="buyInHeading">
              <span>Choose table stakes<small>Balance: {tokenAmount(wallet)}</small></span>
              <details className="gameModeDropdown" ref={modeDropdownRef}>
                <summary aria-label={`Game mode: ${GAME_MODES.find((mode) => mode.id === selectedMode)?.name}. Change game mode`}>
                  <i className="gameModeIcon"><ModeIcon mode={selectedMode} /></i>
                  <span><small>Game mode</small><strong>{GAME_MODES.find((mode) => mode.id === selectedMode)?.name}</strong></span>
                  <b aria-hidden="true">⌄</b>
                </summary>
                <div className="gameModeDropdownMenu" role="group" aria-label="Choose game mode">
                  {GAME_MODES.map((mode) => (
                    <button className={selectedMode === mode.id ? "selected" : ""} type="button" key={mode.id}
                      aria-label={`${mode.name}: ${mode.description}`}
                      aria-pressed={selectedMode === mode.id} onClick={() => {
                        setSelectedMode(mode.id);
                        if (modeDropdownRef.current) modeDropdownRef.current.open = false;
                      }}>
                      <i className="gameModeIcon"><ModeIcon mode={mode.id} /></i>
                      <span><strong>{mode.name}</strong><small>{mode.description}</small></span>
                      {selectedMode === mode.id ? <b aria-hidden="true">✓</b> : null}
                    </button>
                  ))}
                </div>
              </details>
            </div>
            <div className="stakeTableOptions">
              {TABLES.map((table) => (
                <button
                  className={table.id === selectedTable.id ? "selected" : ""}
                  key={table.id}
                  type="button"
                  onClick={() => {
                    playCardSound("click");
                    setSelectedTableId(table.id);
                  }}
                >
                  <span className="stakeTableHeading">
                    <strong>{table.name}</strong>
                    <small>Minimum {tokenAmount(table.minimum)}</small>
                  </span>
                  <span className="stakeChips">
                    {table.chips.map((value) => (
                      <i className={`stakeChip ${chipValueClass(value)}`} key={value}>{tokenAmount(value)}</i>
                    ))}
                  </span>
                </button>
              ))}
            </div>
            <button
              className="takeSeatButton"
              type="button"
              onClick={startSession}
              disabled={!walletLoaded}
            >
              {wallet < selectedTable.minimum * soloHandCount
                ? `Need ${tokenAmount(selectedTable.minimum * soloHandCount)} tokens`
                : `Take a seat · ${soloHandCount} ${soloHandCount === 1 ? "hand" : "hands"}`} <span>→</span>
            </button>
            {homeNotice ? <div className="tableBalanceWarning" role="alert">{homeNotice}</div> : null}
          </div>

          <div className="tableFacts">
            <span><b>{soloHandCount}</b> {soloHandCount === 1 ? "hand" : "hands"}</span>
            <i />
            <span><b>{DECK_COUNT}</b> deck shoe</span>
            <i />
            <span><b>3:2</b> blackjack</span>
            <i />
            <span><b>{selectedMode === "doubleUp" ? "16" : "H17"}</b> {selectedMode === "doubleUp" ? "dealer stops at 16" : "dealer hits soft 17"}</span>
          </div>
          <div className="roomEntryActions">
            <button type="button" onClick={() => openRoom("create")}>
              <span>＋</span><strong>Create private room</strong>
            </button>
            <button type="button" onClick={() => openRoom("join")}>
              <span>→</span><strong>Join with code</strong>
            </button>
          </div>
          <nav className="homeGuideLinks" aria-label="Blackjack rules and payout guides">
            <a href="/rules">Classic rules</a>
            <a href="/free-bet">Free Bet</a>
            <a href="/double-down-madness">Double Down Madness</a>
            <a href="/breakout">Breakout</a>
            <a href="/double-up">Double Up</a>
            <a href="/side-bets">Side bet payouts</a>
            <a href="/play-with-ai">Play with AI</a>
          </nav>
          <a
            className="githubHomeLink"
            href="https://github.com/ashwinmahesh/blackjack"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View Ashwin's Blackjack on GitHub"
            title="View project on GitHub"
          >
            <GitHubIcon />
          </a>
        </section>
      ) : (
        <section className="tableScreen">
          <div className="tableRail" aria-hidden="true" />
          <div className="tableMeta">
            <div className="shoeTracker">
              <div className="shoeLabel">
                <DeckIcon />
                <span><strong>{DECK_COUNT} deck shoe</strong><small>{game.shoe.length} cards remain</small></span>
                <i>
                  <b style={{ width: `${shoePercent}%` }} />
                  <em
                    className={cutCardReached ? "reached" : ""}
                    style={{ left: `${(game.cutPoint / SHOE_SIZE) * 100}%` }}
                    title="Cut card"
                  />
                </i>
              </div>
              <div className="tableUtilityRow">
                {game.mode !== "breakout" ? <StrategyAdvisor
                  advice={strategyAdvice}
                  mode={game.mode}
                  open={strategyOpen}
                  onToggle={() => {
                    setCardCountOpen(false);
                    setStrategyOpen((open) => !open);
                  }}
                /> : null}
                <button
                  className="cardCountToggle"
                  type="button"
                  aria-expanded={cardCountOpen}
                  aria-controls="seen-card-counts"
                  onClick={() => {
                    setStrategyOpen(false);
                    setCardCountOpen((open) => !open);
                  }}
                >
                  <span>Cards seen</span>
                  <b>{seenCardTotal}</b>
                  <i aria-hidden="true">⌄</i>
                </button>
              </div>
              {cardCountOpen ? (
                <div className="cardCountPanel" id="seen-card-counts">
                  <header>
                    <strong>Revealed this shoe</strong>
                    <small>Resets on shuffle</small>
                  </header>
                  <div className="cardCountGrid">
                    {CARD_COUNT_RANKS.map((rank) => (
                      <span key={rank}>
                        <b>{rank}</b>
                        <strong>{game.seenCardCounts[rank]}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <span className="roundLabel">Round {game.round}</span>
          </div>

          <div className="dealerZone">
            <div className="zoneLabel">
              <span>Dealer</span>
              {game.dealer.length ? (
                <HandValue
                  cards={game.dealer}
                  hidden={game.mode === "breakout"
                    ? !game.dealerHoleSeen
                    : game.phase === "dealing" || game.phase === "playing"}
                />
              ) : null}
            </div>
            <div className="cardFan dealerCards">
              {game.dealer.map((card, index) => {
                const hidden = index === 1 && (game.mode === "breakout"
                  ? !game.dealerHoleSeen
                  : game.phase === "dealing" || game.phase === "playing");
                return (
                  <PlayingCard
                    card={card}
                    hidden={hidden}
                    revealed={index === 1 && !hidden}
                    key={`${card.id}-${hidden ? "down" : "up"}`}
                    onInteract={playCardClick}
                  />
                );
              })}
              {!game.dealer.length ? (
                <div className="emptyDealerMark"><span>◆</span></div>
              ) : null}
            </div>
          </div>

          <div className={`gameMessage ${game.tone}`} role="status">
            <span>{game.message}</span>
            {game.phase === "betting" ? (
              <small>TABLE MINIMUM {tokenAmount(selectedTable.minimum)}</small>
            ) : null}
            {cutCardReached ? (
              <div className="cutCardAlert">
                <i /> Cut card reached — shuffle after this hand
              </div>
            ) : null}
          </div>

          <div
            className={`playerZone ${game.hands.length > 1 ? "splitHands" : ""}`}
            data-hand-count={game.hands.length}
          >
            {game.phase === "shuffling" ? (
              <div className="shuffleVisual" aria-hidden="true">
                <span /><span /><span /><span />
                <strong>Fresh shoe</strong>
              </div>
            ) : game.hands.length ? (
              game.hands.map((hand, index) => (
                <div
                  className={`playerHand ${index === game.activeHand && game.phase === "playing" ? "active" : ""}`}
                  key={`${game.round}-${index}`}
                >
                  <div className="zoneLabel playerLabel">
                    <span>{game.hands.length > 1 ? `Hand ${index + 1}` : "You"}</span>
                    <HandValue cards={hand.cards} />
                  </div>
                  <div className="cardFan">
                    {hand.cards.map((card) => (
                      <PlayingCard card={card} key={card.id} onInteract={playCardClick} />
                    ))}
                  </div>
                  <div className="handBet"><span>◎</span> {tokenAmount(hand.bet)}{hand.doubleUpStake ? ` + ${tokenAmount(hand.doubleUpStake)} UP` : ""}</div>
                  {hand.result ? (
                    <div className={`resultTag ${hand.status} ${hand.result === "BUST" ? "bustTag" : ""}`}>
                      {hand.result}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="betSpot">
                <div className="betSpotRing">
                  <span>{game.mode === "breakout" ? `Bet on ${game.breakoutBet}` : "Bet per hand"}</span>
                  <ChipPile amount={game.currentBet} denominations={selectedTable.chips} />
                  <strong>{tokenAmount(game.currentBet)}</strong>
                  <small>
                    {game.startingHandCount} {game.startingHandCount === 1 ? "hand" : "hands"} · {tokenAmount(totalOpeningStake(game.currentBet, game.sideBets, game.startingHandCount))} total
                  </small>
                </div>
                {game.mode === "breakout" ? <BreakoutBetPicker value={game.breakoutBet}
                  onChange={(bet) => setGame((current) => current && current.phase === "betting"
                    ? { ...current, breakoutBet: bet } : current)} /> : null}
                {availableSideBetKeys(game.mode).length ? <div className="sideBetRow" aria-label="Side bets per hand">
                  {availableSideBetKeys(game.mode).map((key) => (
                    <button
                      className={game.sideBets[key] ? "selected" : ""}
                      type="button"
                      key={key}
                      onClick={() => cycleSideBet(key)}
                      aria-label={`${SIDE_BET_LABELS[key].name}: ${game.sideBets[key]} tokens. Tap to change.`}
                    >
                      <span>{SIDE_BET_LABELS[key].short}</span>
                      <strong>{game.sideBets[key] || "—"}</strong>
                    </button>
                  ))}
                </div> : null}
                {game.mode === "doubleDownMadness" ? <small className="sideBetPaytableHint">Dealer Bust pays 2:1 on 3–4 cards · 4:1 on 5 · 8:1 on 6 · 50:1 on 7+</small>
                  : game.mode === "doubleUp" ? <small className="sideBetPaytableHint">Bonus 16 pays 4:1 on 2 cards · 5:1 on 3 · 10:1 on 4 · 50:1 on 5 · 100:1 on 6 · 500:1 on 7+</small>
                  : game.mode === "breakout" ? <small className="sideBetPaytableHint">Tie pays 15:1. Breakout Bonus pays 5:1 to 250:1 when both hands bust.</small> : null}
              </div>
            )}
          </div>

          <div className="controlDock">
            {game.phase === "betting" ? (
              <div className="betControls">
                <div className="chipRow" aria-label="Add to bet">
                  {selectedTable.chips.map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={`betChip ${chipValueClass(value)}`}
                      onClick={() => changeBet(value)}
                      disabled={totalOpeningStake(
                        game.currentBet + value,
                        game.sideBets,
                        game.startingHandCount,
                      ) > game.bankroll}
                      aria-label={`Add ${value} tokens`}
                    >
                      <i /><strong>{value}</strong>
                    </button>
                  ))}
                </div>
                <button
                  className="textControl"
                  type="button"
                  onClick={() => changeBet(-game.currentBet)}
                  disabled={game.currentBet === 0}
                >
                  Clear
                </button>
                <button
                  className="dealButton"
                  type="button"
                  onClick={tableBusted ? resetTableBankroll : dealRound}
                  disabled={
                    !tableBusted && (
                      burnRevealActive ||
                      game.currentBet < selectedTable.minimum ||
                      totalOpeningStake(game.currentBet, game.sideBets, game.startingHandCount) > game.bankroll
                    )
                  }
                >
                  {tableBusted
                    ? "Reset"
                    : <>Deal {game.startingHandCount === 1 ? "cards" : `${game.startingHandCount} hands`}<span>→</span></>}
                </button>
              </div>
            ) : game.phase === "playing" ? (
              <div className={`playControls${game.mode === "doubleDownMadness" ? " madnessControls" : game.mode === "doubleUp" ? " doubleUpControls" : ""}`}>
                {game.mode === "doubleUp" ? <button className="doubleUpAction" type="button" onClick={doubleUp} disabled={!canDoubleUp}>
                  <small>UP</small><span>Double Up</span>
                </button> : <button className="secondaryAction" type="button" onClick={stand}>
                  <small>S</small><span>Stand</span>
                </button>}
                <button className="primaryAction" type="button" onClick={hit} disabled={game.mode === "doubleUp" && activeHand?.splitAces}>
                  <small>H</small><span>Hit</span>
                </button>
                {game.mode === "doubleUp" ? <button className="secondaryAction" type="button" onClick={stand}>
                  <small>S</small><span>Stand</span>
                </button> : null}
                <button className="secondaryAction" type="button" onClick={doubleDown} disabled={!canDouble}>
                  <small>2×</small><span>{game.mode === "freeBet" && activeHand && isFreeDouble(activeHand.cards)
                    ? "Free double"
                    : game.mode === "doubleDownMadness" && activeHand?.cards.length === 1 && activeHand.cards[0].rank === "A"
                      ? "Double · 1 card"
                      : "Double"}</span>
                </button>
                {game.mode !== "doubleDownMadness" ? <><button
                  className="secondaryAction"
                  type="button"
                  onClick={splitHand}
                  disabled={!splitPairAvailable}
                  title={
                    splitPairAvailable && !splitAvailable && activeHand
                      ? `Requires ${tokenAmount(activeHand.bet || activeHand.freeStake || game.currentBet)} tokens for the matching wager`
                      : undefined
                  }
                >
                  <small>Ⅱ</small><span>{game.mode === "freeBet" && activeHand && isFreeSplit(activeHand.cards) ? "Free split" : "Split"}</span>
                </button>
                {game.mode !== "doubleUp" ? <button className="secondaryAction" type="button" onClick={surrender} disabled={!surrenderAvailable}>
                  <small>½</small><span>Surrender</span>
                </button> : null}</> : null}
              </div>
            ) : game.phase === "dealing" || game.phase === "dealerTurn" || game.phase === "shuffling" ? (
              <div className="pacingControls" aria-live="polite">
                <span className="dealingPulse"><i /><i /><i /></span>
                <strong>
                  {game.phase === "dealing"
                    ? game.mode === "breakout" ? "Breakout plays both hands" : "Dealing cards"
                    : game.phase === "shuffling"
                      ? `Shuffling ${DECK_COUNT} decks`
                      : "Dealer is playing"}
                </strong>
              </div>
            ) : (
              <div className="settledControls">
                <div className="sessionChange">
                  <small>Session</small>
                  <strong className={game.bankroll >= game.startingBankroll ? "positive" : "negative"}>
                    {game.bankroll >= game.startingBankroll ? "+" : ""}
                    {tokenAmount(game.bankroll - game.startingBankroll)}
                  </strong>
                </div>
                <button
                  className="dealButton"
                  type="button"
                  onClick={tableBusted ? resetTableBankroll : nextRound}
                >
                  {tableBusted
                    ? "Reset"
                    : <>{cutCardReached ? "Shuffle shoe" : "Next hand"} <span>→</span></>}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {burnReveal && (screenKey === "solo" || screenKey === "roomGame") ? (
        <div className="burnReveal" role="status" aria-label={`Burned card: ${burnReveal.rank} of ${burnReveal.suit}`}>
          <div className={`burnRevealCard playingCard cardFace ${burnReveal.suit === "hearts" || burnReveal.suit === "diamonds" ? "redCard" : "blackCard"}`}>
            <span className="cardCorner"><strong>{burnReveal.rank}</strong><span>{SUIT_MARKS[burnReveal.suit]}</span></span>
            <span className="cardSuit">{SUIT_MARKS[burnReveal.suit]}</span>
            <span className="cardCorner bottomCorner"><strong>{burnReveal.rank}</strong><span>{SUIT_MARKS[burnReveal.suit]}</span></span>
          </div>
          <span className="burnRevealLabel">Burned card</span>
        </div>
      ) : null}

      {settingsOpen && !roomSession ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className="settingsSheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="closeButton" type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button>
            <span className="sheetEyebrow">Single-player settings</span>
            <h2 id="settings-title">Hands per deal</h2>
            <p>Choose up to three starting hands. You place the same main bet and side bets on each hand.</p>
            <div className="handCountOptions" role="group" aria-label="Number of hands per deal">
              {([1, 2, 3] as const).map((handCount) => (
                <button
                  className={soloHandCount === handCount ? "selected" : ""}
                  type="button"
                  key={handCount}
                  aria-pressed={soloHandCount === handCount}
                  onClick={() => selectSoloHandCount(handCount)}
                >
                  <span aria-hidden="true">
                    {Array.from({ length: handCount }, (_, index) => <i key={index} />)}
                  </span>
                  <strong>{handCount}</strong>
                  <small>{handCount === 1 ? "hand" : "hands"}</small>
                </button>
              ))}
            </div>
            <div className={`handCountStatus ${handCountQueued ? "queued" : ""}`}>
              <strong>{soloHandCount} {soloHandCount === 1 ? "hand" : "hands"} selected</strong>
              <span>
                {handCountQueued
                  ? "Queued for the next deal. Your current round will not change."
                  : game?.phase === "betting"
                    ? "This applies to the upcoming deal."
                    : "This setting is saved on this device."}
              </span>
            </div>
          </section>
        </div>
      ) : null}

      {resetTokensOpen ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setResetTokensOpen(false)}>
          <section
            className="resetTokensDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-tokens-title"
            aria-describedby="reset-tokens-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="resetTokensIcon" aria-hidden="true">◎</span>
            <span className="sheetEyebrow">Token balance</span>
            <h2 id="reset-tokens-title">Reset your tokens?</h2>
            <p id="reset-tokens-description">
              Your balance will return to {tokenAmount(RESET_BALANCE)} tokens
              {game ? " and your current solo hand will end." : "."}
            </p>
            <div className="resetTokensActions">
              <button type="button" className="cancelResetButton" onClick={() => setResetTokensOpen(false)} autoFocus>
                Cancel
              </button>
              <button type="button" className="confirmResetButton" onClick={confirmTokenReset}>
                Reset tokens
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {roomMode ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setRoomMode(null)}>
          <form className="roomSheet" onSubmit={submitRoom} onMouseDown={(event) => event.stopPropagation()}>
            <button className="closeButton" type="button" onClick={() => setRoomMode(null)} aria-label="Close room form">×</button>
            <span className="sheetEyebrow">Private multiplayer</span>
            <h2>{roomMode === "create" ? "Open a table." : "Take an open seat."}</h2>
            <p>
              {roomMode === "create"
                ? "Choose a passcode, then share it and the generated room code with your friends."
                : "Enter the five-character room code and the host’s passcode."}
            </p>
            {roomMode === "create" ? <div className="roomModePicker" role="group" aria-label="Game mode">
              <span>Game mode</span>
              <div>
                {GAME_MODES.map((mode) => (
                  <button type="button" key={mode.id} className={selectedMode === mode.id ? "selected" : ""}
                    aria-pressed={selectedMode === mode.id} onClick={() => setSelectedMode(mode.id)}>
                    <i className="gameModeIcon"><ModeIcon mode={mode.id} /></i>
                    <span><strong>{mode.name}</strong><small>{mode.description}</small></span>
                  </button>
                ))}
              </div>
            </div> : null}
            <label>
              <span>Display name</span>
              <input
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="Your name"
                minLength={2}
                maxLength={20}
                autoComplete="nickname"
                autoFocus
                required
              />
            </label>
            {roomMode === "join" ? (
              <label>
                <span>Room code</span>
                <input
                  className="codeInput"
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                  placeholder="ABCDE"
                  minLength={5}
                  maxLength={5}
                  autoCapitalize="characters"
                  required
                />
              </label>
            ) : null}
            <label>
              <span>Passcode</span>
              <input
                type="text"
                value={roomPasscode}
                onChange={(event) => setRoomPasscode(event.target.value)}
                placeholder="4 characters or more"
                minLength={4}
                maxLength={32}
                autoComplete={roomMode === "create" ? "new-password" : "current-password"}
                required
              />
            </label>
            <div className="roomStackNote">
              Your starting stack <strong>{walletLoaded ? `${tokenAmount(wallet)} tokens` : "Loading…"}</strong>
            </div>
            {roomError ? <div className="roomError" role="alert">{roomError}</div> : null}
            <button className="takeSeatButton" type="submit" disabled={roomBusy || !walletLoaded}>
              {roomBusy ? "Connecting…" : roomMode === "create" ? "Create room" : "Join room"}
            </button>
          </form>
        </div>
      ) : null}

      {donationTarget && selectedDonationPlayer && roomSession ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setDonationTarget(null)}>
          <form className="settingsSheet donationSheet" role="dialog" aria-modal="true" aria-labelledby="donation-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void sendRoomAction("donate", Number(donationAmount), donationTarget);
            }}>
            <button className="closeButton" type="button" onClick={() => setDonationTarget(null)} aria-label="Close transfer">×</button>
            <span className="sheetEyebrow">Multiplayer tokens</span>
            <h2 id="donation-title">Send tokens to {selectedDonationPlayer.name}</h2>
            <p>Your available balance is {tokenAmount(roomPlayer?.bankroll ?? 0)} tokens. Transfers are immediate.</p>
            <label htmlFor="donation-amount">Tokens to send</label>
            <input id="donation-amount" type="number" inputMode="numeric" min="1" step="1"
              max={roomPlayer?.bankroll ?? 0} value={donationAmount}
              onChange={(event) => setDonationAmount(event.target.value)} autoFocus required />
            {roomError ? <p className="roomErrorText" role="alert">{roomError}</p> : null}
            <button className="takeSeatButton" type="submit" disabled={roomBusy || !Number.isSafeInteger(Number(donationAmount)) || Number(donationAmount) < 1 || Number(donationAmount) > (roomPlayer?.bankroll ?? 0)}>Send tokens</button>
            {isRoomHost ? <button className="roomRemoveButton" type="button" disabled={roomBusy}
              onClick={() => void sendRoomAction("kick", undefined, donationTarget)}>Remove {selectedDonationPlayer.name} from room</button> : null}
          </form>
        </div>
      ) : null}

      {rulesOpen ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setRulesOpen(false)}>
          <section className="rulesSheet" role="dialog" aria-modal="true" aria-labelledby="rules-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="closeButton" type="button" onClick={() => setRulesOpen(false)} aria-label="Close rules">×</button>
            <span className="sheetEyebrow">Table rules</span>
            <h2 id="rules-title">Blackjack table rules</h2>
            <p>Get closer to 21 than the dealer without going over. Face cards count as 10; aces count as 1 or 11.</p>
            <dl>
              <div><dt>Blackjack</dt><dd>Pays 3:2</dd></div>
              <div><dt>Dealer</dt><dd>Hits soft 17</dd></div>
              <div><dt>Shoe</dt><dd>{DECK_COUNT} decks; one card burned after every shuffle</dd></div>
              <div><dt>Double</dt><dd>Any first two cards</dd></div>
              <div><dt>Split</dt><dd>Equal values; all 10-value cards match</dd></div>
              <div><dt>Surrender</dt><dd>Late; half the main bet returned</dd></div>
              <div><dt>Insurance</dt><dd>Not offered</dd></div>
            </dl>
            <p>Free Bet: free doubles on two-card hard 9–11, free splits except ten-value pairs, and dealer 22 pushes standing hands. Double Down Madness: one player card to start; hit or redouble after drawing, with no splits or surrender. Dealer 22 pushes standing hands. Opening-card side bets are available in Classic and Free Bet.</p>
            <p>Breakout: choose Player or Dealer before the deal; both hands then play automatically to hard 17 or soft 18. Player and Dealer wins pay 1:1, with a winning blackjack paying 3:2. A Dealer bet pushes when both bust or the player busts against dealer 17. The optional Tie side bet pays 15:1 on matching totals or when both hands bust. Breakout Bonus pays when both hands bust, with either main wager.</p>
            <p>Double Up: on a two-card hand, add an equal wager and stand immediately. A winning Double Up pays 1:1. On an ordinary tie the main wager pushes and Double Up loses. The dealer stops at hard or soft 16; a player 21 wins against 16, and all other live wagers push. No surrender. Split up to four hands.</p>
            <div className="sidePaytables">
              <h3>Side bet paytables</h3>
              <div>
                <strong>Perfect Pairs</strong>
                <span>Mixed 6:1 · Colored 12:1 · Perfect 25:1</span>
              </div>
              <div>
                <strong>21 + 3</strong>
                <span>Flush 5:1 · Straight 10:1 · Trips 30:1 · Straight flush 40:1 · Suited trips 100:1</span>
              </div>
              <div>
                <strong>Match the Dealer</strong>
                <span>Rank match 4:1 · Suited match 11:1. Each opening card can match.</span>
              </div>
              <div>
                <strong>Top 3</strong>
                <span>Three of a kind 90:1 · Straight flush 180:1 · Suited trips grand slam 270:1</span>
              </div>
              <div>
                <strong>Dealer Bust · Double Down Madness</strong>
                <span>3–4 cards 2:1 · 5 cards 4:1 · 6 cards 8:1 · 7+ cards 50:1</span>
              </div>
              <div>
                <strong>Bonus 16 · Double Up</strong>
                <span>Dealer 16 with 2 cards 4:1 · 3 cards 5:1 · 4 cards 10:1 · 5 cards 50:1 · 6 cards 100:1 · 7+ cards 500:1</span>
              </div>
              <div>
                <strong>Tie · Breakout</strong>
                <span>Matching totals or both bust 15:1</span>
              </div>
              <div>
                <strong>Breakout Bonus · both bust</strong>
                <span>6–7 combined cards 5:1 · 8 cards 15:1 · 9 cards 30:1 · 10 cards 100:1 · 11 cards 150:1 · 12+ cards 250:1</span>
              </div>
            </div>
            <p className="practiceNote">Practice tokens have no cash value.</p>
          </section>
        </div>
      ) : null}
    </main>
  );
}
