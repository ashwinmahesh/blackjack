import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  canSplit,
  bustPhrase,
  createBurnedShoe,
  createCutPoint,
  DECK_COUNT,
  EMPTY_SIDE_BETS,
  isFreeDouble,
  isFreeSplit,
  isBlackjack,
  isValidTokenBalance,
  MAX_SPLIT_HANDS,
  OPENING_SIDE_BET_KEYS,
  playDealer,
  scoreHand,
  settleBreakoutBet,
  settleFinalSideBets,
  settleSideBets,
  type BreakoutBet,
  type SideBetKey,
  type SideBets,
  type SideBetOutcome,
  type Card,
  type GameMode,
} from "../blackjack";

export const ROOM_TABLES = [
  { id: "club", name: "Club table", minimum: 10, chips: [10, 25, 50, 100] },
  { id: "silver", name: "Silver table", minimum: 50, chips: [50, 100, 500, 1000] },
  { id: "gold", name: "Gold table", minimum: 100, chips: [100, 500, 1000, 5000] },
  { id: "high-limit", name: "High limit", minimum: 1000, chips: [1000, 5000, 10000, 25000] },
] as const;

type RoomHandStatus =
  | "active"
  | "standing"
  | "busted"
  | "won"
  | "lost"
  | "push"
  | "surrendered";

export type RoomHand = {
  cards: Card[];
  bet: number;
  freeStake?: number;
  status: RoomHandStatus;
  result?: string;
  profit?: number;
};

type StoredPlayer = {
  id: string;
  sessionHash: string;
  name: string;
  bankroll: number;
  bet: number;
  breakoutBet: BreakoutBet;
  ready: boolean;
  joinedAt: number;
  hands: RoomHand[];
  activeHand: number;
  sideBets: SideBets;
  sideBetResults: SideBetOutcome[];
};

export type RoomPlayer = Omit<StoredPlayer, "sessionHash">;

type RoomTable = {
  id: string;
  name: string;
  minimum: number;
  chips: number[];
};

type StoredRoom = {
  code: string;
  passcodeHash: string;
  hostId: string;
  phase: "lobby" | "betting" | "playing" | "settled";
  mode: GameMode;
  table: RoomTable;
  players: StoredPlayer[];
  shoe: Card[];
  burnedCard: Card;
  shoeSerial: number;
  cutPoint: number;
  dealer: Card[];
  currentPlayerId: string | null;
  message: string;
  round: number;
  createdAt: number;
  updatedAt: number;
  version: number;
};

export type PublicRoom = Omit<
  StoredRoom,
  "passcodeHash" | "shoe" | "players" | "dealer"
> & {
  players: RoomPlayer[];
  dealer: Array<Card | null>;
  shoeRemaining: number;
};

type RoomStoreGlobal = typeof globalThis & {
  __dealersEdgeRooms?: Map<string, StoredRoom>;
  __dealersEdgeRoomSubscribers?: Map<string, Set<(room: PublicRoom | null) => void>>;
};

const sharedGlobal = globalThis as RoomStoreGlobal;
const rooms = sharedGlobal.__dealersEdgeRooms ?? new Map<string, StoredRoom>();
sharedGlobal.__dealersEdgeRooms = rooms;
const subscribers = sharedGlobal.__dealersEdgeRoomSubscribers ?? new Map<string, Set<(room: PublicRoom | null) => void>>();
sharedGlobal.__dealersEdgeRoomSubscribers = subscribers;

const ROOM_LIFETIME_MS = 6 * 60 * 60 * 1000;
const MAX_PLAYERS = 5;

function cleanName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 20);
}

function cleanPasscode(passcode: string) {
  return passcode.trim().slice(0, 32);
}

function hashPasscode(code: string, passcode: string) {
  return createHash("sha256").update(`${code}:${cleanPasscode(passcode)}`).digest("hex");
}

function passcodesMatch(storedHash: string, candidateHash: string) {
  const stored = Buffer.from(storedHash, "hex");
  const candidate = Buffer.from(candidateHash, "hex");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

function playerToken() {
  return randomBytes(18).toString("base64url");
}

function hashPlayerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += alphabet[randomBytes(1)[0] % alphabet.length];
  }
  return code;
}

function draw(shoe: Card[]) {
  const card = shoe.pop();
  if (!card) throw new RoomError("The shoe is empty", 409);
  return card;
}

function pruneExpiredRooms() {
  const expiry = Date.now() - ROOM_LIFETIME_MS;
  for (const [code, room] of rooms) {
    if (room.updatedAt < expiry) {
      rooms.delete(code);
      broadcastClosed(code);
    }
  }
}

function publicRoom(room: StoredRoom): PublicRoom {
  const { passcodeHash: _passcodeHash, shoe, dealer, players: _players, ...safeRoom } = room;
  void _passcodeHash;
  void _players;
  return {
    ...safeRoom,
    players: room.players.map(({ sessionHash: _sessionHash, ...player }) => {
      void _sessionHash;
      return player;
    }),
    dealer:
      room.phase === "playing" && dealer.length > 1
        ? [dealer[0], null, ...dealer.slice(2)]
        : dealer,
    shoeRemaining: shoe.length,
  };
}

function touch(room: StoredRoom) {
  room.updatedAt = Date.now();
  room.version += 1;
  const snapshot = publicRoom(room);
  for (const listener of subscribers.get(room.code) ?? []) listener(snapshot);
  return snapshot;
}

function broadcastClosed(code: string) {
  for (const listener of subscribers.get(code) ?? []) listener(null);
  subscribers.delete(code);
}

export function subscribeRoom(code: string, listener: (room: PublicRoom | null) => void) {
  const room = requireRoom(code);
  const roomListeners = subscribers.get(room.code) ?? new Set<(room: PublicRoom | null) => void>();
  roomListeners.add(listener);
  subscribers.set(room.code, roomListeners);
  listener(publicRoom(room));
  return () => {
    roomListeners.delete(listener);
    if (!roomListeners.size) subscribers.delete(room.code);
  };
}

function requireRoom(code: string) {
  pruneExpiredRooms();
  const room = rooms.get(code.toUpperCase());
  if (!room) throw new RoomError("Room not found", 404);
  return room;
}

function requirePlayer(room: StoredRoom, playerTokenValue: string) {
  const sessionHash = hashPlayerToken(playerTokenValue);
  const player = room.players.find((candidate) => candidate.sessionHash === sessionHash);
  if (!player) throw new RoomError("Player session not found", 403);
  return player;
}

function activeHands(player: StoredPlayer) {
  return player.hands.filter((hand) => hand.status === "active");
}

function playablePlayers(room: StoredRoom) {
  return room.players.filter((player) => player.bet > 0 || player.bankroll >= room.table.minimum);
}

function settlePlayerFinalSideBets(room: StoredRoom, player: StoredPlayer) {
  for (const hand of player.hands) {
    const result = settleFinalSideBets(hand.cards, room.dealer, player.sideBets);
    player.bankroll += result.payout;
    player.sideBetResults.push(...result.outcomes);
  }
}

function settleRoom(room: StoredRoom) {
  if (room.mode === "breakout") {
    if (!isBlackjack(room.dealer) && room.players.some((player) =>
      player.hands.some((hand) => !isBlackjack(hand.cards)))) {
      const dealerPlay = playDealer(room.dealer, room.shoe);
      room.dealer = dealerPlay.cards;
      room.shoe = dealerPlay.shoe;
    }
    for (const player of room.players) {
      player.hands = player.hands.map((hand) => {
        const result = settleBreakoutBet(hand.cards, room.dealer, player.breakoutBet, hand.bet);
        player.bankroll += result.payout;
        return { ...hand, status: result.status, result: result.result, profit: result.profit };
      });
      settlePlayerFinalSideBets(room, player);
    }
    const dealerTotal = scoreHand(room.dealer).total;
    room.phase = "settled";
    room.currentPlayerId = null;
    room.message = isBlackjack(room.dealer) ? "Dealer blackjack"
      : dealerTotal > 21 ? "Dealer busts — Breakout settled"
      : `Dealer stands on ${dealerTotal} — Breakout settled`;
    return;
  }

  const hasLiveHand = room.players.some((player) =>
    player.hands.some(
      (hand) => !["busted", "surrendered", "won"].includes(hand.status),
    ),
  );
  const dealerBustWagered = room.mode === "doubleDownMadness" && room.players.some((player) => player.sideBets.dealerBust > 0);
  if (hasLiveHand || dealerBustWagered) {
    const dealerPlay = playDealer(room.dealer, room.shoe);
    room.dealer = dealerPlay.cards;
    room.shoe = dealerPlay.shoe;
  }
  const dealerTotal = scoreHand(room.dealer).total;

  for (const player of room.players) {
    player.hands = player.hands.map((hand) => {
      if (hand.status === "surrendered" || hand.result === "BLACKJACK") return hand;
      const total = scoreHand(hand.cards).total;
      if (hand.status === "busted" || total > 21) {
        return { ...hand, status: "lost", result: "BUST" };
      }
      if ((room.mode !== "classic" && dealerTotal === 22) || total === dealerTotal) {
        player.bankroll += hand.bet;
        return { ...hand, status: "push", result: dealerTotal === 22 ? "PUSH 22" : "PUSH" };
      }
      if (dealerTotal > 21 || total > dealerTotal) {
        player.bankroll += hand.bet * 2 + (hand.freeStake ?? 0);
        return { ...hand, status: "won", result: dealerTotal > 21 ? "DEALER BUST" : "WIN" };
      }
      return { ...hand, status: "lost", result: "DEALER WINS" };
    });
    settlePlayerFinalSideBets(room, player);
  }

  room.phase = "settled";
  room.currentPlayerId = null;
  room.message = isBlackjack(room.dealer)
    ? "Dealer blackjack"
    : room.mode !== "classic" && dealerTotal === 22 ? "Dealer 22 — standing hands push"
    : dealerTotal > 21 ? "Dealer busts — round settled" : `Dealer stands on ${dealerTotal}`;
}

function advanceTurn(room: StoredRoom) {
  const playerIndex = room.players.findIndex((player) => player.id === room.currentPlayerId);
  const currentPlayer = room.players[playerIndex];
  if (currentPlayer) {
    const nextHand = currentPlayer.hands.findIndex(
      (hand, index) => index > currentPlayer.activeHand && hand.status === "active",
    );
    if (nextHand !== -1) {
      currentPlayer.activeHand = nextHand;
      room.message = `${currentPlayer.name} plays hand ${nextHand + 1}`;
      return;
    }
  }

  const nextPlayer = room.players.find(
    (player, index) => index > playerIndex && activeHands(player).length > 0,
  );
  if (nextPlayer) {
    nextPlayer.activeHand = nextPlayer.hands.findIndex((hand) => hand.status === "active");
    room.currentPlayerId = nextPlayer.id;
    room.message = `${nextPlayer.name}’s turn`;
    return;
  }
  settleRoom(room);
}

function dealRoomRound(room: StoredRoom) {
  const participating = room.players.filter((player) => player.bet > 0);
  for (const player of participating) player.hands = [{ cards: [], bet: player.bet, status: "active" }];

  for (const player of participating) player.hands[0].cards.push(draw(room.shoe));
  room.dealer = [draw(room.shoe)];
  if (room.mode !== "doubleDownMadness") {
    for (const player of participating) player.hands[0].cards.push(draw(room.shoe));
  }
  room.dealer.push(draw(room.shoe));

  for (const player of participating) {
    const result = room.mode === "doubleDownMadness" || room.mode === "breakout"
      ? { payout: 0, outcomes: [] as SideBetOutcome[] }
      : settleSideBets(player.hands[0].cards, room.dealer[0], player.sideBets);
    player.bankroll += result.payout;
    player.sideBetResults = result.outcomes;
  }

  if (room.mode === "breakout") {
    const dealerNatural = isBlackjack(room.dealer);
    for (const player of participating) {
      const hand = player.hands[0];
      if (!dealerNatural && !isBlackjack(hand.cards)) {
        const played = playDealer(hand.cards, room.shoe);
        hand.cards = played.cards;
        room.shoe = played.shoe;
      }
      hand.status = scoreHand(hand.cards).total > 21 ? "busted" : "standing";
    }
    settleRoom(room);
    return;
  }

  const dealerNatural = isBlackjack(room.dealer);
  for (const player of participating) {
    const hand = player.hands[0];
    const playerNatural = isBlackjack(hand.cards);
    if (playerNatural) {
      const payout = dealerNatural ? hand.bet : hand.bet * 2.5;
      player.bankroll += payout;
      hand.status = dealerNatural ? "push" : "won";
      hand.result = dealerNatural ? "PUSH" : "BLACKJACK";
    } else if (dealerNatural) {
      hand.status = "lost";
      hand.result = "DEALER BLACKJACK";
    }
  }

  if (dealerNatural) {
    for (const player of participating) settlePlayerFinalSideBets(room, player);
    room.phase = "settled";
    room.currentPlayerId = null;
    room.message = "Dealer blackjack";
    return;
  }

  const firstPlayer = participating.find((player) => activeHands(player).length > 0);
  if (!firstPlayer) {
    if (room.mode === "doubleDownMadness" && participating.some((player) => player.sideBets.dealerBust > 0)) {
      settleRoom(room);
      return;
    }
    room.phase = "settled";
    room.currentPlayerId = null;
    room.message = "Naturals paid";
    return;
  }
  room.phase = "playing";
  room.currentPlayerId = firstPlayer.id;
  firstPlayer.activeHand = 0;
  room.message = `${firstPlayer.name}’s turn`;
}

export class RoomError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function startingBankroll(value: number | undefined) {
  if (value === undefined) return 500;
  if (!isValidTokenBalance(value)) {
    throw new RoomError("Starting token balance must be a nonnegative number of whole or half tokens", 400);
  }
  return value;
}

export function createRoom(input: {
  name: string;
  passcode: string;
  startingBankroll?: number;
  mode?: GameMode;
}) {
  pruneExpiredRooms();
  const name = cleanName(input.name);
  const passcode = cleanPasscode(input.passcode);
  if (name.length < 2) throw new RoomError("Enter a name with at least 2 characters", 400);
  if (passcode.length < 4) throw new RoomError("Passcode must be at least 4 characters", 400);
  if (input.mode !== undefined && !["classic", "doubleDownMadness", "freeBet", "breakout"].includes(input.mode)) {
    throw new RoomError("Choose a valid game mode", 400);
  }

  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const bankroll = startingBankroll(input.startingBankroll);
  const selectedTable = ROOM_TABLES[0];
  const hostToken = playerToken();
  const host: StoredPlayer = {
    id: randomBytes(6).toString("base64url"),
    sessionHash: hashPlayerToken(hostToken),
    name,
    bankroll,
    bet: 0,
    breakoutBet: "player",
    ready: false,
    joinedAt: Date.now(),
    hands: [],
    activeHand: 0,
    sideBets: { ...EMPTY_SIDE_BETS },
    sideBetResults: [],
  };
  const freshShoe = createBurnedShoe(DECK_COUNT);
  const room: StoredRoom = {
    code,
    passcodeHash: hashPasscode(code, passcode),
    hostId: host.id,
    phase: "lobby",
    mode: input.mode ?? "classic",
    table: { ...selectedTable, chips: [...selectedTable.chips] },
    players: [host],
    shoe: freshShoe.shoe,
    burnedCard: freshShoe.burnedCard,
    shoeSerial: 1,
    cutPoint: createCutPoint(),
    dealer: [],
    currentPlayerId: null,
    message: "Waiting for players",
    round: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
  };
  rooms.set(code, room);
  return { room: publicRoom(room), playerId: hostToken, seatId: host.id };
}

export function joinRoom(input: { code: string; name: string; passcode: string; startingBankroll?: number }) {
  const room = requireRoom(input.code);
  const name = cleanName(input.name);
  if (name.length < 2) throw new RoomError("Enter a name with at least 2 characters", 400);
  if (!passcodesMatch(room.passcodeHash, hashPasscode(room.code, input.passcode))) {
    throw new RoomError("Incorrect room passcode", 403);
  }
  if (room.players.length >= MAX_PLAYERS) throw new RoomError("This table is full", 409);

  const playerTokenValue = playerToken();
  const player: StoredPlayer = {
    id: randomBytes(6).toString("base64url"),
    sessionHash: hashPlayerToken(playerTokenValue),
    name,
    bankroll: startingBankroll(input.startingBankroll),
    bet: 0,
    breakoutBet: "player",
    ready: false,
    joinedAt: Date.now(),
    hands: [],
    activeHand: 0,
    sideBets: { ...EMPTY_SIDE_BETS },
    sideBetResults: [],
  };
  room.players.push(player);
  if (room.phase !== "lobby") {
    room.message = room.phase === "betting"
      ? `${player.name} joined — place your bet`
      : `${player.name} joined and will play next round`;
  }
  return { room: touch(room), playerId: playerTokenValue, seatId: player.id };
}

export function getRoom(code: string) {
  return publicRoom(requireRoom(code));
}

export function updateReady(code: string, playerId: string, ready: boolean) {
  const room = requireRoom(code);
  const player = requirePlayer(room, playerId);
  if (room.phase !== "lobby") throw new RoomError("The table has already started", 409);
  player.ready = ready;
  return touch(room);
}

export function startRoom(code: string, playerId: string) {
  const room = requireRoom(code);
  const player = requirePlayer(room, playerId);
  if (player.id !== room.hostId) throw new RoomError("Only the host can start the table", 403);
  if (room.phase !== "lobby") throw new RoomError("The table has already started", 409);
  if (!room.players.every((candidate) => candidate.ready)) {
    throw new RoomError("Every seated player must be ready", 409);
  }
  room.phase = "betting";
  room.message = `Place bets — minimum ${room.table.minimum}`;
  return touch(room);
}

export function roomAction(
  code: string,
  playerId: string,
  action: "bet" | "hit" | "stand" | "double" | "split" | "surrender" | "next-round" | "donate" | "leave" | "kick",
  amount?: number,
  targetId?: string,
  sideBets?: SideBets,
  breakoutBet?: BreakoutBet,
) {
  const room = requireRoom(code);
  const player = requirePlayer(room, playerId);

  if (action === "leave" || action === "kick") {
    if (action === "kick" && player.id !== room.hostId) throw new RoomError("Only the host can remove a player", 403);
    const target = action === "leave" ? player : room.players.find((candidate) => candidate.id === targetId);
    if (!target) throw new RoomError("Player not found", 404);
    if (action === "kick" && target.id === player.id) throw new RoomError("Use Leave room to exit", 400);
    const wasCurrent = room.currentPlayerId === target.id;
    const targetIndex = room.players.indexOf(target);
    room.players.splice(targetIndex, 1);
    if (!room.players.length) {
      rooms.delete(room.code);
      broadcastClosed(room.code);
      return null;
    }
    if (target.id === room.hostId) room.hostId = room.players[0].id;
    if (room.phase === "playing" && wasCurrent) {
      const next = room.players.slice(targetIndex).find((candidate) => activeHands(candidate).length);
      if (next) {
        room.currentPlayerId = next.id;
        next.activeHand = next.hands.findIndex((hand) => hand.status === "active");
        room.message = `${next.name}’s turn`;
      } else settleRoom(room);
    } else if (room.phase === "betting" && playablePlayers(room).length && playablePlayers(room).every((candidate) => candidate.bet > 0)) {
      dealRoomRound(room);
    }
    if (room.phase === "lobby") room.message = `${target.name} left the table`;
    return touch(room);
  }

  if (action === "donate") {
    const recipient = room.players.find((candidate) => candidate.id === targetId);
    if (!recipient || recipient.id === player.id) throw new RoomError("Choose another seated player", 400);
    if (!Number.isSafeInteger(amount) || !amount || amount <= 0 || amount > player.bankroll) {
      throw new RoomError("Enter a whole token amount within your balance", 400);
    }
    const transfer = amount as number;
    player.bankroll -= transfer;
    recipient.bankroll += transfer;
    room.message = `${player.name} sent ${transfer} tokens to ${recipient.name}`;
    return touch(room);
  }

  if (action === "next-round") {
    if (player.id !== room.hostId) throw new RoomError("Only the host can open the next round", 403);
    if (room.phase !== "settled") throw new RoomError("The current round is not settled", 409);
    const shuffled = room.shoe.length <= room.cutPoint;
    if (shuffled) {
      const freshShoe = createBurnedShoe(DECK_COUNT);
      room.shoe = freshShoe.shoe;
      room.burnedCard = freshShoe.burnedCard;
      room.shoeSerial += 1;
      room.cutPoint = createCutPoint();
    }
    const playableCount = room.players.filter((candidate) => candidate.bankroll >= room.table.minimum).length;
    room.dealer = [];
    room.currentPlayerId = null;
    room.phase = "betting";
    room.round += 1;
    room.message = playableCount
      ? shuffled
        ? `Fresh ${DECK_COUNT}-deck shoe shuffled. Place bets — minimum ${room.table.minimum}`
        : `Place bets — minimum ${room.table.minimum}`
      : "No players have enough tokens for the next round";
    for (const candidate of room.players) {
      candidate.bet = 0;
      candidate.breakoutBet = "player";
      candidate.hands = [];
      candidate.activeHand = 0;
      candidate.sideBets = { ...EMPTY_SIDE_BETS };
      candidate.sideBetResults = [];
    }
    return touch(room);
  }

  if (action === "bet") {
    if (room.phase !== "betting") throw new RoomError("The table is not taking bets", 409);
    if (player.bankroll < room.table.minimum) {
      throw new RoomError("You do not have enough tokens for this table", 409);
    }
    if (!Number.isSafeInteger(amount)) throw new RoomError("Enter a whole token wager", 400);
    const wager = amount as number;
    const selectedSideBets = { ...EMPTY_SIDE_BETS };
    const allowedSideBets: SideBetKey[] = room.mode === "doubleDownMadness" ? ["dealerBust"]
      : room.mode === "breakout" ? breakoutBet === "dealer" ? ["breakoutBonus"] : []
      : [...OPENING_SIDE_BET_KEYS];
    for (const key of Object.keys(selectedSideBets) as Array<keyof SideBets>) {
      const value = sideBets?.[key] ?? 0;
      if (!Number.isSafeInteger(value) || value < 0) throw new RoomError("Invalid side bet", 400);
      if (value > 0 && !allowedSideBets.includes(key)) throw new RoomError("Side bet unavailable for this wager", 400);
      selectedSideBets[key] = value;
    }
    const totalStake = wager + Object.values(selectedSideBets).reduce((sum, value) => sum + value, 0);
    if (room.mode === "breakout" && !["player", "dealer", "tie"].includes(breakoutBet ?? "")) {
      throw new RoomError("Choose a Breakout outcome", 400);
    }
    if (wager < room.table.minimum) throw new RoomError(`Minimum bet is ${room.table.minimum}`, 400);
    if (totalStake > player.bankroll) throw new RoomError("Not enough tokens", 409);
    if (player.bet > 0) throw new RoomError("Bet already placed", 409);
    player.bet = wager;
    player.breakoutBet = room.mode === "breakout" ? breakoutBet! : "player";
    player.sideBets = selectedSideBets;
    player.sideBetResults = [];
    player.bankroll -= totalStake;
    room.message = `${player.name} is in for ${wager}`;
    if (playablePlayers(room).every((candidate) => candidate.bet > 0)) dealRoomRound(room);
    return touch(room);
  }

  if (room.phase !== "playing") throw new RoomError("There is no active hand", 409);
  if (room.currentPlayerId !== player.id) throw new RoomError("It is not your turn", 409);
  const hand = player.hands[player.activeHand];
  if (!hand || hand.status !== "active") throw new RoomError("This hand is complete", 409);

  if (action === "hit") {
    const singleAceDraw = room.mode === "doubleDownMadness" && hand.cards.length === 1 && hand.cards[0].rank === "A";
    hand.cards.push(draw(room.shoe));
    const total = scoreHand(hand.cards).total;
    const madnessNatural = room.mode === "doubleDownMadness" && isBlackjack(hand.cards);
    if (total > 21) {
      hand.status = "busted";
      hand.result = "BUST";
      room.message = `${player.name} busts. ${bustPhrase()}`;
      advanceTurn(room);
    } else if (madnessNatural) {
      player.bankroll += hand.bet * 2.5;
      hand.status = "won";
      hand.result = "BLACKJACK";
      advanceTurn(room);
    } else if (total === 21 || singleAceDraw) {
      hand.status = "standing";
      advanceTurn(room);
    }
  } else if (action === "stand") {
    hand.status = "standing";
    advanceTurn(room);
  } else if (action === "double") {
    const freeDouble = room.mode === "freeBet" && isFreeDouble(hand.cards);
    const doubleStake = hand.bet || hand.freeStake || player.bet;
    if ((room.mode === "doubleDownMadness" ? hand.cards.length < 1 || scoreHand(hand.cards).total >= 21 : hand.cards.length !== 2) ||
      (!freeDouble && player.bankroll < doubleStake)) {
      throw new RoomError("This hand cannot double", 409);
    }
    if (freeDouble) hand.freeStake = (hand.freeStake ?? 0) + doubleStake;
    else {
      player.bankroll -= doubleStake;
      hand.bet += doubleStake;
    }
    const singleAceDraw = room.mode === "doubleDownMadness" && hand.cards.length === 1 && hand.cards[0].rank === "A";
    hand.cards.push(draw(room.shoe));
    const madnessNatural = room.mode === "doubleDownMadness" && isBlackjack(hand.cards);
    if (scoreHand(hand.cards).total > 21) {
      hand.status = "busted";
      hand.result = "BUST";
    } else if (madnessNatural) {
      player.bankroll += hand.bet * 2.5;
      hand.status = "won";
      hand.result = "BLACKJACK";
    } else if (room.mode !== "doubleDownMadness" || singleAceDraw || scoreHand(hand.cards).total === 21) {
      hand.status = "standing";
    }
    if (hand.status !== "active") advanceTurn(room);
  } else if (action === "surrender") {
    if (room.mode === "doubleDownMadness" || hand.cards.length !== 2 || player.hands.length !== 1) {
      throw new RoomError("This hand cannot surrender", 409);
    }
    player.bankroll += Math.floor(hand.bet / 2);
    hand.status = "surrendered";
    hand.result = "SURRENDER";
    advanceTurn(room);
  } else if (action === "split") {
    const freeSplit = room.mode === "freeBet" && isFreeSplit(hand.cards);
    const splitStake = hand.bet || hand.freeStake || player.bet;
    if (
      room.mode === "doubleDownMadness" ||
      player.hands.length >= MAX_SPLIT_HANDS ||
      !canSplit(hand.cards) ||
      (!freeSplit && player.bankroll < splitStake)
    ) {
      throw new RoomError("This hand cannot split", 409);
    }
    if (!freeSplit) player.bankroll -= splitStake;
    const firstCards = [hand.cards[0], draw(room.shoe)];
    const secondCards = [hand.cards[1], draw(room.shoe)];
    const splitAces = hand.cards[0].rank === "A";
    const splitHands: RoomHand[] = [firstCards, secondCards].map((cards, index) => ({
      cards,
      bet: index === 1 ? (freeSplit ? 0 : splitStake) : hand.bet,
      freeStake: index === 1 && freeSplit ? splitStake : hand.freeStake,
      status: splitAces || scoreHand(cards).total === 21 ? "standing" : "active",
    }));
    const splitIndex = player.activeHand;
    player.hands = [
      ...player.hands.slice(0, splitIndex),
      ...splitHands,
      ...player.hands.slice(splitIndex + 1),
    ];
    const firstActiveSplit = splitHands.findIndex((candidate) => candidate.status === "active");
    if (firstActiveSplit === -1) {
      player.activeHand = splitIndex;
      advanceTurn(room);
    } else {
      player.activeHand = splitIndex + firstActiveSplit;
      room.message = `${player.name} plays hand ${player.activeHand + 1}`;
    }
  }

  return touch(room);
}
