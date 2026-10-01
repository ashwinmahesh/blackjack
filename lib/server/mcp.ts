import { randomBytes } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  canSplit,
  EMPTY_SIDE_BETS,
  isBlackjack,
  isFreeDouble,
  isFreeSplit,
  scoreHand,
  type Card,
  type GameMode,
  type SideBetKey,
} from "../blackjack";
import {
  createRoom,
  getRoomForPlayer,
  joinRoom,
  RoomError,
  roomAction,
  startRoom,
  subscribeRoom,
  updateReady,
  type PublicRoom,
} from "./rooms";

const MODE_SCHEMA = z.enum(["classic", "doubleDownMadness", "freeBet", "breakout", "doubleUp"]);
const PLAY_ACTION_SCHEMA = z.enum(["hit", "stand", "double", "double-up", "split", "surrender"]);
const SIDE_BET_SCHEMA = z.object({
  perfectPairs: z.number().int().nonnegative().optional(),
  twentyOnePlusThree: z.number().int().nonnegative().optional(),
  matchDealer: z.number().int().nonnegative().optional(),
  topThree: z.number().int().nonnegative().optional(),
  dealerBust: z.number().int().nonnegative().optional(),
  bonus16: z.number().int().nonnegative().optional(),
  breakoutTie: z.number().int().nonnegative().optional(),
  breakoutBonus: z.number().int().nonnegative().optional(),
});
const GAME_ID_PATTERN = /^([A-Z2-9]{5})\.([A-Za-z0-9_-]{24})$/;
const SUITS: Record<Card["suit"], string> = {
  clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠",
};
const MODE_RULES: Record<GameMode, { summary: string; sideBets: string; guide: string }> = {
  classic: {
    summary: "Six decks. Dealer hits soft 17. Blackjack pays 3:2; ordinary wins pay 1:1. Hit, stand, double, split, and surrender are available when legal.",
    sideBets: "Perfect Pairs, 21+3, Match the Dealer, and Top 3 have staged payouts. See the side-bet guide for the full tables.",
    guide: "/rules",
  },
  doubleDownMadness: {
    summary: "Start with one card, then hit or double repeatedly. An opening ace gets only one more card. Dealer 22 pushes live hands. Split and surrender are unavailable.",
    sideBets: "Dealer Bust pays 2:1 for 3–4 dealer cards, 4:1 for 5, 8:1 for 6, and 50:1 for 7 or more.",
    guide: "/double-down-madness",
  },
  freeBet: {
    summary: "Free doubles on hard 9–11 and free splits on non-ten pairs. Dealer 22 pushes live hands. Blackjack pays 3:2.",
    sideBets: "Perfect Pairs, 21+3, Match the Dealer, and Top 3 have staged payouts. See the side-bet guide for the full tables.",
    guide: "/free-bet",
  },
  breakout: {
    summary: "Bet on the player or dealer to win. Both hands play automatically; no hand actions are needed. A tie pushes the main wager.",
    sideBets: "Tie pays 15:1 for equal totals or when both bust. Bonus pays 5:1 through 7 combined cards when both bust, 15:1 for 8, 30:1 for 9, 100:1 for 10, 150:1 for 11, and 250:1 for 12 or more.",
    guide: "/breakout",
  },
  doubleUp: {
    summary: "On a two-card hand, Double Up adds an equal wager and stands immediately. An ordinary tie pushes the main bet but loses the Double Up bet. Dealer stops on hard or soft 16; a player 21 wins against 16 and other live hands push. No surrender.",
    sideBets: "Bonus 16 pays 4:1 for dealer 16 in 2 cards, 5:1 in 3, 10:1 in 4, 50:1 in 5, 100:1 in 6, and 500:1 in 7 or more.",
    guide: "/double-up",
  },
};

function cardLabel(card: Card) {
  return `${card.rank}${SUITS[card.suit]}`;
}

function gameId(code: string, playerId: string) {
  return `${code}.${playerId}`;
}

function gameIdentity(id: string) {
  const match = GAME_ID_PATTERN.exec(id);
  if (!match) throw new RoomError("Invalid game ID", 400);
  return { code: match[1], playerId: match[2] };
}

function sideBetOptions(mode: GameMode): SideBetKey[] {
  if (mode === "doubleDownMadness") return ["dealerBust"];
  if (mode === "doubleUp") return ["bonus16"];
  if (mode === "breakout") return ["breakoutTie", "breakoutBonus"];
  return ["perfectPairs", "twentyOnePlusThree", "matchDealer", "topThree"];
}

function legalActions(room: PublicRoom, seatId: string) {
  const player = room.players.find((candidate) => candidate.id === seatId);
  if (!player) return [];
  if (room.phase === "betting") return player.bet === 0 && player.bankroll >= room.table.minimum ? ["place_bet", "leave_game"] : ["leave_game"];
  if (room.phase === "settled") return seatId === room.hostId ? ["next_round", "leave_game"] : ["leave_game"];
  if (room.phase !== "playing" || room.currentPlayerId !== seatId) return ["leave_game"];
  const hand = player.hands[player.activeHand];
  if (!hand || hand.status !== "active") return ["leave_game"];

  const actions = ["stand"];
  if (!(room.mode === "doubleUp" && hand.splitAces)) actions.push("hit");
  const freeDouble = room.mode === "freeBet" && isFreeDouble(hand.cards);
  const doubleStake = hand.bet || hand.freeStake || player.bet;
  if ((room.mode === "doubleDownMadness" ? hand.cards.length >= 1 && scoreHand(hand.cards).total < 21 : hand.cards.length === 2) &&
      !(room.mode === "doubleUp" && hand.splitAces) && (freeDouble || player.bankroll >= doubleStake)) actions.push("double");
  if (room.mode === "doubleUp" && hand.cards.length === 2 &&
      (!isBlackjack(hand.cards) || hand.fromSplit) && player.bankroll >= hand.bet) actions.push("double-up");
  if (room.mode !== "doubleDownMadness" && !(room.mode === "doubleUp" && hand.splitAces) &&
      player.hands.length < (room.mode === "doubleUp" ? 4 : 5) && canSplit(hand.cards) &&
      (room.mode === "freeBet" && isFreeSplit(hand.cards) || player.bankroll >= doubleStake)) actions.push("split");
  if (room.mode !== "doubleDownMadness" && room.mode !== "doubleUp" && hand.cards.length === 2 && player.hands.length === 1) actions.push("surrender");
  return [...actions, "leave_game"];
}

function gameState(id: string) {
  const { code, playerId } = gameIdentity(id);
  const { room, seatId } = getRoomForPlayer(code, playerId);
  const you = room.players.find((player) => player.id === seatId)!;
  const dealerVisible = room.dealer.filter((card): card is Card => card !== null);
  return {
    gameId: id,
    roomCode: room.code,
    version: room.version,
    mode: room.mode,
    phase: room.phase,
    round: room.round,
    message: room.message,
    minimumBet: room.table.minimum,
    shoeRemaining: room.shoeRemaining,
    burnedCard: cardLabel(room.burnedCard),
    dealer: room.dealer.map((card) => card ? cardLabel(card) : "hidden"),
    dealerTotal: room.dealer.length && dealerVisible.length === room.dealer.length ? scoreHand(dealerVisible).total : null,
    currentPlayer: room.players.find((player) => player.id === room.currentPlayerId)?.name ?? null,
    you: {
      name: you.name,
      seatId,
      tokens: you.bankroll,
      bet: you.bet,
      isHost: room.hostId === seatId,
      activeHand: you.hands.length ? you.activeHand + 1 : null,
      hands: you.hands.map((hand, index) => ({
        number: index + 1,
        cards: hand.cards.map(cardLabel),
        total: scoreHand(hand.cards).total,
        bet: hand.bet,
        doubleUpStake: hand.doubleUpStake ?? 0,
        freeStake: hand.freeStake ?? 0,
        status: hand.status,
        result: hand.result ?? null,
        profit: hand.profit ?? null,
      })),
      sideBetResults: you.sideBetResults,
    },
    otherPlayers: room.players.filter((player) => player.id !== seatId).map((player) => ({
      name: player.name,
      seatId: player.id,
      tokens: player.bankroll,
      bet: player.bet,
      hands: player.hands.map((hand) => ({ cards: hand.cards.map(cardLabel), status: hand.status, result: hand.result ?? null })),
    })),
    availableActions: legalActions(room, seatId),
    availableSideBets: sideBetOptions(room.mode),
  };
}

function success(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
}

function failure(error: unknown) {
  const message = error instanceof RoomError ? error.message : "The game could not complete that action";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

async function run(action: () => unknown | Promise<unknown>) {
  try {
    const data = await action();
    return success(data as Record<string, unknown>);
  } catch (error) {
    return failure(error);
  }
}

export const blackjackMcpHandler = createMcpHandler(() => {
  const server = new McpServer({ name: "ashwins-blackjack", version: "1.0.0" }, {
    instructions: "Play practice-token blackjack. Start a game, save its private gameId, then call get_game to see the table and legal actions. A room code and passcode can be shared with friends. Tokens have no cash value and are separate from browser-saved tokens.",
  });

  server.registerTool("start_game", {
    title: "Start blackjack game",
    description: "Start a one-player practice-token table. Friends can join later using the returned room code and passcode. Keep gameId private; it authorizes your moves.",
    inputSchema: z.object({
      name: z.string().trim().min(2).max(20).default("AI Player"),
      mode: MODE_SCHEMA.default("classic"),
      startingTokens: z.number().int().min(10).max(1_000_000).default(500),
    }),
    annotations: { destructiveHint: false },
  }, ({ name, mode, startingTokens }) => run(() => {
    const passcode = randomBytes(9).toString("base64url");
    const created = createRoom({ name, passcode, startingBankroll: startingTokens, mode });
    updateReady(created.room.code, created.playerId, true);
    startRoom(created.room.code, created.playerId);
    return { ...gameState(gameId(created.room.code, created.playerId)), passcode };
  }));

  server.registerTool("join_game", {
    title: "Join blackjack game",
    description: "Join a friend's table using its room code and passcode. You can join while a round is in progress and play when a seat and betting round are available.",
    inputSchema: z.object({
      roomCode: z.string().trim().min(5).max(5),
      passcode: z.string().min(4).max(32),
      name: z.string().trim().min(2).max(20),
      startingTokens: z.number().int().min(10).max(1_000_000).default(500),
    }),
    annotations: { destructiveHint: false },
  }, ({ roomCode, passcode, name, startingTokens }) => run(() => {
    const joined = joinRoom({ code: roomCode, passcode, name, startingBankroll: startingTokens });
    if (joined.room.phase === "lobby") updateReady(joined.room.code, joined.playerId, true);
    return gameState(gameId(joined.room.code, joined.playerId));
  }));

  server.registerTool("get_game", {
    title: "Get blackjack table",
    description: "Read your cards, dealer cards, tokens, turn, legal actions, room version, and other players. Keep gameId private.",
    inputSchema: z.object({ gameId: z.string() }),
    annotations: { readOnlyHint: true },
  }, ({ gameId: id }) => run(() => gameState(id)));

  server.registerTool("get_rules", {
    title: "Get blackjack rules",
    description: "Read the rules and side bet payouts for a game mode before placing a wager.",
    inputSchema: z.object({ mode: MODE_SCHEMA.default("classic") }),
    annotations: { readOnlyHint: true },
  }, ({ mode }) => run(() => ({
    mode,
    ...MODE_RULES[mode],
    availableSideBets: sideBetOptions(mode),
    guideUrl: `https://ashwinblackjack.com${MODE_RULES[mode].guide}`,
    sideBetGuideUrl: "https://ashwinblackjack.com/side-bets",
    practiceTokensOnly: true,
  })));

  server.registerTool("place_bet", {
    title: "Place blackjack bet",
    description: "Bet practice tokens for the current round. Breakout accepts player or dealer as the main outcome bet; Tie is a side bet.",
    inputSchema: z.object({
      gameId: z.string(),
      amount: z.number().int().positive(),
      sideBets: SIDE_BET_SCHEMA.optional(),
      breakoutBet: z.enum(["player", "dealer"]).default("player"),
    }),
    annotations: { destructiveHint: false },
  }, ({ gameId: id, amount, sideBets, breakoutBet }) => run(() => {
    const { code, playerId } = gameIdentity(id);
    roomAction(code, playerId, "bet", amount, undefined, { ...EMPTY_SIDE_BETS, ...sideBets }, breakoutBet);
    return gameState(id);
  }));

  server.registerTool("play_hand", {
    title: "Play blackjack hand",
    description: "Take one legal hand action: hit, stand, double, double-up, split, or surrender. Read availableActions from get_game first.",
    inputSchema: z.object({ gameId: z.string(), action: PLAY_ACTION_SCHEMA }),
    annotations: { destructiveHint: false },
  }, ({ gameId: id, action }) => run(() => {
    const { code, playerId } = gameIdentity(id);
    roomAction(code, playerId, action);
    return gameState(id);
  }));

  server.registerTool("next_round", {
    title: "Open next blackjack round",
    description: "As the table host, open the next betting round after all hands settle.",
    inputSchema: z.object({ gameId: z.string() }),
    annotations: { destructiveHint: false },
  }, ({ gameId: id }) => run(() => {
    const { code, playerId } = gameIdentity(id);
    roomAction(code, playerId, "next-round");
    return gameState(id);
  }));

  server.registerTool("wait_for_game", {
    title: "Wait for table update",
    description: "Wait up to 20 seconds for a newer room version, useful while other players act. Returns the current state on timeout.",
    inputSchema: z.object({
      gameId: z.string(),
      afterVersion: z.number().int().nonnegative(),
      timeoutSeconds: z.number().int().min(1).max(20).default(15),
    }),
    annotations: { readOnlyHint: true },
  }, ({ gameId: id, afterVersion, timeoutSeconds }) => run(async () => {
    const { code, playerId } = gameIdentity(id);
    getRoomForPlayer(code, playerId);
    let stop = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = await new Promise<boolean>((resolve, reject) => {
      timer = setTimeout(() => resolve(false), timeoutSeconds * 1000);
      stop = subscribeRoom(code, (room) => {
        if (!room) reject(new RoomError("Room closed", 404));
        else if (room.version > afterVersion) resolve(true);
      });
    }).finally(() => {
      stop();
      if (timer) clearTimeout(timer);
    });
    return { changed, ...gameState(id) };
  }));

  server.registerTool("leave_game", {
    title: "Leave blackjack table",
    description: "Leave your seat. Your gameId stops working; a host's seat passes to another player if one remains.",
    inputSchema: z.object({ gameId: z.string() }),
    annotations: { destructiveHint: true },
  }, ({ gameId: id }) => run(() => {
    const { code, playerId } = gameIdentity(id);
    roomAction(code, playerId, "leave");
    return { message: "You left the blackjack table" };
  }));

  return server;
}, { maxRequestBodySize: 128 * 1024 });
