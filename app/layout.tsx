import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open-Endedness Benchmark — Can LLMs be funny?",
  description:
    "Measure LLM open-endedness by having models tell jokes, then scoring response diversity across providers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Fonts via <link> rather than next/font so the build needs no
            network access; they degrade to the system stack offline. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
