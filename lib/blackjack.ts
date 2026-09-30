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
export type GameMode = "classic" | "doubleDownMadness" | "freeBet" | "breakout";
export type BreakoutBet = "player" | "dealer" | "tie";
export const OPENING_SIDE_BET_KEYS = ["perfectPairs", "twentyOnePlusThree", "matchDealer", "topThree"] as const;
export type OpeningSideBetKey = (typeof OPENING_SIDE_BET_KEYS)[number];
export type SideBetKey = OpeningSideBetKey | "dealerBust" | "breakoutBonus";
export type SideBets = Record<SideBetKey, number>;
export const EMPTY_SIDE_BETS: SideBets = {
  perfectPairs: 0,
  twentyOnePlusThree: 0,
  matchDealer: 0,
  topThree: 0,
  dealerBust: 0,
  breakoutBonus: 0,
};
export const SIDE_BET_LABELS: Record<SideBetKey, { name: string; short: string }> = {
  perfectPairs: { name: "Perfect Pairs", short: "Pairs" },
  twentyOnePlusThree: { name: "21 + 3", short: "21 + 3" },
  matchDealer: { name: "Match the Dealer", short: "Match" },
  topThree: { name: "Top 3", short: "Top 3" },
  dealerBust: { name: "Dealer Bust", short: "Bust" },
  breakoutBonus: { name: "Breakout Bonus", short: "Bonus" },
};

export const BUST_PHRASES = [
  "Better luck next time, buddy!",
  "So embarrassing.",
  "The dealer says thanks.",
  "That was a bold way to find 22.",
  "Maybe the next card will apologize.",
  "The shoe had other plans.",
  "The dealer didn't even have to try.",
  "You really showed that deck who's boss.",
  "A daring strategy. Brief, too.",
  "The table appreciates your generosity.",
  "That hand had a promising five seconds.",
  "You found the one card you didn't need.",
  "The cards are laughing quietly.",
  "Well, that escalated past 21.",
  "The dealer sends a thank-you note.",
  "Bold move. The math disagrees.",
  "Your chips had a nice visit.",
  "That's one way to end a hand early.",
  "The deck saw you coming.",
  "A spectacular exit, if nothing else.",
  "Maybe ask the cards to be nicer next time.",
  "That hit came with a plot twist.",
  "The dealer is trying not to smile.",
  "The shoe says you're welcome.",
  "You and 21 were never that close.",
  "At least the suspense is over.",
];

export function isValidTokenBalance(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && Number.isSafeInteger(value * 2);
}

export function bustPhrase(random = Math.random) {
  return BUST_PHRASES[Math.floor(random() * BUST_PHRASES.length)];
}

export function createBurnedShoe(decks = DECK_COUNT, random = Math.random) {
  const shoe = createShoe(decks, random);
  const burnedCard = shoe.pop()!;
  return { shoe, burnedCard };
}

export function isFreeDouble(cards: Card[]): boolean {
  if (cards.length !== 2) return false;
  const score = scoreHand(cards);
  return !score.isSoft && score.total >= 9 && score.total <= 11;
}

export function isFreeSplit(cards: Card[]): boolean {
  return canSplit(cards) && !["10", "J", "Q", "K"].includes(cards[0].rank);
}

export type SideBetResult = {
  label: string;
  payout: number;
};

export type SideBetOutcome = {
  name: string;
  detail: string;
  won: boolean;
  stake: number;
  profit: number;
};

export type BasicStrategyMove = "Hit" | "Stand" | "Double" | "Free double" | "Split" | "Free split" | "Surrender";

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
  // Place the cut card 55–90% of the way through the shoe.
  const penetration = 0.55 + random() * 0.35;
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

function strategyDealerValue(card: Card): number {
  return card.rank === "A" ? 11 : ["10", "J", "Q", "K"].includes(card.rank) ? 10 : Number(card.rank);
}

function strategyHandLabel(cards: Card[]): string {
  if (canSplit(cards)) {
    const rank = cards[0].rank;
    const value = rank === "A" ? "aces" : ["10", "J", "Q", "K"].includes(rank) ? "tens" : `${rank}s`;
    return `Pair of ${value}`;
  }
  const score = scoreHand(cards);
  return `${score.isSoft ? "Soft" : "Hard"} ${score.total}`;
}

const STRATEGY_DEALER_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

// Michael Shackleford's six-deck, H17, push-22 Double Down Madness strategy.
// https://wizardofodds.com/games/blackjack/double-down-madness/
const MADNESS_HARD: Record<number, string> = {
  2: "HHHHDDHHHH", 3: "HHHHDHHHHH", 8: "HHHDDDHHHH",
  9: "HDDDDDDHHH", 10: "DDDDDDDDHH", 11: "DDDDDDDDDD",
  12: "HHHSSHHHHH", 13: "HSSSSHHHHH",
};
const MADNESS_SOFT: Record<number, string> = {
  12: "HDDDDDDHHH", 13: "HHDDDDHHHH", 14: "HHHDDDHHHH",
  15: "HHHHDHHHHH", 16: "HHHHDHHHHH", 17: "HHHHDDHHHH",
  18: "SSSDDSSHHH",
};

export function getDoubleDownMadnessStrategyAdvice(
  cards: Card[],
  dealerUpCard: Card,
  allowDouble: boolean,
): BasicStrategyAdvice {
  const dealer = strategyDealerValue(dealerUpCard);
  const score = scoreHand(cards);
  const handLabel = strategyHandLabel(cards);
  const dealerIndex = STRATEGY_DEALER_VALUES.indexOf(dealer as (typeof STRATEGY_DEALER_VALUES)[number]);
  let cell: string;

  if (cards.length === 1 && ["10", "J", "Q", "K"].includes(cards[0].rank)) {
    cell = "D";
  } else if (cards.length === 1 && cards[0].rank === "A") {
    cell = dealer === 11 ? "H" : "D";
  } else if (score.isSoft) {
    cell = score.total >= 19 ? "S" : MADNESS_SOFT[score.total]?.[dealerIndex] ?? "H";
  } else {
    cell = score.total >= 17 ? "S" : score.total >= 14
      ? dealer <= 6 ? "S" : "H"
      : MADNESS_HARD[score.total]?.[dealerIndex] ?? "H";
  }

  if (cell === "D" && allowDouble) {
    const singleAce = cards.length === 1 && cards[0].rank === "A";
    return {
      move: "Double", handLabel,
      explanation: singleAce
        ? `Double the opening ace against dealer ${dealerUpCard.rank}. You will receive exactly one more card.`
        : `Doubling ${handLabel.toLowerCase()} has the stronger return against dealer ${dealerUpCard.rank}; you can keep playing after the draw.`,
      fallback: score.isSoft && score.total === 18 ? "Stand" : "Hit",
    };
  }
  if (cell === "D") {
    const fallback = score.isSoft && score.total === 18 ? "Stand" : "Hit";
    return { move: fallback, handLabel, explanation: `Doubling is unavailable with this balance. ${fallback} against dealer ${dealerUpCard.rank}.` };
  }
  if (cell === "S") {
    return { move: "Stand", handLabel, explanation: `Stand against dealer ${dealerUpCard.rank}; dealer 22 pushes rather than paying this hand.` };
  }
  return {
    move: "Hit", handLabel,
    explanation: cards.length === 1 && cards[0].rank === "A"
      ? "Hit the opening ace against a dealer ace. This draw ends your hand."
      : `Draw against dealer ${dealerUpCard.rank}; you can decide again after the card arrives.`,
  };
}

// Wizard of Odds charts for a paid hand, a free split hand, and pairs.
// https://wizardofodds.com/games/free-bet-blackjack/
const FREE_BET_PAID_HARD: Record<number, string> = {
  12: "HHHSSHHHHH", 13: "HSSSSHHHHH", 14: "SSSSSHHHHH",
  15: "SSSSSHHHRR", 16: "SSSSSHHRRR", 17: "SSSSSSSSST",
};
const FREE_BET_FREE_HARD: Record<number, string> = {
  12: "HHHSSHHHHH", 13: "HSSSSHHHHH", 14: "HSSSSHHHHH",
  15: "SSSSSHHHHH", 16: "SSSSSHHHHH", 17: "SSSSSHHHSH",
};
const FREE_BET_PAID_SOFT: Record<number, string> = {
  16: "HHHHDHHHHH", 17: "HHHDDHHHHH", 18: "SSSDDSSHHH",
};
const FREE_BET_FREE_SOFT: Record<number, string> = {
  16: "HHHHDHHHHH", 17: "HHHDDHHHHH", 18: "HHDDDSHHHH",
  19: "SSSDDSSSSS", 20: "SSSSDSSSSS",
};

export function getFreeBetStrategyAdvice(
  cards: Card[],
  dealerUpCard: Card,
  options: { allowDouble: boolean; allowSplit: boolean; allowSurrender: boolean; isFreeHand: boolean },
): BasicStrategyAdvice {
  const dealer = strategyDealerValue(dealerUpCard);
  const dealerIndex = STRATEGY_DEALER_VALUES.indexOf(dealer as (typeof STRATEGY_DEALER_VALUES)[number]);
  const score = scoreHand(cards);
  const handLabel = strategyHandLabel(cards);
  const dealerLabel = dealerUpCard.rank;

  if (cards.length === 2 && options.allowSplit && isFreeSplit(cards) && cards[0].rank !== "5") {
    return {
      move: "Free split", handLabel,
      explanation: `Split ${handLabel.toLowerCase()} against dealer ${dealerLabel}; the added hand is covered by a free wager.`,
    };
  }
  if (isFreeDouble(cards) && options.allowDouble) {
    return {
      move: "Free double", handLabel,
      explanation: `Take the free double against dealer ${dealerLabel}. The extra wager is covered, and you receive one card.`,
    };
  }

  let cell: string;
  if (score.isSoft) {
    cell = score.total >= (options.isFreeHand ? 21 : 19)
      ? "S"
      : (options.isFreeHand ? FREE_BET_FREE_SOFT : FREE_BET_PAID_SOFT)[score.total]?.[dealerIndex] ?? "H";
  } else {
    cell = score.total >= 18 ? "S" : score.total <= 11 ? "H"
      : (options.isFreeHand ? FREE_BET_FREE_HARD : FREE_BET_PAID_HARD)[score.total]?.[dealerIndex] ?? "H";
  }

  if ((cell === "R" || cell === "T") && options.allowSurrender) {
    return {
      move: "Surrender", handLabel,
      explanation: `Surrender ${handLabel.toLowerCase()} against dealer ${dealerLabel} to recover half of the paid wager.`,
      fallback: cell === "T" ? "Stand" : "Hit",
    };
  }
  if (cell === "R" || cell === "T") cell = cell === "T" ? "S" : "H";
  if (cell === "D" && options.allowDouble) {
    return {
      move: "Double", handLabel,
      explanation: `A paid double has the best return for ${handLabel.toLowerCase()} against dealer ${dealerLabel}.`,
      fallback: score.total >= 19 || (!options.isFreeHand && score.total === 18) ? "Stand" : "Hit",
    };
  }
  if (cell === "D") cell = score.total >= 19 || (!options.isFreeHand && score.total === 18) ? "S" : "H";
  return cell === "S"
    ? { move: "Stand", handLabel, explanation: `Stand against dealer ${dealerLabel}, allowing for the dealer-22 push rule.` }
    : { move: "Hit", handLabel, explanation: `Draw against dealer ${dealerLabel}; the dealer-22 rule changes the value of standing.` };
}

export function scorePerfectPairs(cards: Card[]): SideBetResult | null {
  if (cards.length !== 2 || cards[0].rank !== cards[1].rank) return null;

  if (cards[0].suit === cards[1].suit) {
    return { label: "Perfect pair", payout: 25 };
  }

  const redSuits: Suit[] = ["hearts", "diamonds"];
  const sameColor = redSuits.includes(cards[0].suit) === redSuits.includes(cards[1].suit);
  return sameColor
    ? { label: "Colored pair", payout: 12 }
    : { label: "Mixed pair", payout: 6 };
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

export function scoreTopThree(cards: Card[]): SideBetResult | null {
  const result = scoreTwentyOnePlusThree(cards);
  if (!result) return null;
  if (result.label === "Suited trips") return { label: "Suited trips grand slam", payout: 270 };
  if (result.label === "Straight flush") return { label: "Straight flush", payout: 180 };
  if (result.label === "Three of a kind") return { label: "Three of a kind", payout: 90 };
  return null;
}

export function settleSideBets(
  playerCards: Card[],
  dealerUpCard: Card,
  sideBets: SideBets,
) {
  const results = {
    perfectPairs: scorePerfectPairs(playerCards),
    twentyOnePlusThree: scoreTwentyOnePlusThree([...playerCards, dealerUpCard]),
    matchDealer: scoreMatchDealer(playerCards, dealerUpCard),
    topThree: scoreTopThree([...playerCards, dealerUpCard]),
  };
  return OPENING_SIDE_BET_KEYS.reduce(
    (outcome, key) => {
      const wager = sideBets[key];
      if (!wager) return outcome;
      const result = results[key];
      if (result) outcome.payout += wager * (result.payout + 1);
      outcome.outcomes.push({
        name: SIDE_BET_LABELS[key].name,
        detail: result ? `${result.label} · ${result.payout}:1` : "No hit",
        won: Boolean(result),
        stake: wager,
        profit: result ? wager * result.payout : 0,
      });
      return outcome;
    },
    { payout: 0, outcomes: [] as SideBetOutcome[] },
  );
}

export function scoreDealerBust(dealerCards: Card[]): SideBetResult | null {
  if (scoreHand(dealerCards).total <= 21 || dealerCards.length < 3) return null;
  const count = dealerCards.length;
  const payout = count >= 7 ? 50 : count === 6 ? 8 : count === 5 ? 4 : 2;
  return { label: `${count}-card dealer bust`, payout };
}

export function scoreBreakoutBonus(playerCards: Card[], dealerCards: Card[]): SideBetResult | null {
  if (scoreHand(playerCards).total <= 21 || scoreHand(dealerCards).total <= 21) return null;
  const count = playerCards.length + dealerCards.length;
  const payout = count >= 12 ? 250 : count === 11 ? 150 : count === 10 ? 100
    : count === 9 ? 30 : count === 8 ? 15 : 5;
  return { label: `Both bust · ${count} cards`, payout };
}

export function settleFinalSideBets(
  playerCards: Card[],
  dealerCards: Card[],
  sideBets: SideBets,
) {
  const results = {
    dealerBust: scoreDealerBust(dealerCards),
    breakoutBonus: scoreBreakoutBonus(playerCards, dealerCards),
  };
  return (["dealerBust", "breakoutBonus"] as const).reduce(
    (outcome, key) => {
      const wager = sideBets[key];
      if (!wager) return outcome;
      const result = results[key];
      if (result) outcome.payout += wager * (result.payout + 1);
      outcome.outcomes.push({
        name: SIDE_BET_LABELS[key].name,
        detail: result ? `${result.label} · ${result.payout}:1` : "No hit",
        won: Boolean(result),
        stake: wager,
        profit: result ? wager * result.payout : 0,
      });
      return outcome;
    },
    { payout: 0, outcomes: [] as SideBetOutcome[] },
  );
}

export function dealerShouldHit(cards: Card[]): boolean {
  const score = scoreHand(cards);
  return score.total < 17 || (score.total === 17 && score.isSoft);
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

export type BreakoutSettlement = {
  status: "won" | "lost" | "push";
  result: string;
  payout: number;
  profit: number;
};

// Payout includes the original stake. Tie payouts follow the Super Tie paytable;
// dealer-win special pushes follow Breakout Blackjack's published rules.
export function settleBreakoutBet(
  playerCards: Card[],
  dealerCards: Card[],
  bet: BreakoutBet,
  stake: number,
): BreakoutSettlement {
  const playerTotal = scoreHand(playerCards).total;
  const dealerTotal = scoreHand(dealerCards).total;
  const playerBlackjack = isBlackjack(playerCards);
  const dealerBlackjack = isBlackjack(dealerCards);
  const bothBust = playerTotal > 21 && dealerTotal > 21;
  const sameTotal = playerTotal === dealerTotal && playerTotal <= 21;
  const outcome = playerBlackjack && dealerBlackjack ? "BLACKJACK TIE"
    : playerBlackjack ? "PLAYER BLACKJACK"
    : dealerBlackjack ? "DEALER BLACKJACK"
    : bothBust ? "BOTH BUST"
    : playerTotal > 21 ? "PLAYER BUST"
    : dealerTotal > 21 ? "DEALER BUST"
    : sameTotal ? `TIE ${playerTotal}`
    : playerTotal > dealerTotal ? "PLAYER WINS" : "DEALER WINS";

  let profit = -stake;
  let status: BreakoutSettlement["status"] = "lost";
  let result = outcome;

  if (bet === "tie") {
    const tieOdds = playerBlackjack && dealerBlackjack ? 25
      : bothBust ? 1
      : sameTotal && !playerBlackjack && !dealerBlackjack
        ? playerTotal === 21 ? 15 : playerTotal === 20 ? 8 : playerTotal >= 17 ? 3 : 0
      : 0;
    if (tieOdds > 0) {
      profit = stake * tieOdds;
      status = "won";
    }
  } else if (playerBlackjack && dealerBlackjack || sameTotal && playerBlackjack === dealerBlackjack || bet === "dealer" && bothBust) {
    profit = 0;
    status = "push";
  } else if (bet === "dealer" && playerTotal > 21 && dealerTotal === 17) {
    profit = 0;
    status = "push";
    result = "DEALER 17 PUSH";
  } else if (bet === "player") {
    if (playerBlackjack && !dealerBlackjack || !dealerBlackjack && playerTotal <= 21 &&
      (dealerTotal > 21 || playerTotal > dealerTotal)) {
      profit = stake * (playerBlackjack ? 1.5 : 1);
      status = "won";
    }
  } else if (dealerBlackjack && !playerBlackjack || !playerBlackjack && dealerTotal <= 21 &&
    (playerTotal > 21 || dealerTotal > playerTotal)) {
    profit = stake * (dealerBlackjack ? 1.5 : 1);
    status = "won";
  }

  return { status, result, profit, payout: stake + profit };
}
