import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Nav } from "@/components/nav";
import "@/globals.css";

export const metadata: Metadata = {
  title: "Engrams",
  description: "AI memory dashboard",
};

const isHosted = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const content = (
    <html lang="en" className="dark">
      <body className="min-h-screen">
        <header className="border-b border-[var(--color-border)] bg-[rgba(17,24,39,0.8)] backdrop-blur-xl">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold text-[var(--color-glow)]">
                engrams
              </h1>
            </div>
            <Nav />
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );

  return isHosted ? <ClerkProvider>{content}</ClerkProvider> : content;
}
