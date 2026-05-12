import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { SetupPlanner } from "./setup-planner";

export const metadata: Metadata = {
  title: "Setup Guide | Lodis",
  description:
    "Answer a few questions and get a Lodis setup path tailored to your AI tools, hosting choice, and starting context.",
};

export default function SetupGuide() {
  return (
    <>
      <Header />
      <main id="main" className="min-h-screen pt-24 pb-16 px-6">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/"
            className="text-text-muted hover:text-text transition-colors text-sm"
          >
            &larr; Back to home
          </Link>

          <h1 className="text-4xl sm:text-5xl font-bold mt-8 mb-4 tracking-tight">
            Setup{" "}
            <span className="bg-gradient-to-r from-glow to-violet bg-clip-text text-transparent">
              Guide
            </span>
          </h1>
          <p className="text-text-muted text-lg mb-12 leading-relaxed">
            Answer a few questions, then follow the path that matches your tools,
            hosting choice, and starting point.
          </p>

          <SetupPlanner />
        </div>
      </main>
      <Footer />
    </>
  );
}
