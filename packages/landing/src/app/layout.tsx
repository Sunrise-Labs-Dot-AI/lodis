import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Engrams | Universal AI Memory Layer",
  description:
    "A universal memory layer for AI agents. Searchable, correctable, portable. Install once, remember everywhere.",
  openGraph: {
    title: "Engrams | Universal AI Memory Layer",
    description:
      "A universal memory layer for AI agents. Searchable, correctable, portable. Install once, remember everywhere.",
    siteName: "Engrams",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Add `js` class before paint so CSS can gate the scroll-reveal
          hidden state on JS being present. Without this, noscript users
          and crawlers would see blank below-fold sections.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
      </head>
      <body className="antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
