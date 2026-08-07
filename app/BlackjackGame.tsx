"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  type BasicStrategyAdvice,
  canSplit,
  Card as CardType,
  createCutPoint,
  createShoe,
  DECK_COUNT,
  dealerShouldHit,
  getBasicStrategyAdvice,
  isBlackjack,
  MAX_SPLIT_HANDS,
  playDealer,
  scoreHand,
  scoreMatchDealer,
  scorePerfectPairs,
  scoreTwentyOnePlusThree,
  SHOE_SIZE,
} from "../lib/blackjack";

type Phase = "betting" | "dealing" | "playing" | "dealerTurn" | "settled" | "shuffling";
type HandStatus = "active" | "standing" | "busted" | "won" | "lost" | "push" | "surrendered";
type SideBetKey = "perfectPairs" | "twentyOnePlusThree" | "matchDealer";
type SideBets = Record<SideBetKey, number>;
type SeenCardCounts = Record<CardType["rank"], number>;
type SoundKind = "deal" | "flip" | "win" | "sidebet" | "blackjack" | "achievement" | "lose" | "tableBust" | "shuffle" | "chip" | "entry" | "click";
type NavigatorWithAudioSession = Navigator & {
  audioSession?: { type: "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record" };
};

type SideBetOutcome = {
  name: string;
  detail: string;
  won: boolean;
};

type PlayerHand = {
  cards: CardType[];
  bet: number;
  status: HandStatus;
  result?: string;
};

type GameState = {
  bankroll: number;
  startingBankroll: number;
  currentBet: number;
  sideBets: SideBets;
  seenCardCounts: SeenCardCounts;
  dealerHoleSeen: boolean;
  shoe: CardType[];
  cutPoint: number;
  dealer: CardType[];
  hands: PlayerHand[];
  activeHand: number;
  phase: Phase;
  message: string;
  tone: "neutral" | "win" | "loss";
  round: number;
};

type RoomPlayerView = {
  id: string;
  name: string;
  bankroll: number;
  bet: number;
  ready: boolean;
  joinedAt: number;
  hands: Array<{
    cards: CardType[];
    bet: number;
    status: HandStatus;
    result?: string;
  }>;
  activeHand: number;
};

type RoomView = {
  code: string;
  hostId: string;
  phase: "lobby" | "betting" | "playing" | "settled";
  table: { id: string; name: string; minimum: number; chips: number[] };
  players: RoomPlayerView[];
  dealer: Array<CardType | null>;
  currentPlayerId: string | null;
  message: string;
  round: number;
  shoeRemaining: number;
  version: number;
};

type RoomSession = {
  code: string;
  playerId: string;
  seatId: string;
  room: RoomView;
};

const TABLES = [
  { id: "club", name: "Club table", minimum: 10, chips: [10, 25, 50, 100] },
  { id: "silver", name: "Silver table", minimum: 50, chips: [50, 100, 500, 1000] },
  { id: "gold", name: "Gold table", minimum: 100, chips: [100, 500, 1000, 5000] },
  { id: "high-limit", name: "High limit", minimum: 1000, chips: [1000, 5000, 10000, 25000] },
] as const;
const WALLET_KEY = "dealers-edge-token-balance";
const ACHIEVEMENTS_KEY = "dealers-edge-token-achievements-v2";
const RESET_BALANCE = 500;
const LOWEST_TABLE_MINIMUM = TABLES[0].minimum;
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
const EMPTY_SIDE_BETS: SideBets = {
  perfectPairs: 0,
  twentyOnePlusThree: 0,
  matchDealer: 0,
};
const SIDE_BET_LABELS: Record<SideBetKey, { name: string; short: string }> = {
  perfectPairs: { name: "Perfect Pairs", short: "Pairs" },
  twentyOnePlusThree: { name: "21 + 3", short: "21 + 3" },
  matchDealer: { name: "Match the Dealer", short: "Match" },
};
const CARD_COUNT_RANKS: CardType["rank"][] = [
  "A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2",
];

const DEAL_DELAY = 330;
const cardBounceAnimations = new WeakMap<HTMLDivElement, Animation>();

function pause(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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

function settleSideBets(
  playerCards: CardType[],
  dealerUpCard: CardType,
  sideBets: SideBets,
): { payout: number; outcomes: SideBetOutcome[] } {
  const entries = [
    {
      key: "perfectPairs" as const,
      result: scorePerfectPairs(playerCards),
    },
    {
      key: "twentyOnePlusThree" as const,
      result: scoreTwentyOnePlusThree([...playerCards, dealerUpCard]),
    },
    {
      key: "matchDealer" as const,
      result: scoreMatchDealer(playerCards, dealerUpCard),
    },
  ];
  let payout = 0;
  const outcomes: SideBetOutcome[] = [];

  for (const entry of entries) {
    const wager = sideBets[entry.key];
    if (!wager) continue;

    if (entry.result) {
      payout += wager * (entry.result.payout + 1);
      outcomes.push({
        name: SIDE_BET_LABELS[entry.key].name,
        detail: `${entry.result.label} · ${entry.result.payout}:1`,
        won: true,
      });
    } else {
      outcomes.push({
        name: SIDE_BET_LABELS[entry.key].name,
        detail: "No hit",
        won: false,
      });
    }
  }

  return { payout, outcomes };
}

function settleRound(state: GameState): GameState {
  const hasLiveHand = state.hands.some(
    (hand) => hand.status !== "busted" && scoreHand(hand.cards).total <= 21,
  );
  const dealerPlay = hasLiveHand
    ? playDealer(state.dealer, state.shoe)
    : { cards: state.dealer, shoe: state.shoe };
  const dealerScore = scoreHand(dealerPlay.cards).total;
  let payout = 0;
  let won = 0;
  let lost = 0;
  let pushed = 0;

  const hands = state.hands.map((hand) => {
    const playerScore = scoreHand(hand.cards).total;

    if (hand.status === "busted" || playerScore > 21) {
      lost += 1;
      return { ...hand, status: "lost" as const, result: "BUST" };
    }
    if (dealerScore > 21 || playerScore > dealerScore) {
      payout += hand.bet * 2;
      won += 1;
      return {
        ...hand,
        status: "won" as const,
        result: dealerScore > 21 ? "DEALER BUST" : "WIN",
      };
    }
    if (playerScore === dealerScore) {
      payout += hand.bet;
      pushed += 1;
      return { ...hand, status: "push" as const, result: "PUSH" };
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
    bankroll: state.bankroll + payout,
    dealer: dealerPlay.cards,
    shoe: dealerPlay.shoe,
    hands,
    phase: "settled",
    message,
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
  onInteract,
}: {
  card?: CardType;
  hidden?: boolean;
  revealed?: boolean;
  motion?: "dealer" | "player";
  delayMs?: number;
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
        className={`playingCard cardBack ${motionClass}`}
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
      className={`playingCard cardFace ${isRed ? "redCard" : "blackCard"} ${motionClass} ${revealed ? "cardReveal" : ""}`}
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

function RoomPlayerSeat({
  player,
  isLocal,
  isActive,
  onCardInteract,
}: {
  player: RoomPlayerView;
  isLocal: boolean;
  isActive: boolean;
  onCardInteract: () => void;
}) {
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
        <span className="roomPlayerIdentity">
          <i className="roomPlayerAvatar">{player.name.slice(0, 1).toUpperCase()}</i>
          <span>
            <small>{isLocal ? "Your hand" : "Player"}</small>
            <strong>{player.name}</strong>
          </span>
        </span>
        <span className="roomPlayerBalance">◎ {tokenAmount(player.bankroll)}</span>
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
                    card={card}
                    delayMs={cardIndex * 110 + handIndex * 45}
                    key={card.id}
                    motion="player"
                    onInteract={onCardInteract}
                  />
                ))}
              </div>
              <small>{scoreHand(hand.cards).total} · bet {tokenAmount(hand.bet)}</small>
              {hand.result ? <b className={hand.result === "BUST" ? "bust" : ""}>{hand.result}</b> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="roomWaiting">{player.bet ? `Bet ${tokenAmount(player.bet)}` : "Waiting for bet"}</div>
      )}
    </article>
  );
}

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
  open,
  onToggle,
}: {
  advice: BasicStrategyAdvice | null;
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
                  <small>Basic strategy says</small>
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
              <footer>6 decks · S17 · DAS · late surrender · no card count</footer>
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
  const [game, setGame] = useState<GameState | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
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
  const [cardCountOpen, setCardCountOpen] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [unlockedAchievements, setUnlockedAchievements] = useState<number[]>([]);
  const [achievementsLoaded, setAchievementsLoaded] = useState(false);
  const [achievementBanner, setAchievementBanner] = useState<number | null>(null);
  const [tableBustNotice, setTableBustNotice] = useState<{
    id: number;
    balance: number;
    minimum: number;
  } | null>(null);
  const [sideBetCelebration, setSideBetCelebration] = useState<{
    id: number;
    outcomes: SideBetOutcome[];
  } | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const soundEnabledRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNeedsRebuildRef = useRef(false);
  const previousRoomRef = useRef<RoomView | null>(null);
  const previousAchievementBalanceRef = useRef<number | null>(null);
  const previousAchievementSourceRef = useRef("");
  const achievementQueueRef = useRef<number[]>([]);
  const lastTableBustRoundRef = useRef("");
  const activeRoomCode = roomSession?.code;
  const gameBankroll = game?.bankroll;
  const selectedTable = TABLES.find((table) => table.id === selectedTableId) ?? TABLES[0];
  const sideBetValues = [0, selectedTable.minimum / 2, selectedTable.minimum, selectedTable.minimum * 2];
  const seenCardTotal = game
    ? Object.values(game.seenCardCounts).reduce((total, count) => total + count, 0)
    : 0;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const cachedBalance = Number(window.localStorage.getItem(WALLET_KEY));
      const startingBalance =
        Number.isFinite(cachedBalance) && cachedBalance >= LOWEST_TABLE_MINIMUM
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
      setWallet(startingBalance);
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
      const savedBalance =
        gameBankroll >= LOWEST_TABLE_MINIMUM ? gameBankroll : RESET_BALANCE;
      setWallet(savedBalance);
      window.localStorage.setItem(WALLET_KEY, String(savedBalance));
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
    if (!sideBetCelebration) return;
    const timer = window.setTimeout(() => setSideBetCelebration(null), 2600);
    return () => window.clearTimeout(timer);
  }, [sideBetCelebration]);

  useEffect(() => {
    if (!activeRoomCode) return;
    let cancelled = false;

    async function refreshRoom() {
      try {
        const response = await fetch(`/api/rooms/${activeRoomCode}`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { room: RoomView };
        setRoomSession((current) =>
          current?.code === data.room.code ? { ...current, room: data.room } : current,
        );
      } catch {
        // A later poll can recover from a transient connection failure.
      }
    }

    const interval = window.setInterval(() => void refreshRoom(), 1800);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeRoomCode]);

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
    const soundSpacing = 115;
    const dealSoundStart = holeRevealed ? 160 : 0;

    if (shuffled) playCardSound("shuffle");
    if (holeRevealed) playCardSound("flip");
    for (let index = 0; index < dealSoundCount; index += 1) {
      window.setTimeout(
        () => playCardSound("deal"),
        dealSoundStart + index * soundSpacing,
      );
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
    const resultDelay = dealSoundStart + dealSoundCount * soundSpacing + 120;

    if (newResults.some((hand) => hand.result === "BLACKJACK")) {
      window.setTimeout(() => playCardSound("blackjack"), resultDelay);
    } else if (newResults.some((hand) => ["WIN", "DEALER BUST"].includes(hand.result ?? ""))) {
      window.setTimeout(() => playCardSound("win"), resultDelay);
    } else if (newResults.some((hand) => ["DEALER WINS", "DEALER BLACKJACK"].includes(hand.result ?? ""))) {
      const bankrollBusted = Boolean(
        nextPlayer &&
        nextRoom.phase === "settled" &&
        nextPlayer.bankroll < nextRoom.table.minimum,
      );
      if (!bankrollBusted) window.setTimeout(() => playCardSound("lose"), resultDelay);
    }
  }, [playCardSound, roomSession]);

  const showTableBust = useCallback((balance: number, minimum: number, resetAchievements = false) => {
    if (resetAchievements) {
      achievementQueueRef.current = [];
      previousAchievementBalanceRef.current = balance;
      setAchievementBanner(null);
      setUnlockedAchievements([]);
    }
    setTableBustNotice({ id: Date.now(), balance, minimum });
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
        (hand) => hand.status !== "busted" && scoreHand(hand.cards).total <= 21,
      );

      while (hasLiveHand && dealerShouldHit(dealer)) {
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
      activeHand.cards.length === 2 &&
      game.bankroll >= activeHand.bet,
  );
  const splitPairAvailable = Boolean(
    game &&
      activeHand &&
      game.phase === "playing" &&
      game.hands.length < MAX_SPLIT_HANDS &&
      canSplit(activeHand.cards),
  );
  const splitAvailable = Boolean(
    splitPairAvailable && game && activeHand && game.bankroll >= activeHand.bet,
  );
  const surrenderAvailable = Boolean(
    game &&
      activeHand &&
      game.phase === "playing" &&
      game.hands.length === 1 &&
      activeHand.cards.length === 2,
  );
  const strategyAdvice = useMemo(() => {
    if (
      !game ||
      game.phase !== "playing" ||
      !activeHand ||
      !game.dealer[0]
    ) return null;
    return getBasicStrategyAdvice(activeHand.cards, game.dealer[0], {
      allowDouble: activeHand.cards.length === 2,
      allowSplit: game.hands.length < MAX_SPLIT_HANDS && canSplit(activeHand.cards),
      allowSurrender: game.hands.length === 1 && activeHand.cards.length === 2,
    });
  }, [activeHand, game]);
  const shoePercent = useMemo(
    () => (game ? Math.max(4, (game.shoe.length / SHOE_SIZE) * 100) : 100),
    [game],
  );
  const cutCardReached = Boolean(game && game.shoe.length <= game.cutPoint);
  const tableBusted = Boolean(game && game.bankroll < selectedTable.minimum);
  const roomPlayer = roomSession?.room.players.find(
    (player) => player.id === roomSession.seatId,
  );
  const roomOpponents = roomSession
    ? roomSession.room.players.filter((player) => player.id !== roomSession.seatId)
    : [];
  const leftRoomOpponents = roomOpponents.filter((_, index) => index % 2 === 0);
  const rightRoomOpponents = roomOpponents.filter((_, index) => index % 2 === 1);
  const roomActiveHand = roomPlayer?.hands[roomPlayer.activeHand];
  const isRoomHost = Boolean(roomSession && roomSession.room.hostId === roomSession.seatId);
  const isRoomTurn = Boolean(
    roomSession && roomSession.room.currentPlayerId === roomSession.seatId,
  );
  const achievementBalance = roomPlayer?.bankroll ?? game?.bankroll ?? wallet;
  const achievementSource = roomPlayer
    ? `room:${roomSession?.code}:${roomPlayer.id}`
    : game
      ? "solo"
      : "wallet";
  const completedTableBustKey = roomPlayer && roomSession?.room.phase === "settled"
    ? `room:${roomSession.code}:${roomPlayer.id}:${roomSession.room.round}`
    : game?.phase === "settled"
      ? `solo:${game.round}`
      : null;
  const completedTableBalance = roomPlayer?.bankroll ?? game?.bankroll ?? wallet;
  const completedTableMinimum = roomSession?.room.table.minimum ?? selectedTable.minimum;

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

  function startSession() {
    if (wallet < selectedTable.minimum) {
      showTableBust(wallet, selectedTable.minimum);
      setHomeNotice(
        `${selectedTable.name} requires ${tokenAmount(selectedTable.minimum)} tokens. Your balance is ${tokenAmount(wallet)}.`,
      );
      return;
    }
    playCardSound("entry");
    setHomeNotice("");
    const startingBalance =
      wallet >= LOWEST_TABLE_MINIMUM ? wallet : RESET_BALANCE;
    setGame({
      bankroll: startingBalance,
      startingBankroll: startingBalance,
      currentBet: selectedTable.minimum,
      sideBets: { ...EMPTY_SIDE_BETS },
      seenCardCounts: emptySeenCardCounts(),
      dealerHoleSeen: false,
      shoe: createShoe(DECK_COUNT),
      cutPoint: createCutPoint(),
      dealer: [],
      hands: [],
      activeHand: 0,
      phase: "betting",
      message: "Place your bet",
      tone: "neutral",
      round: 1,
    });
  }

  function changeBet(amount: number) {
    if (amount > 0) playCardSound("chip");
    setGame((current) => {
      if (!current || current.phase !== "betting") return current;
      const nextBet = current.currentBet + amount;
      if (nextBet + sideBetStake(current.sideBets) > current.bankroll || nextBet < 0) return current;
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
        game.currentBet + sideBetStake(previewBets) <= game.bankroll
      ) {
        playCardSound("chip");
      }
    }
    setGame((current) => {
      if (!current || current.phase !== "betting") return current;
      const valueIndex = sideBetValues.indexOf(current.sideBets[key]);
      const nextValue = sideBetValues[(valueIndex + 1) % sideBetValues.length];
      const sideBets = { ...current.sideBets, [key]: nextValue };
      if (current.currentBet + sideBetStake(sideBets) > current.bankroll) return current;
      return { ...current, sideBets };
    });
  }

  async function dealRound() {
    const current = game;
    if (
      !current ||
      current.phase !== "betting" ||
      current.currentBet < selectedTable.minimum ||
      current.currentBet + sideBetStake(current.sideBets) > current.bankroll
    ) {
      return;
    }

    if (soundEnabledRef.current) {
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      if (context.state === "suspended") void context.resume();
    }

    const emergencyShuffle = current.shoe.length < 4;
    const shoe = emergencyShuffle ? createShoe(DECK_COUNT) : [...current.shoe];
    const playerCards = [draw(shoe)];
    const dealerCards = [draw(shoe)];
    playerCards.push(draw(shoe));
    dealerCards.push(draw(shoe));
    const bet = current.currentBet;
    const openingStake = bet + sideBetStake(current.sideBets);
    const sideBetResult = settleSideBets(playerCards, dealerCards[0], current.sideBets);
    const dealRoundNumber = current.round;

    setGame({
      ...current,
      bankroll: current.bankroll - openingStake,
      dealer: [],
      shoe,
      seenCardCounts: emergencyShuffle ? emptySeenCardCounts() : current.seenCardCounts,
      dealerHoleSeen: false,
      hands: [{ cards: [], bet, status: "active" }],
      activeHand: 0,
      phase: "dealing",
      message: "Cards coming out",
      tone: "neutral",
    });

    const dealSteps: Array<{ recipient: "player" | "dealer"; card: CardType; visible: boolean }> = [
      { recipient: "player", card: playerCards[0], visible: true },
      { recipient: "dealer", card: dealerCards[0], visible: true },
      { recipient: "player", card: playerCards[1], visible: true },
      { recipient: "dealer", card: dealerCards[1], visible: false },
    ];

    for (const step of dealSteps) {
      await pause(DEAL_DELAY);
      const liveState = gameRef.current;
      if (!liveState || liveState.phase !== "dealing" || liveState.round !== dealRoundNumber) return;
      playCardSound("deal");
      setGame((latest) => {
        if (!latest || latest.phase !== "dealing" || latest.round !== dealRoundNumber) return latest;
        return step.recipient === "player"
          ? {
              ...latest,
              seenCardCounts: step.visible
                ? addSeenCards(latest.seenCardCounts, [step.card])
                : latest.seenCardCounts,
              hands: [{ ...latest.hands[0], cards: [...latest.hands[0].cards, step.card] }],
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

    await pause(360);
    const playerNatural = isBlackjack(playerCards);
    const dealerNatural = isBlackjack(dealerCards);
    const winningSideBets = sideBetResult.outcomes.filter((outcome) => outcome.won);
    if (winningSideBets.length) {
      setSideBetCelebration({ id: dealRoundNumber, outcomes: winningSideBets });
    }
    if (playerNatural || dealerNatural) playCardSound("flip");
    if (playerNatural && !dealerNatural) {
      window.setTimeout(() => playCardSound("blackjack"), 180);
    }
    if (winningSideBets.length) {
      window.setTimeout(
        () => playCardSound("sidebet"),
        playerNatural && !dealerNatural ? 650 : 180,
      );
    }

    setGame((latest) => {
      if (!latest || latest.phase !== "dealing" || latest.round !== dealRoundNumber) return latest;

      if (playerNatural || dealerNatural) {
        const payout = playerNatural
          ? dealerNatural
            ? bet
            : bet * 2.5
          : 0;
        return {
          ...latest,
          bankroll: latest.bankroll + sideBetResult.payout + payout,
          dealer: dealerCards,
          dealerHoleSeen: true,
          seenCardCounts: latest.dealerHoleSeen
            ? latest.seenCardCounts
            : addSeenCards(latest.seenCardCounts, [dealerCards[1]]),
          hands: [
            {
              cards: playerCards,
              bet,
              status: playerNatural
                ? dealerNatural
                  ? "push"
                  : "won"
                : "lost",
              result: playerNatural
                ? dealerNatural
                  ? "PUSH"
                  : "BLACKJACK"
                : "DEALER BLACKJACK",
            },
          ],
          phase: "settled",
          message: playerNatural
            ? dealerNatural
              ? "Two naturals — push"
              : "Blackjack pays 3 to 2"
            : "Dealer has blackjack",
          tone:
            playerNatural && !dealerNatural
              ? "win"
              : dealerNatural && !playerNatural
                ? "loss"
                : "neutral",
        };
      }

      return {
        ...latest,
        bankroll: latest.bankroll + sideBetResult.payout,
        dealer: dealerCards,
        hands: [{ cards: playerCards, bet, status: "active" }],
        phase: "playing",
        message: "Your move",
        tone: "neutral",
      };
    });
  }

  function hit() {
    playCardSound("deal");
    setGame((current) => {
      if (!current || current.phase !== "playing") return current;
      const shoe = [...current.shoe];
      const dealtCard = draw(shoe);
      const hands = current.hands.map((hand, index) =>
        index === current.activeHand
          ? { ...hand, cards: [...hand.cards, dealtCard] }
          : hand,
      );
      const total = scoreHand(hands[current.activeHand].cards).total;
      const next = {
        ...current,
        shoe,
        seenCardCounts: addSeenCards(current.seenCardCounts, [dealtCard]),
        hands: hands.map((hand, index) =>
          index === current.activeHand && total >= 21
            ? {
                ...hand,
                status: total > 21 ? ("busted" as const) : ("standing" as const),
                result: total > 21 ? "BUST" : hand.result,
              }
            : hand,
        ),
        message: total > 21 ? "That hand busts" : total === 21 ? "Twenty-one" : "Your move",
        tone: total > 21 ? ("loss" as const) : ("neutral" as const),
      };

      return total >= 21 ? advanceOrSettle(next) : next;
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

  function doubleDown() {
    if (canDouble) playCardSound("deal");
    setGame((current) => {
      if (!current || current.phase !== "playing") return current;
      const hand = current.hands[current.activeHand];
      if (hand.cards.length !== 2 || current.bankroll < hand.bet) return current;

      const shoe = [...current.shoe];
      const dealtCard = draw(shoe);
      const hands = current.hands.map((candidate, index) => {
        if (index !== current.activeHand) return candidate;
        const cards = [...candidate.cards, dealtCard];
        const busted = scoreHand(cards).total > 21;
        return {
          ...candidate,
          cards,
          bet: candidate.bet * 2,
          status: busted ? ("busted" as const) : ("standing" as const),
          result: busted ? "BUST" : candidate.result,
        };
      });

      return advanceOrSettle({
        ...current,
        bankroll: current.bankroll - hand.bet,
        shoe,
        seenCardCounts: addSeenCards(current.seenCardCounts, [dealtCard]),
        hands,
      });
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
        current.hands.length >= MAX_SPLIT_HANDS ||
        !canSplit(original.cards)
      ) {
        return current;
      }
      if (current.bankroll < original.bet) {
        return {
          ...current,
          message: `A split needs ${tokenAmount(original.bet)} more tokens`,
          tone: "neutral",
        };
      }

      const shoe = [...current.shoe];
      const firstDealtCard = draw(shoe);
      const secondDealtCard = draw(shoe);
      const firstCards = [original.cards[0], firstDealtCard];
      const secondCards = [original.cards[1], secondDealtCard];
      const splitAces = original.cards[0].rank === "A";
      const splitHands: PlayerHand[] = [firstCards, secondCards].map((cards) => ({
        cards,
        bet: original.bet,
        status:
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
        bankroll: current.bankroll - original.bet,
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
      if (!current || current.phase !== "playing" || current.hands.length !== 1) return current;
      const hand = current.hands[0];
      if (hand.cards.length !== 2) return current;

      return {
        ...current,
        bankroll: current.bankroll + Math.floor(hand.bet / 2),
        hands: [{ ...hand, status: "surrendered", result: "SURRENDER" }],
        phase: "settled",
        message: "Late surrender — half your bet is returned",
        tone: "neutral",
      };
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
        const affordableBet =
          Math.floor(current.bankroll / selectedTable.minimum) * selectedTable.minimum;
        return {
          ...current,
          currentBet: Math.min(current.currentBet, affordableBet),
          sideBets: { ...EMPTY_SIDE_BETS },
          seenCardCounts: emptySeenCardCounts(),
          dealerHoleSeen: false,
          shoe: createShoe(DECK_COUNT),
          cutPoint: createCutPoint(),
          phase: "betting",
          message:
            current.bankroll >= selectedTable.minimum
              ? "Fresh shoe — place your bet"
              : "You’re below this table’s minimum",
          round: current.round + 1,
        };
      });
      return;
    }

    setGame((current) => {
      if (!current) return current;
      const affordableBet =
        Math.floor(current.bankroll / selectedTable.minimum) * selectedTable.minimum;
      const currentBet = Math.min(current.currentBet, affordableBet);
      const sideBets =
        currentBet + sideBetStake(current.sideBets) <= current.bankroll
          ? current.sideBets
          : { ...EMPTY_SIDE_BETS };
      return {
        ...current,
        currentBet,
        sideBets,
        dealer: [],
        dealerHoleSeen: false,
        hands: [],
        activeHand: 0,
        phase: "betting",
        message:
          current.bankroll >= selectedTable.minimum
            ? "Place your bet"
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
      if (needsFreshShoe) playCardSound("shuffle");
      return {
        ...current,
        bankroll: RESET_BALANCE,
        startingBankroll: RESET_BALANCE,
        currentBet: selectedTable.minimum,
        sideBets: { ...EMPTY_SIDE_BETS },
        seenCardCounts: needsFreshShoe
          ? emptySeenCardCounts()
          : current.seenCardCounts,
        dealerHoleSeen: false,
        shoe: needsFreshShoe ? createShoe(DECK_COUNT) : current.shoe,
        cutPoint: needsFreshShoe ? createCutPoint() : current.cutPoint,
        dealer: [],
        hands: [],
        activeHand: 0,
        phase: "betting",
        message: "Bankroll reset — place your bet",
        tone: "neutral",
        round: current.phase === "settled" ? current.round + 1 : current.round,
      };
    });
  }

  function openRoom(mode: "create" | "join") {
    setRoomMode(mode);
    setRoomError("");
    setRoomCode("");
    setRoomPasscode("");
  }

  async function submitRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomMode || roomBusy) return;
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
          ...(roomMode === "create" ? { startingBankroll: wallet } : {}),
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
        room: data.room,
      });
      setRoomWager(data.room.table.minimum);
      setRoomMode(null);
      setRoomPasscode("");
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
      setRoomSession((current) => (current ? { ...current, room: data.room! } : current));
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
      setRoomSession((current) => (current ? { ...current, room: data.room! } : current));
      setRoomWager(data.room.table.minimum);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "Could not start table");
    } finally {
      setRoomBusy(false);
    }
  }

  async function sendRoomAction(
    action: "bet" | "hit" | "stand" | "double" | "split" | "surrender" | "next-round",
    amount?: number,
  ) {
    if (!roomSession || roomBusy) return;
    unlockAudio();
    setRoomBusy(true);
    setRoomError("");
    try {
      const response = await fetch(`/api/rooms/${roomSession.code}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: roomSession.playerId, action, amount }),
      });
      const data = (await response.json()) as { room?: RoomView; error?: string };
      if (!response.ok || !data.room) throw new Error(data.error ?? "Could not update table");
      setRoomSession((current) => (current ? { ...current, room: data.room! } : current));
      if (action === "next-round") setRoomWager(data.room.table.minimum);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : "Could not update table");
      playCardSound("lose");
    } finally {
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
            if (roomSession) setRoomSession(null);
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
          {game || (!roomSession && walletLoaded) ? (
            <div className="balancePill">
              <span className="miniChip">◎</span>
              <span>
                <small>Balance</small>
                <strong>{tokenAmount(game?.bankroll ?? wallet)}</strong>
              </span>
            </div>
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
            <p>Share this code and the passcode with up to four friends.</p>

            <button
              className="roomCodeDisplay"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(roomSession.code)}
              title="Copy room code"
            >
              <small>Room code</small>
              <strong>{roomSession.code}</strong>
              <span>Copy</span>
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
              <button className="textControl" type="button" onClick={() => setRoomSession(null)}>
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
            <strong>{roomSession.room.table.name} · Round {roomSession.room.round}</strong>
            <span>{roomSession.room.shoeRemaining} cards</span>
          </div>

          <div className="roomDealerArea">
            <div className="zoneLabel"><span>Dealer</span></div>
            <div className="cardFan dealerCards">
              {roomSession.room.dealer.length ? roomSession.room.dealer.map((card, index) => (
                <PlayingCard
                  card={card ?? undefined}
                  delayMs={roomSession.room.phase === "settled" ? Math.max(0, index - 1) * 140 : index * 115}
                  hidden={!card}
                  key={card?.id ?? `hole-${index}`}
                  motion="dealer"
                  onInteract={playCardClick}
                  revealed={index === 1 && Boolean(card) && roomSession.room.phase === "settled"}
                />
              )) : <div className="emptyDealerMark"><span>◆</span></div>}
            </div>
          </div>

          <div className="roomGameMessage">{roomSession.room.message}</div>

          <div className="roomPlayersStage">
            <div className="roomOpponentColumn roomOpponentColumnLeft" aria-label="Players to your left">
              {leftRoomOpponents.map((player) => (
                <RoomPlayerSeat
                  isActive={player.id === roomSession.room.currentPlayerId}
                  isLocal={false}
                  key={player.id}
                  onCardInteract={playCardClick}
                  player={player}
                />
              ))}
            </div>
            {roomPlayer ? (
              <RoomPlayerSeat
                isActive={roomPlayer.id === roomSession.room.currentPlayerId}
                isLocal
                onCardInteract={playCardClick}
                player={roomPlayer}
              />
            ) : null}
            <div className="roomOpponentColumn roomOpponentColumnRight" aria-label="Players to your right">
              {rightRoomOpponents.map((player) => (
                <RoomPlayerSeat
                  isActive={player.id === roomSession.room.currentPlayerId}
                  isLocal={false}
                  key={player.id}
                  onCardInteract={playCardClick}
                  player={player}
                />
              ))}
            </div>
          </div>

          <div className="roomGameControls">
            {roomSession.room.phase === "betting" ? (
              roomPlayer?.bet ? (
                <strong>Bet placed — waiting for the table</strong>
              ) : (
                <>
                  <div className="roomWagerPicker">
                    <button
                      className="roomWagerReset"
                      type="button"
                      onClick={() => setRoomWager(roomSession.room.table.minimum)}
                    >
                      Reset
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
                  <div className="roomWagerSummary" aria-live="polite">
                    <ChipPile amount={roomWager} denominations={roomSession.room.table.chips} />
                    <span>
                      <small>Current bet</small>
                      <strong>{tokenAmount(roomWager)}</strong>
                    </span>
                  </div>
                  <button
                    className="dealButton"
                    type="button"
                    onClick={() => sendRoomAction("bet", roomWager)}
                    disabled={roomBusy || roomWager > (roomPlayer?.bankroll ?? 0)}
                  >
                    Place bet
                  </button>
                </>
              )
            ) : roomSession.room.phase === "playing" ? (
              isRoomTurn ? (
                <div className="playControls roomPlayControls">
                  <button type="button" onClick={() => sendRoomAction("stand")}><small>S</small><span>Stand</span></button>
                  <button className="primaryAction" type="button" onClick={() => sendRoomAction("hit")}><small>H</small><span>Hit</span></button>
                  <button type="button" onClick={() => sendRoomAction("double")} disabled={!roomActiveHand || roomActiveHand.cards.length !== 2 || (roomPlayer?.bankroll ?? 0) < (roomActiveHand?.bet ?? 0)}><small>2×</small><span>Double</span></button>
                  <button type="button" onClick={() => sendRoomAction("split")} disabled={!roomActiveHand || !canSplit(roomActiveHand.cards) || (roomPlayer?.hands.length ?? 1) >= MAX_SPLIT_HANDS || (roomPlayer?.bankroll ?? 0) < (roomActiveHand?.bet ?? 0)}><small>Ⅱ</small><span>Split</span></button>
                  <button type="button" onClick={() => sendRoomAction("surrender")} disabled={!roomActiveHand || roomActiveHand.cards.length !== 2 || (roomPlayer?.hands.length ?? 0) !== 1}><small>½</small><span>Surrender</span></button>
                </div>
              ) : <strong>Waiting for {roomSession.room.players.find((player) => player.id === roomSession.room.currentPlayerId)?.name}</strong>
            ) : isRoomHost ? (
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
          <h1>Play your hand.</h1>
          <p className="welcomeTagline">Ad-free blackjack. Play without distractions</p>
          <p className="welcomeCopy">
            Your token balance stays on this device. Choose a table, then take a seat.
          </p>

          <div className="buyInCard">
            <div className="buyInHeading">
              <span>Choose table stakes</span>
              <small>Balance: {tokenAmount(wallet)}</small>
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
              {wallet < selectedTable.minimum ? "Balance below table minimum" : "Take a seat"} <span>→</span>
            </button>
            {homeNotice ? <div className="tableBalanceWarning" role="alert">{homeNotice}</div> : null}
          </div>

          <div className="tableFacts">
            <span><b>{DECK_COUNT}</b> deck shoe</span>
            <i />
            <span><b>3:2</b> blackjack</span>
            <i />
            <span><b>S17</b> dealer stands</span>
          </div>
          <div className="roomEntryActions">
            <button type="button" onClick={() => openRoom("create")}>
              <span>＋</span><strong>Create private room</strong>
            </button>
            <button type="button" onClick={() => openRoom("join")}>
              <span>→</span><strong>Join with code</strong>
            </button>
          </div>
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
                <StrategyAdvisor
                  advice={strategyAdvice}
                  open={strategyOpen}
                  onToggle={() => {
                    setCardCountOpen(false);
                    setStrategyOpen((open) => !open);
                  }}
                />
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
                  hidden={game.phase === "dealing" || game.phase === "playing"}
                />
              ) : null}
            </div>
            <div className="cardFan dealerCards">
              {game.dealer.map((card, index) => {
                const hidden =
                  index === 1 && (game.phase === "dealing" || game.phase === "playing");
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
                  <div className="handBet"><span>◎</span> {tokenAmount(hand.bet)}</div>
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
                  <span>Bet</span>
                  <ChipPile amount={game.currentBet} denominations={selectedTable.chips} />
                  <strong>{tokenAmount(game.currentBet)}</strong>
                  <small>tokens</small>
                </div>
                <div className="sideBetRow" aria-label="Side bets">
                  {(Object.keys(SIDE_BET_LABELS) as SideBetKey[]).map((key) => (
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
                </div>
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
                      disabled={game.currentBet + sideBetStake(game.sideBets) + value > game.bankroll}
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
                    !tableBusted && game.currentBet < selectedTable.minimum
                  }
                >
                  {tableBusted ? "Reset" : <>Deal cards<span>→</span></>}
                </button>
              </div>
            ) : game.phase === "playing" ? (
              <div className="playControls">
                <button className="secondaryAction" type="button" onClick={stand}>
                  <small>S</small><span>Stand</span>
                </button>
                <button className="primaryAction" type="button" onClick={hit}>
                  <small>H</small><span>Hit</span>
                </button>
                <button className="secondaryAction" type="button" onClick={doubleDown} disabled={!canDouble}>
                  <small>2×</small><span>Double</span>
                </button>
                <button
                  className="secondaryAction"
                  type="button"
                  onClick={splitHand}
                  disabled={!splitPairAvailable}
                  title={
                    splitPairAvailable && !splitAvailable && activeHand
                      ? `Requires ${tokenAmount(activeHand.bet)} tokens for the matching wager`
                      : undefined
                  }
                >
                  <small>Ⅱ</small><span>Split</span>
                </button>
                <button className="secondaryAction" type="button" onClick={surrender} disabled={!surrenderAvailable}>
                  <small>½</small><span>Surrender</span>
                </button>
              </div>
            ) : game.phase === "dealing" || game.phase === "dealerTurn" || game.phase === "shuffling" ? (
              <div className="pacingControls" aria-live="polite">
                <span className="dealingPulse"><i /><i /><i /></span>
                <strong>
                  {game.phase === "dealing"
                    ? "Dealing cards"
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
                type="password"
                value={roomPasscode}
                onChange={(event) => setRoomPasscode(event.target.value)}
                placeholder="4 characters or more"
                minLength={4}
                maxLength={32}
                autoComplete={roomMode === "create" ? "new-password" : "current-password"}
                required
              />
            </label>
            {roomMode === "create" ? (
              <div className="roomStackNote">
                Starting stack <strong>{tokenAmount(wallet)} tokens</strong>
              </div>
            ) : null}
            {roomError ? <div className="roomError" role="alert">{roomError}</div> : null}
            <button className="takeSeatButton" type="submit" disabled={roomBusy}>
              {roomBusy ? "Connecting…" : roomMode === "create" ? "Create room" : "Join room"}
            </button>
          </form>
        </div>
      ) : null}

      {rulesOpen ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setRulesOpen(false)}>
          <section className="rulesSheet" role="dialog" aria-modal="true" aria-labelledby="rules-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="closeButton" type="button" onClick={() => setRulesOpen(false)} aria-label="Close rules">×</button>
            <span className="sheetEyebrow">Table rules</span>
            <h2 id="rules-title">Blackjack, kept classic.</h2>
            <p>Get closer to 21 than the dealer without going over. Face cards count as 10; aces count as 1 or 11.</p>
            <dl>
              <div><dt>Blackjack</dt><dd>Pays 3:2</dd></div>
              <div><dt>Dealer</dt><dd>Stands on all 17s</dd></div>
              <div><dt>Shoe</dt><dd>{DECK_COUNT} decks; cut card 55–75% through</dd></div>
              <div><dt>Double</dt><dd>Any first two cards</dd></div>
              <div><dt>Split</dt><dd>Equal values; all 10-value cards match</dd></div>
              <div><dt>Surrender</dt><dd>Late; half the main bet returned</dd></div>
              <div><dt>Insurance</dt><dd>Not offered</dd></div>
            </dl>
            <div className="sidePaytables">
              <h3>Side bet paytables</h3>
              <div>
                <strong>Perfect Pairs</strong>
                <span>Mixed 5:1 · Colored 10:1 · Perfect 25:1</span>
              </div>
              <div>
                <strong>21 + 3</strong>
                <span>Flush 5:1 · Straight 10:1 · Trips 30:1 · Straight flush 40:1 · Suited trips 100:1</span>
              </div>
              <div>
                <strong>Match the Dealer</strong>
                <span>Rank match 4:1 · Suited match 11:1. Each opening card can match.</span>
              </div>
            </div>
            <p className="practiceNote">Practice tokens have no cash value.</p>
          </section>
        </div>
      ) : null}
    </main>
  );
}
