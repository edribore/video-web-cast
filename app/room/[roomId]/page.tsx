import { headers } from "next/headers";
import { DebugPageState } from "@/components/debug-runtime";
import { PageShell } from "@/components/page-shell";
import { RoomPlayerScaffold } from "@/components/room-player-scaffold";
import {
  resolveCastPublicBaseUrl,
  resolveRequestPublicBaseUrl,
} from "@/lib/public-origin";
import { normalizeRoomId } from "@/lib/room-id";
import { getRoomScaffoldSnapshot } from "@/server/room-sync";

export const dynamic = "force-dynamic";

type RoomPageProps = {
  params: Promise<{ roomId: string }>;
};

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;
  const normalizedRoomId = normalizeRoomId(roomId);
  const requestHeaders = await headers();
  const roomSnapshot = await getRoomScaffoldSnapshot(
    normalizedRoomId,
    resolveRequestPublicBaseUrl(requestHeaders),
    resolveCastPublicBaseUrl(requestHeaders),
  );

  return (
    <PageShell
      eyebrow="Watch room"
      title={roomSnapshot.movie?.title ?? roomSnapshot.media?.title ?? `Room ${roomSnapshot.roomId}`}
      description={
        roomSnapshot.movie?.synopsis ??
        "This SyncPass room keeps shared playback timing server-authoritative while local and Chromecast playback switch between a single active destination."
      }
    >
      <DebugPageState scope="page/room" data={roomSnapshot} />
      <RoomPlayerScaffold snapshot={roomSnapshot} />
    </PageShell>
  );
}
