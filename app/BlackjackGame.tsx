"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  canSplit,
  Card as CardType,
  createCutPoint,
  createShoe,
  dealerShouldHit,
  isBlackjack,
  playDealer,
  scoreHand,
  scoreMatchDealer,
  scorePerfectPairs,
  scoreTwentyOnePlusThree,
} from "../lib/blackjack";

type Phase = "betting" | "dealing" | "playing" | "dealerTurn" | "settled" | "shuffling";
type HandStatus = "active" | "standing" | "busted" | "won" | "lost" | "push" | "surrendered";
type SideBetKey = "perfectPairs" | "twentyOnePlusThree" | "matchDealer";
type SideBets = Record<SideBetKey, number>;

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
  sideResults: SideBetOutcome[];
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
const RESET_BALANCE = 1000;
const LOWEST_TABLE_MINIMUM = TABLES[0].minimum;
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

const DEAL_DELAY = 330;

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
}: {
  card?: CardType;
  hidden?: boolean;
  revealed?: boolean;
}) {
  if (hidden || !card) {
    return (
      <div className="playingCard cardBack" aria-label="Face-down card">
        <span className="backFrame">
          <span>DE</span>
        </span>
      </div>
    );
  }

  const isRed = card.suit === "hearts" || card.suit === "diamonds";
  const mark = SUIT_MARKS[card.suit];
  return (
    <div className={`playingCard cardFace ${isRed ? "redCard" : "blackCard"} ${revealed ? "cardReveal" : ""}`}>
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
  const chips: Array<{ value: number; tone: number }> = [];
  let remaining = amount;

  for (const denomination of [...denominations].reverse()) {
    const count = Math.floor(remaining / denomination);
    const visibleCount = Math.min(count, 3);
    const tone = denominations.indexOf(denomination) + 1;
    for (let index = 0; index < visibleCount; index += 1) {
      chips.push({ value: denomination, tone });
    }
    remaining -= count * denomination;
  }

  return (
    <span className={`wagerPile ${chips.length ? "hasChips" : ""}`} aria-hidden="true">
      {chips.slice(0, 9).map((chip, index) => (
        <i
          className={`wagerChipToken wagerChipTone${chip.tone}`}
          style={{ "--chip-index": index } as CSSProperties}
          key={`${chip.value}-${index}`}
        >
          <b>{tokenAmount(chip.value)}</b>
        </i>
      ))}
    </span>
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
  const gameRef = useRef<GameState | null>(null);
  const soundEnabledRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeRoomCode = roomSession?.code;
  const gameBankroll = game?.bankroll;
  const selectedTable = TABLES.find((table) => table.id === selectedTableId) ?? TABLES[0];
  const sideBetValues = [0, selectedTable.minimum / 2, selectedTable.minimum, selectedTable.minimum * 2];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const cachedBalance = Number(window.localStorage.getItem(WALLET_KEY));
      const startingBalance =
        Number.isFinite(cachedBalance) && cachedBalance >= LOWEST_TABLE_MINIMUM
          ? cachedBalance
          : RESET_BALANCE;
      setWallet(startingBalance);
      window.localStorage.setItem(WALLET_KEY, String(startingBalance));
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
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

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

  const playCardSound = useCallback((kind: "deal" | "flip" | "win" | "blackjack" | "lose" | "shuffle") => {
    if (!soundEnabledRef.current || typeof window === "undefined") return;

    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    if (context.state === "suspended") void context.resume();

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

    if (kind === "lose") {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(210, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(62, context.currentTime + 0.34);
      gain.gain.setValueAtTime(0.07, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.36);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.37);
      return;
    }

    const duration = kind === "shuffle" ? 0.72 : kind === "flip" ? 0.09 : 0.075;
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
    filter.frequency.value = kind === "shuffle" ? 820 : kind === "flip" ? 2100 : 1150;
    filter.Q.value = kind === "flip" ? 0.8 : 0.55;
    gain.gain.setValueAtTime(
      kind === "shuffle" ? 0.13 : kind === "flip" ? 0.11 : 0.085,
      context.currentTime,
    );
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start();
  }, []);

  const dealerSequenceKey = game?.phase === "dealerTurn" ? game.round : null;

  useEffect(() => {
    if (dealerSequenceKey === null) return;
    const startingState = gameRef.current;
    if (!startingState || startingState.phase !== "dealerTurn") return;

    let cancelled = false;

    async function playDealerSequence() {
      playCardSound("flip");
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
        dealer.push(draw(shoe));
        playCardSound("deal");
        setGame((current) =>
          current?.phase === "dealerTurn" && current.round === dealerSequenceKey
            ? { ...current, dealer: [...dealer], shoe: [...shoe], message: "Dealer draws" }
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
      game.hands.length === 1 &&
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
  const shoePercent = useMemo(
    () => (game ? Math.max(4, (game.shoe.length / 208) * 100) : 100),
    [game],
  );
  const cutCardReached = Boolean(game && game.shoe.length <= game.cutPoint);
  const roomPlayer = roomSession?.room.players.find(
    (player) => player.id === roomSession.seatId,
  );
  const roomActiveHand = roomPlayer?.hands[roomPlayer.activeHand];
  const isRoomHost = Boolean(roomSession && roomSession.room.hostId === roomSession.seatId);
  const isRoomTurn = Boolean(
    roomSession && roomSession.room.currentPlayerId === roomSession.seatId,
  );

  function startSession() {
    if (wallet < selectedTable.minimum) {
      playCardSound("lose");
      setHomeNotice(
        `${selectedTable.name} requires ${tokenAmount(selectedTable.minimum)} tokens. Your balance is ${tokenAmount(wallet)}.`,
      );
      return;
    }
    setHomeNotice("");
    const startingBalance =
      wallet >= LOWEST_TABLE_MINIMUM ? wallet : RESET_BALANCE;
    setGame({
      bankroll: startingBalance,
      startingBankroll: startingBalance,
      currentBet: selectedTable.minimum,
      sideBets: { ...EMPTY_SIDE_BETS },
      sideResults: [],
      shoe: createShoe(4),
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
    setGame((current) => {
      if (!current || current.phase !== "betting") return current;
      const nextBet = current.currentBet + amount;
      if (nextBet + sideBetStake(current.sideBets) > current.bankroll || nextBet < 0) return current;
      return { ...current, currentBet: nextBet };
    });
  }

  function cycleSideBet(key: SideBetKey) {
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

    const shoe = current.shoe.length < 4 ? createShoe(4) : [...current.shoe];
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
      sideResults: [],
      hands: [{ cards: [], bet, status: "active" }],
      activeHand: 0,
      phase: "dealing",
      message: "Cards coming out",
      tone: "neutral",
    });

    const dealSteps: Array<{ recipient: "player" | "dealer"; card: CardType }> = [
      { recipient: "player", card: playerCards[0] },
      { recipient: "dealer", card: dealerCards[0] },
      { recipient: "player", card: playerCards[1] },
      { recipient: "dealer", card: dealerCards[1] },
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
              hands: [{ ...latest.hands[0], cards: [...latest.hands[0].cards, step.card] }],
            }
          : { ...latest, dealer: [...latest.dealer, step.card] };
      });
    }

    await pause(360);
    const playerNatural = isBlackjack(playerCards);
    const dealerNatural = isBlackjack(dealerCards);
    if (playerNatural || dealerNatural) playCardSound("flip");
    if (playerNatural && !dealerNatural) {
      window.setTimeout(() => playCardSound("blackjack"), 180);
    } else if (sideBetResult.outcomes.some((outcome) => outcome.won)) {
      window.setTimeout(() => playCardSound("win"), 180);
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
          sideResults: sideBetResult.outcomes,
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
        sideResults: sideBetResult.outcomes,
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
      const hands = current.hands.map((hand, index) =>
        index === current.activeHand
          ? { ...hand, cards: [...hand.cards, draw(shoe)] }
          : hand,
      );
      const total = scoreHand(hands[current.activeHand].cards).total;
      if (total > 21) window.setTimeout(() => playCardSound("lose"), 110);
      const next = {
        ...current,
        shoe,
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
      const hands = current.hands.map((candidate, index) => {
        if (index !== current.activeHand) return candidate;
        const cards = [...candidate.cards, draw(shoe)];
        const busted = scoreHand(cards).total > 21;
        if (busted) window.setTimeout(() => playCardSound("lose"), 110);
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
      if (current.hands.length !== 1 || !canSplit(original.cards)) {
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
      const firstCards = [original.cards[0], draw(shoe)];
      const secondCards = [original.cards[1], draw(shoe)];
      const splitAces = original.cards[0].rank === "A";
      const hands: PlayerHand[] = [firstCards, secondCards].map((cards) => ({
        cards,
        bet: original.bet,
        status:
          splitAces || scoreHand(cards).total === 21
            ? ("standing" as const)
            : ("active" as const),
      }));
      const firstActive = hands.findIndex((hand) => hand.status === "active");
      const next = {
        ...current,
        bankroll: current.bankroll - original.bet,
        shoe,
        hands,
        activeHand: Math.max(0, firstActive),
        message: splitAces
          ? "Split aces receive one card each"
          : `Playing hand ${Math.max(0, firstActive) + 1}`,
        tone: "neutral" as const,
      };

      return firstActive === -1 ? advanceOrSettle(next) : next;
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
        sideResults: [],
        phase: "shuffling",
        message: "Cut card reached — shuffling four decks",
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
          shoe: createShoe(4),
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
        sideResults: [],
        dealer: [],
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

  function openRoom(mode: "create" | "join") {
    setRoomMode(mode);
    setRoomError("");
    setRoomCode("");
    setRoomPasscode("");
  }

  async function submitRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomMode || roomBusy) return;
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
          ...(roomMode === "create" ? { tableId: selectedTable.id } : {}),
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
      <header className="topBar">
        <button
          className="brand"
          type="button"
          onClick={() => {
            if (roomSession) setRoomSession(null);
            else if (game) setGame(null);
          }}
          aria-label={game || roomSession ? "Leave table" : "Dealer's Edge home"}
        >
          <span className="brandMark"><span>◆</span></span>
          <span className="brandWords">
            <strong>Dealer’s Edge</strong>
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
            onClick={() => setSoundEnabled((enabled) => !enabled)}
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
                <PlayingCard card={card ?? undefined} hidden={!card} key={card?.id ?? `hole-${index}`} />
              )) : <div className="emptyDealerMark"><span>◆</span></div>}
            </div>
          </div>

          <div className="roomGameMessage">{roomSession.room.message}</div>

          <div className="roomPlayerRail">
            {roomSession.room.players.map((player) => (
              <article
                className={`roomPlayerHand ${player.id === roomSession.room.currentPlayerId ? "active" : ""} ${player.id === roomSession.seatId ? "current" : ""}`}
                key={player.id}
              >
                <header>
                  <strong>{player.name}{player.id === roomSession.seatId ? " (you)" : ""}</strong>
                  <span>◎ {tokenAmount(player.bankroll)}</span>
                </header>
                {player.hands.length ? (
                  <div className="roomHands">
                    {player.hands.map((hand, handIndex) => (
                      <div className="roomHand" key={handIndex}>
                        <div className="miniCardFan">
                          {hand.cards.map((card) => <PlayingCard card={card} key={card.id} />)}
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
            ))}
          </div>

          <div className="roomGameControls">
            {roomSession.room.phase === "betting" ? (
              roomPlayer?.bet ? (
                <strong>Bet placed — waiting for the table</strong>
              ) : (
                <>
                  <div className="roomWagerPicker">
                    <button type="button" onClick={() => setRoomWager(roomSession.room.table.minimum)}>Clear</button>
                    {roomSession.room.table.chips.map((chip) => (
                      <button
                        type="button"
                        key={chip}
                        onClick={() => setRoomWager((wager) => Math.min((roomPlayer?.bankroll ?? 0), wager + chip))}
                      >
                        +{tokenAmount(chip)}
                      </button>
                    ))}
                  </div>
                  <button
                    className="dealButton"
                    type="button"
                    onClick={() => sendRoomAction("bet", roomWager)}
                    disabled={roomBusy || roomWager > (roomPlayer?.bankroll ?? 0)}
                  >
                    Bet {tokenAmount(roomWager)}
                  </button>
                </>
              )
            ) : roomSession.room.phase === "playing" ? (
              isRoomTurn ? (
                <div className="playControls roomPlayControls">
                  <button type="button" onClick={() => sendRoomAction("stand")}><small>S</small><span>Stand</span></button>
                  <button className="primaryAction" type="button" onClick={() => sendRoomAction("hit")}><small>H</small><span>Hit</span></button>
                  <button type="button" onClick={() => sendRoomAction("double")} disabled={!roomActiveHand || roomActiveHand.cards.length !== 2 || (roomPlayer?.bankroll ?? 0) < (roomActiveHand?.bet ?? 0)}><small>2×</small><span>Double</span></button>
                  <button type="button" onClick={() => sendRoomAction("split")} disabled={!roomActiveHand || !canSplit(roomActiveHand.cards) || (roomPlayer?.bankroll ?? 0) < (roomActiveHand?.bet ?? 0)}><small>Ⅱ</small><span>Split</span></button>
                  <button type="button" onClick={() => sendRoomAction("surrender")} disabled={!roomActiveHand || roomActiveHand.cards.length !== 2}><small>½</small><span>Surrender</span></button>
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
          <div className="welcomeEyebrow"><span /> Private four-deck table</div>
          <div className="welcomeMark" aria-hidden="true">♠</div>
          <h1>Play your hand.</h1>
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
                  onClick={() => setSelectedTableId(table.id)}
                >
                  <span className="stakeTableHeading">
                    <strong>{table.name}</strong>
                    <small>Minimum {tokenAmount(table.minimum)}</small>
                  </span>
                  <span className="stakeChips">
                    {table.chips.map((value, index) => (
                      <i className={`stakeChip stakeChip${index + 1}`} key={value}>{tokenAmount(value)}</i>
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
            <span><b>4</b> deck shoe</span>
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
        </section>
      ) : (
        <section className="tableScreen">
          <div className="tableRail" aria-hidden="true" />
          <div className="tableMeta">
            <div className="shoeLabel">
              <DeckIcon />
              <span><strong>Four deck shoe</strong><small>{game.shoe.length} cards remain</small></span>
              <i>
                <b style={{ width: `${shoePercent}%` }} />
                <em
                  className={cutCardReached ? "reached" : ""}
                  style={{ left: `${(game.cutPoint / 208) * 100}%` }}
                  title="Cut card"
                />
              </i>
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
            {game.sideResults.length ? (
              <div className="sideResults">
                {game.sideResults.map((result) => (
                  <span className={result.won ? "hit" : "miss"} key={result.name}>
                    <b>{result.name}</b> {result.detail}
                  </span>
                ))}
              </div>
            ) : null}
            {cutCardReached ? (
              <div className="cutCardAlert">
                <i /> Cut card reached — shuffle after this hand
              </div>
            ) : null}
          </div>

          <div className={`playerZone ${game.hands.length > 1 ? "splitHands" : ""}`}>
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
                    {hand.cards.map((card) => <PlayingCard card={card} key={card.id} />)}
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
                  {selectedTable.chips.map((value, index) => (
                    <button
                      type="button"
                      key={value}
                      className={`betChip betChipTone${index + 1}`}
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
                  onClick={game.bankroll >= selectedTable.minimum ? dealRound : () => setGame(null)}
                  disabled={
                    game.bankroll >= selectedTable.minimum &&
                    game.currentBet < selectedTable.minimum
                  }
                >
                  {game.bankroll >= selectedTable.minimum ? "Deal cards" : "Reset to 1,000"}<span>→</span>
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
                      ? "Shuffling four decks"
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
                <button className="dealButton" type="button" onClick={nextRound}>
                  {cutCardReached ? "Shuffle shoe" : "Next hand"} <span>→</span>
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
              <div><dt>Shoe</dt><dd>4 decks; cut card 55–75% through</dd></div>
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
