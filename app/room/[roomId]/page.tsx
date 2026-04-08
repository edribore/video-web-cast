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
      title={`Room ${roomSnapshot.roomId}`}
      description="This room keeps shared playback timing server-authoritative while subtitle choices stay local to each participant. Chromecast mirrors the same shared room timeline when a Cast session is active."
    >
      <DebugPageState scope="page/room" data={roomSnapshot} />
      <RoomPlayerScaffold snapshot={roomSnapshot} />
    </PageShell>
  );
}
