export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export type Card = {
  id: string;
  suit: Suit;
  rank: Rank;
};

export type HandScore = {
  total: number;
  isSoft: boolean;
};

export type SideBetResult = {
  label: string;
  payout: number;
};

export function createShoe(decks = 4, random = Math.random): Card[] {
  const cards: Card[] = [];

  for (let deck = 0; deck < decks; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ id: `${deck}-${suit}-${rank}`, suit, rank });
      }
    }
  }

  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }

  return cards;
}

export function createCutPoint(totalCards = 208, random = Math.random): number {
  // Place the cut card 55–75% of the way through the shoe.
  const penetration = 0.55 + random() * 0.2;
  return Math.floor(totalCards * (1 - penetration));
}

export function scoreHand(cards: Card[]): HandScore {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    if (card.rank === "A") {
      aces += 1;
      total += 11;
    } else if (["K", "Q", "J"].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return { total, isSoft: aces > 0 };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && scoreHand(cards).total === 21;
}

export function canSplit(cards: Card[]): boolean {
  if (cards.length !== 2) return false;
  const splitValue = (card: Card) =>
    ["10", "J", "Q", "K"].includes(card.rank) ? 10 : card.rank;
  return splitValue(cards[0]) === splitValue(cards[1]);
}

export function scorePerfectPairs(cards: Card[]): SideBetResult | null {
  if (cards.length !== 2 || cards[0].rank !== cards[1].rank) return null;

  if (cards[0].suit === cards[1].suit) {
    return { label: "Perfect pair", payout: 25 };
  }

  const redSuits: Suit[] = ["hearts", "diamonds"];
  const sameColor = redSuits.includes(cards[0].suit) === redSuits.includes(cards[1].suit);
  return sameColor
    ? { label: "Colored pair", payout: 10 }
    : { label: "Mixed pair", payout: 5 };
}

export function scoreTwentyOnePlusThree(cards: Card[]): SideBetResult | null {
  if (cards.length !== 3) return null;

  const rankValues = cards.map((card) => {
    if (card.rank === "A") return 14;
    if (card.rank === "K") return 13;
    if (card.rank === "Q") return 12;
    if (card.rank === "J") return 11;
    return Number(card.rank);
  });
  const sortedRanks = [...new Set(rankValues)].sort((a, b) => a - b);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const trips = cards.every((card) => card.rank === cards[0].rank);
  const straight =
    sortedRanks.length === 3 &&
    (sortedRanks[2] - sortedRanks[0] === 2 || sortedRanks.join(",") === "2,3,14");

  if (trips && flush) return { label: "Suited trips", payout: 100 };
  if (straight && flush) return { label: "Straight flush", payout: 40 };
  if (trips) return { label: "Three of a kind", payout: 30 };
  if (straight) return { label: "Straight", payout: 10 };
  if (flush) return { label: "Flush", payout: 5 };
  return null;
}

export function scoreMatchDealer(
  playerCards: Card[],
  dealerUpCard: Card,
): SideBetResult | null {
  const matches = playerCards.filter((card) => card.rank === dealerUpCard.rank);
  if (!matches.length) return null;

  const suitedMatches = matches.filter((card) => card.suit === dealerUpCard.suit).length;
  const unsuitedMatches = matches.length - suitedMatches;
  const payout = suitedMatches * 11 + unsuitedMatches * 4;
  const label =
    matches.length === 2
      ? suitedMatches === 2
        ? "Two suited matches"
        : suitedMatches === 1
          ? "Suited + rank match"
          : "Two rank matches"
      : suitedMatches === 1
        ? "Suited match"
        : "Rank match";

  return { label, payout };
}

export function dealerShouldHit(cards: Card[]): boolean {
  return scoreHand(cards).total < 17;
}

export function playDealer(
  startingCards: Card[],
  startingShoe: Card[],
): { cards: Card[]; shoe: Card[] } {
  const cards = [...startingCards];
  const shoe = [...startingShoe];

  while (dealerShouldHit(cards)) {
    const card = shoe.pop();
    if (!card) break;
    cards.push(card);
  }

  return { cards, shoe };
}
