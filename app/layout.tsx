import type { Metadata } from "next";
import { DebugRuntimeProvider } from "@/components/debug-runtime";
import {
  resolveConfiguredCastBaseUrl,
  resolveConfiguredPublicBaseUrl,
} from "@/lib/public-origin";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "video-web-cast",
  description: "Synchronized watch-party MVP scaffold",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const configuredPublicBaseUrl = resolveConfiguredPublicBaseUrl();
  const configuredCastBaseUrl = resolveConfiguredCastBaseUrl();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans text-foreground">
        <DebugRuntimeProvider
          appName="video-web-cast"
          environment={process.env.NODE_ENV ?? "development"}
          configuredPublicBaseUrl={configuredPublicBaseUrl}
          configuredCastBaseUrl={configuredCastBaseUrl}
        >
          {children}
        </DebugRuntimeProvider>
      </body>
    </html>
  );
}
