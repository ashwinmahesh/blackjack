import { NextResponse } from "next/server";
import { getRoom, RoomError } from "../../../../lib/server/rooms";

export const dynamic = "force-dynamic";

export function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return params
    .then(({ code }) => NextResponse.json({ room: getRoom(code) }))
    .catch((error: unknown) => {
      const status = error instanceof RoomError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Could not load room";
      return NextResponse.json({ error: message }, { status });
    });
}
