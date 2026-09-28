import { NextRequest, NextResponse } from "next/server";
import { getRoom, RoomError, subscribeRoom } from "../../../../../lib/server/rooms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  try {
    getRoom(code);
  } catch (error) {
    const status = error instanceof RoomError ? error.status : 500;
    return NextResponse.json({ error: "Room not found" }, { status });
  }

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", cleanup);
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      try {
        unsubscribe = subscribeRoom(code, (room) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ room })}\n\n`));
          if (!room) {
            cleanup();
            controller.close();
          }
        });
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"));
        }, 20000);
      } catch {
        cleanup();
        controller.close();
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
