import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { Problem } from "@/components/problem";
import { Solution } from "@/components/solution";
import { Tools } from "@/components/tools";
import { Architecture } from "@/components/architecture";
import { Deployment } from "@/components/deployment";
import { Install } from "@/components/install";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <>
      <Header />
      <main id="main">
        <Hero />
        <div className="section-divider" />
        <Problem />
        <div className="section-divider" />
        <Solution />
        <div className="section-divider" />
        <Tools />
        <div className="section-divider" />
        <Architecture />
        <div className="section-divider" />
        <Deployment />
        <div className="section-divider" />
        <Install />
      </main>
      <Footer />
    </>
  );
}
