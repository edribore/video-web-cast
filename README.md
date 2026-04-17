This is a synchronized watch-party MVP built with [Next.js](https://nextjs.org), PostgreSQL, and Prisma.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

`npm run dev` starts the custom Next.js server used for Socket.IO room synchronization.

For Chromecast testing on the same LAN, open the app from a LAN-reachable host
such as `http://192.168.x.x:3000`. If host detection is not enough in your
environment, set `PUBLIC_BASE_URL` to that reachable origin before starting the
server.

For HTTPS tunnel testing with Google Cast compatibility, set:

```bash
PUBLIC_BASE_URL=https://your-app.ngrok-free.app
# optional if Cast media should use a different public origin
CAST_BASE_URL=https://your-app.ngrok-free.app
```

When configured, the app uses those origins for absolute room links, media
debug URLs, and Cast media loading. Local development still works without those
env vars.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Remote Diagnostics

The room page now includes a debug-only `Remote Sync Diagnostics` drawer for
Chromecast, shared-room transport, overlay lifecycle, and PiP drift analysis.

Enable it with either:

```bash
# one-off from the room URL
http://localhost:3000/room/<roomId>?debugRemote=1&debugSync=1

# or persist it in local storage for this browser
localStorage.setItem("syncpass.remote-diagnostics", "1")
```

Disable it with either:

```bash
http://localhost:3000/room/<roomId>?debugRemote=0&debugSync=0
localStorage.setItem("syncpass.remote-diagnostics", "0")
```

What the drawer shows:

- Live event stream for raw keyboard / Cast remote / transport / player events
- Correlated event timeline with capture, send, server, receive, apply, render
- Clock sync RTT and server offset estimates
- Continuous drift snapshots for room time vs Chromecast vs web vs PiP
- Overlay show/hide timer lifecycle
- PiP following/divergence snapshots
- Export of the bounded in-memory session as JSON

Use the `Export JSON` button in the drawer to download the full active session.

## Diagnostics Test Plan

Run the automated checks with:

```bash
npm run test
npm run build
```

Manual room diagnostics procedure:

1. Open the same room in two browser clients. Enable diagnostics with `?debugRemote=1&debugSync=1`.
2. On the primary client, press `Space`, `J`, `L`, `Escape`, arrow keys, and `Enter`. Confirm the drawer shows the raw key, normalized action, and whether the input was ignored, applied, or sent.
3. On mobile or TV-style navigation, move focus so the overlay appears. Wait for it to fade. Confirm the overlay panel shows show trigger, timer start, timer reset, timer fire, and hide reason.
4. Start Cast from the room page, then use the Chromecast remote for play, pause, seek, back, and directional input. Confirm the event stream shows Cast remote observations, queued/ignored/received stages, and transport timing.
5. Compare `authoritative room`, `Chromecast actual`, and `web actual` in the drift panel while the room is playing. Confirm the deltas update continuously.
6. Perform repeated seek tests from both web and Chromecast. Watch the timeline for out-of-order, duplicate, stale, or gap warnings.
7. Spam play/pause from one client and confirm the second client receives correlated `server_received`, `broadcast`, `received`, `applied`, and `rendered` stages.
8. Enter browser PiP for the local video element if supported. Confirm the PiP panel shows active state, PiP time, main player time, room time, and whether PiP is still following canonical room playback.
9. Leave PiP, then export the JSON session and inspect the `events`, `correlatedTimelines`, `driftSnapshots`, `overlaySnapshots`, `pipSnapshots`, `clockSyncSamples`, and `sequenceSnapshots` sections.

## Database

The Prisma schema is configured for PostgreSQL, with the client generated to `app/generated/prisma`.

After setting `DATABASE_URL` in `.env`, run this migration command next:

```bash
npx prisma migrate dev --name watch_room_sync_foundation
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
