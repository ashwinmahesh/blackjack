import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  canSplit,
  createCutPoint,
  createShoe,
  isBlackjack,
  playDealer,
  scoreHand,
  type Card,
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
  status: RoomHandStatus;
  result?: string;
};

type StoredPlayer = {
  id: string;
  sessionHash: string;
  name: string;
  bankroll: number;
  bet: number;
  ready: boolean;
  joinedAt: number;
  hands: RoomHand[];
  activeHand: number;
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
  table: RoomTable;
  players: StoredPlayer[];
  shoe: Card[];
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
};

const sharedGlobal = globalThis as RoomStoreGlobal;
const rooms = sharedGlobal.__dealersEdgeRooms ?? new Map<string, StoredRoom>();
sharedGlobal.__dealersEdgeRooms = rooms;

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
    if (room.updatedAt < expiry) rooms.delete(code);
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
  return publicRoom(room);
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

function settleRoom(room: StoredRoom) {
  const hasLiveHand = room.players.some((player) =>
    player.hands.some(
      (hand) => !["busted", "surrendered", "won"].includes(hand.status),
    ),
  );
  if (hasLiveHand) {
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
      if (dealerTotal > 21 || total > dealerTotal) {
        player.bankroll += hand.bet * 2;
        return { ...hand, status: "won", result: dealerTotal > 21 ? "DEALER BUST" : "WIN" };
      }
      if (total === dealerTotal) {
        player.bankroll += hand.bet;
        return { ...hand, status: "push", result: "PUSH" };
      }
      return { ...hand, status: "lost", result: "DEALER WINS" };
    });
  }

  room.phase = "settled";
  room.currentPlayerId = null;
  room.message = dealerTotal > 21 ? "Dealer busts — round settled" : `Dealer stands on ${dealerTotal}`;
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
  for (const player of participating) player.hands[0].cards.push(draw(room.shoe));
  room.dealer.push(draw(room.shoe));

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
    room.phase = "settled";
    room.currentPlayerId = null;
    room.message = "Dealer has blackjack";
    return;
  }

  const firstPlayer = participating.find((player) => activeHands(player).length > 0);
  if (!firstPlayer) {
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

export function createRoom(input: {
  name: string;
  passcode: string;
  startingBankroll?: number;
  tableId?: string;
}) {
  pruneExpiredRooms();
  const name = cleanName(input.name);
  const passcode = cleanPasscode(input.passcode);
  if (name.length < 2) throw new RoomError("Enter a name with at least 2 characters", 400);
  if (passcode.length < 4) throw new RoomError("Passcode must be at least 4 characters", 400);

  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const requestedBankroll = Math.floor(input.startingBankroll ?? 1000);
  const bankroll =
    Number.isFinite(requestedBankroll) && requestedBankroll > 0 && requestedBankroll <= 10_000_000
      ? requestedBankroll
      : 1000;
  const selectedTable = ROOM_TABLES.find((table) => table.id === input.tableId) ?? ROOM_TABLES[0];
  const hostToken = playerToken();
  const host: StoredPlayer = {
    id: randomBytes(6).toString("base64url"),
    sessionHash: hashPlayerToken(hostToken),
    name,
    bankroll,
    bet: 0,
    ready: false,
    joinedAt: Date.now(),
    hands: [],
    activeHand: 0,
  };
  const room: StoredRoom = {
    code,
    passcodeHash: hashPasscode(code, passcode),
    hostId: host.id,
    phase: "lobby",
    table: { ...selectedTable, chips: [...selectedTable.chips] },
    players: [host],
    shoe: createShoe(4),
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

export function joinRoom(input: { code: string; name: string; passcode: string }) {
  const room = requireRoom(input.code);
  const name = cleanName(input.name);
  if (name.length < 2) throw new RoomError("Enter a name with at least 2 characters", 400);
  if (!passcodesMatch(room.passcodeHash, hashPasscode(room.code, input.passcode))) {
    throw new RoomError("Incorrect room passcode", 403);
  }
  if (room.players.length >= MAX_PLAYERS) throw new RoomError("This table is full", 409);
  if (room.phase !== "lobby") throw new RoomError("This table has already started", 409);

  const playerTokenValue = playerToken();
  const player: StoredPlayer = {
    id: randomBytes(6).toString("base64url"),
    sessionHash: hashPlayerToken(playerTokenValue),
    name,
    bankroll: room.players[0]?.bankroll ?? 1000,
    bet: 0,
    ready: false,
    joinedAt: Date.now(),
    hands: [],
    activeHand: 0,
  };
  room.players.push(player);
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
  action: "bet" | "hit" | "stand" | "double" | "split" | "surrender" | "next-round",
  amount?: number,
) {
  const room = requireRoom(code);
  const player = requirePlayer(room, playerId);

  if (action === "next-round") {
    if (player.id !== room.hostId) throw new RoomError("Only the host can open the next round", 403);
    if (room.phase !== "settled") throw new RoomError("The current round is not settled", 409);
    if (room.shoe.length <= room.cutPoint) {
      room.shoe = createShoe(4);
      room.cutPoint = createCutPoint();
    }
    room.dealer = [];
    room.currentPlayerId = null;
    room.phase = "betting";
    room.round += 1;
    room.message = `Place bets — minimum ${room.table.minimum}`;
    for (const candidate of room.players) {
      candidate.bet = 0;
      candidate.hands = [];
      candidate.activeHand = 0;
    }
    return touch(room);
  }

  if (action === "bet") {
    if (room.phase !== "betting") throw new RoomError("The table is not taking bets", 409);
    const wager = Math.floor(amount ?? 0);
    if (wager < room.table.minimum) throw new RoomError(`Minimum bet is ${room.table.minimum}`, 400);
    if (wager > player.bankroll) throw new RoomError("Not enough tokens", 409);
    if (player.bet > 0) throw new RoomError("Bet already placed", 409);
    player.bet = wager;
    player.bankroll -= wager;
    room.message = `${player.name} is in for ${wager}`;
    if (room.players.every((candidate) => candidate.bet > 0)) dealRoomRound(room);
    return touch(room);
  }

  if (room.phase !== "playing") throw new RoomError("There is no active hand", 409);
  if (room.currentPlayerId !== player.id) throw new RoomError("It is not your turn", 409);
  const hand = player.hands[player.activeHand];
  if (!hand || hand.status !== "active") throw new RoomError("This hand is complete", 409);

  if (action === "hit") {
    hand.cards.push(draw(room.shoe));
    const total = scoreHand(hand.cards).total;
    if (total > 21) {
      hand.status = "busted";
      hand.result = "BUST";
      advanceTurn(room);
    } else if (total === 21) {
      hand.status = "standing";
      advanceTurn(room);
    }
  } else if (action === "stand") {
    hand.status = "standing";
    advanceTurn(room);
  } else if (action === "double") {
    if (hand.cards.length !== 2 || player.bankroll < hand.bet) {
      throw new RoomError("This hand cannot double", 409);
    }
    player.bankroll -= hand.bet;
    hand.bet *= 2;
    hand.cards.push(draw(room.shoe));
    if (scoreHand(hand.cards).total > 21) {
      hand.status = "busted";
      hand.result = "BUST";
    } else {
      hand.status = "standing";
    }
    advanceTurn(room);
  } else if (action === "surrender") {
    if (hand.cards.length !== 2 || player.hands.length !== 1) {
      throw new RoomError("This hand cannot surrender", 409);
    }
    player.bankroll += Math.floor(hand.bet / 2);
    hand.status = "surrendered";
    hand.result = "SURRENDER";
    advanceTurn(room);
  } else if (action === "split") {
    if (player.hands.length !== 1 || !canSplit(hand.cards) || player.bankroll < hand.bet) {
      throw new RoomError("This hand cannot split", 409);
    }
    player.bankroll -= hand.bet;
    const firstCards = [hand.cards[0], draw(room.shoe)];
    const secondCards = [hand.cards[1], draw(room.shoe)];
    const splitAces = hand.cards[0].rank === "A";
    player.hands = [firstCards, secondCards].map((cards) => ({
      cards,
      bet: hand.bet,
      status: splitAces || scoreHand(cards).total === 21 ? "standing" : "active",
    }));
    player.activeHand = player.hands.findIndex((candidate) => candidate.status === "active");
    if (player.activeHand === -1) {
      player.activeHand = 0;
      advanceTurn(room);
    }
  }

  return touch(room);
}
