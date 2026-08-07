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

export const DECK_COUNT = 6;
export const SHOE_SIZE = DECK_COUNT * 52;
export const MAX_SPLIT_HANDS = 5;

export type SideBetResult = {
  label: string;
  payout: number;
};

export type BasicStrategyMove = "Hit" | "Stand" | "Double" | "Split" | "Surrender";

export type BasicStrategyAdvice = {
  move: BasicStrategyMove;
  handLabel: string;
  explanation: string;
  fallback?: "Hit" | "Stand";
};

export function createShoe(decks = DECK_COUNT, random = Math.random): Card[] {
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

export function createCutPoint(totalCards = SHOE_SIZE, random = Math.random): number {
  // Place the cut card 55–80% of the way through the shoe.
  const penetration = 0.55 + random() * 0.25;
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

export function getBasicStrategyAdvice(
  cards: Card[],
  dealerUpCard: Card,
  options: {
    allowDouble?: boolean;
    allowSplit?: boolean;
    allowSurrender?: boolean;
  } = {},
): BasicStrategyAdvice {
  const dealerValue = dealerUpCard.rank === "A"
    ? 11
    : ["10", "J", "Q", "K"].includes(dealerUpCard.rank)
      ? 10
      : Number(dealerUpCard.rank);
  const dealerLabel = dealerUpCard.rank;
  const score = scoreHand(cards);
  const allowDouble = options.allowDouble ?? cards.length === 2;
  const allowSplit = options.allowSplit ?? canSplit(cards);
  const allowSurrender = options.allowSurrender ?? cards.length === 2;
  const pairValue = canSplit(cards)
    ? cards[0].rank === "A"
      ? 11
      : ["10", "J", "Q", "K"].includes(cards[0].rank)
        ? 10
        : Number(cards[0].rank)
    : null;
  const handLabel = pairValue !== null
    ? `Pair of ${pairValue === 11 ? "aces" : pairValue === 10 ? "tens" : `${pairValue}s`}`
    : `${score.isSoft ? "Soft" : "Hard"} ${score.total}`;
  const advice = (
    move: BasicStrategyMove,
    explanation: string,
    fallback?: "Hit" | "Stand",
  ): BasicStrategyAdvice => ({ move, handLabel, explanation, fallback });

  // Six-deck S17 late-surrender exceptions. A pair of eights is still split.
  if (
    allowSurrender &&
    pairValue !== 8 &&
    ((score.total === 16 && [9, 10, 11].includes(dealerValue)) ||
      (score.total === 15 && dealerValue === 10))
  ) {
    return advice(
      "Surrender",
      `${handLabel} gives up less expected value against dealer ${dealerLabel}.`,
      "Hit",
    );
  }

  if (pairValue !== null && allowSplit) {
    if (pairValue === 11 || pairValue === 8) {
      return advice("Split", `${handLabel} should always be split under these table rules.`);
    }
    if (pairValue === 10) {
      return advice("Stand", `Keep a made 20 together against dealer ${dealerLabel}.`);
    }
    if (pairValue === 9) {
      return [2, 3, 4, 5, 6, 8, 9].includes(dealerValue)
        ? advice("Split", `${handLabel} gains more value as two hands against dealer ${dealerLabel}.`)
        : advice("Stand", `Keep 18 together against dealer ${dealerLabel}.`);
    }
    if (pairValue === 7) {
      return dealerValue <= 7
        ? advice("Split", `${handLabel} is favored to split against dealer ${dealerLabel}.`)
        : advice("Hit", `Dealer ${dealerLabel} is too strong for splitting sevens.`);
    }
    if (pairValue === 6) {
      return dealerValue >= 2 && dealerValue <= 6
        ? advice("Split", `${handLabel} is favored to split against dealer ${dealerLabel}.`)
        : advice("Hit", `Play the hand as a hard 12 against dealer ${dealerLabel}.`);
    }
    if (pairValue === 4) {
      return [5, 6].includes(dealerValue)
        ? advice("Split", `Double-after-split makes this split profitable against dealer ${dealerLabel}.`)
        : advice("Hit", `Play the hand as a hard 8 against dealer ${dealerLabel}.`);
    }
    if (pairValue === 3 || pairValue === 2) {
      return dealerValue >= 2 && dealerValue <= 7
        ? advice("Split", `${handLabel} is favored to split against dealer ${dealerLabel}.`)
        : advice("Hit", `Dealer ${dealerLabel} is too strong for this split.`);
    }
    // Pair of fives follows hard-10 strategy.
  }

  if (pairValue === 11) {
    return advice("Hit", "With splitting unavailable, draw to the pair of aces.");
  }

  if (score.isSoft) {
    if (score.total >= 19) {
      return advice("Stand", `${handLabel} is already strong against dealer ${dealerLabel}.`);
    }
    if (score.total === 18) {
      if (dealerValue >= 3 && dealerValue <= 6 && allowDouble) {
        return advice("Double", `${handLabel} has a doubling edge against dealer ${dealerLabel}.`, "Stand");
      }
      return [2, 7, 8].includes(dealerValue)
        ? advice("Stand", `${handLabel} is strong enough to stand against dealer ${dealerLabel}.`)
        : advice("Hit", `Improve ${handLabel.toLowerCase()} against dealer ${dealerLabel}.`);
    }
    const doubleRange = score.total === 17
      ? [3, 4, 5, 6]
      : score.total === 16 || score.total === 15
        ? [4, 5, 6]
        : [5, 6];
    if (doubleRange.includes(dealerValue) && allowDouble) {
      return advice("Double", `${handLabel} has a doubling edge against dealer ${dealerLabel}.`, "Hit");
    }
    return advice("Hit", `Improve ${handLabel.toLowerCase()} against dealer ${dealerLabel}.`);
  }

  if (score.total >= 17) {
    return advice("Stand", `${handLabel} is strong enough to stand against dealer ${dealerLabel}.`);
  }
  if (score.total >= 13) {
    return dealerValue <= 6
      ? advice("Stand", `Let dealer ${dealerLabel} draw into a possible bust.`)
      : advice("Hit", `${handLabel} needs improvement against dealer ${dealerLabel}.`);
  }
  if (score.total === 12) {
    return dealerValue >= 4 && dealerValue <= 6
      ? advice("Stand", `Let dealer ${dealerLabel} draw into a possible bust.`)
      : advice("Hit", `Hit hard 12 against dealer ${dealerLabel}.`);
  }
  if (score.total === 11) {
    return dealerValue <= 10 && allowDouble
      ? advice("Double", `Hard 11 has a strong doubling edge against dealer ${dealerLabel}.`, "Hit")
      : advice("Hit", `Hit hard 11 against dealer ${dealerLabel}.`);
  }
  if (score.total === 10) {
    return dealerValue >= 2 && dealerValue <= 9 && allowDouble
      ? advice("Double", `Hard 10 has a doubling edge against dealer ${dealerLabel}.`, "Hit")
      : advice("Hit", `Hit hard 10 against dealer ${dealerLabel}.`);
  }
  if (score.total === 9) {
    return dealerValue >= 3 && dealerValue <= 6 && allowDouble
      ? advice("Double", `Hard 9 has a doubling edge against dealer ${dealerLabel}.`, "Hit")
      : advice("Hit", `Hit hard 9 against dealer ${dealerLabel}.`);
  }
  return advice("Hit", `${handLabel} should draw against dealer ${dealerLabel}.`);
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
