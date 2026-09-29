import { NextRequest, NextResponse } from "next/server";
import { createRoom, RoomError } from "../../../lib/server/rooms";
import type { GameMode } from "../../../lib/blackjack";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      name?: string;
      passcode?: string;
      startingBankroll?: number;
      mode?: GameMode;
    };
    const result = createRoom({
      name: body.name ?? "",
      passcode: body.passcode ?? "",
      startingBankroll: body.startingBankroll,
      mode: body.mode,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof RoomError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not create room";
    return NextResponse.json({ error: message }, { status });
  }
}
