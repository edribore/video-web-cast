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
