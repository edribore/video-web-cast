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
      title={`Room ${roomSnapshot.roomId}`}
      description="This room keeps shared playback timing server-authoritative while audio and subtitle choices stay per participant. Chromecast mirrors the same room timeline and uses the current participant track selection when a Cast session is active."
    >
      <DebugPageState scope="page/room" data={roomSnapshot} />
      <RoomPlayerScaffold snapshot={roomSnapshot} />
    </PageShell>
  );
}
