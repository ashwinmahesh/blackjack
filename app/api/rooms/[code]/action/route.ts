import { NextRequest, NextResponse } from "next/server";
import { roomAction, RoomError } from "../../../../../lib/server/rooms";
import type { SideBets } from "../../../../../lib/blackjack";

export const dynamic = "force-dynamic";

type RoomAction = "bet" | "hit" | "stand" | "double" | "split" | "surrender" | "next-round" | "donate" | "leave" | "kick";

const ACTIONS: RoomAction[] = ["bet", "hit", "stand", "double", "split", "surrender", "next-round", "donate", "leave", "kick"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await request.json()) as {
      playerId?: string;
      action?: RoomAction;
      amount?: number;
      targetId?: string;
      sideBets?: SideBets;
    };
    if (!body.action || !ACTIONS.includes(body.action)) {
      return NextResponse.json({ error: "Unknown room action" }, { status: 400 });
    }
    const room = roomAction(code, body.playerId ?? "", body.action, body.amount, body.targetId, body.sideBets);
    return NextResponse.json({ room });
  } catch (error) {
    const status = error instanceof RoomError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not update table";
    return NextResponse.json({ error: message }, { status });
  }
}
