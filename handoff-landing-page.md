# Handoff: Landing Page + Dashboard Restyle — Pensieve Design System

**Repo:** `Sunrise-Labs-Dot-AI/engrams` (local at `~/Documents/Claude/Projects/engrams`)
**Branch:** `main`
**Budget:** $20
**Timeout:** 45 min

## Context

Two related tasks:
1. Build a public landing page at `getengrams.com` (`packages/landing`)
2. Restyle the existing dashboard (`packages/dashboard`) with the same design system

Read `CLAUDE.md` in the repo root for full product context.

**Repo structure:** pnpm monorepo with `packages/core`, `packages/mcp-server`, `packages/dashboard`. The landing page will be a new `packages/landing` package.

## Creative Direction

**"Developer tool meets Pensieve from Harry Potter."**

The Pensieve is a shallow stone basin where extracted memories swirl as a luminous, silvery-white substance — not quite liquid, not quite gas. Memories appear as glowing threads that can be pulled, examined, and returned. The aesthetic is ethereal, luminescent, contemplative.

Merge that with the precision and clarity of a developer tool. The result:

### Visual Language

**Color palette:**
- **Primary background:** Deep indigo-black (`#0a0e1a`) — like looking into the Pensieve basin
- **Secondary background:** Dark slate-blue (`#111827`) — card surfaces, elevated elements
- **Accent glow:** Soft silver-blue (`#7dd3fc` to `#bae6fd`) — the memory substance. Used for highlights, interactive elements, borders on hover
- **Secondary accent:** Warm violet (`#a78bfa` to `#c4b5fd`) — for entity types, graph connections
- **Text primary:** Cool white (`#e2e8f0`) — high contrast but not harsh
- **Text secondary:** Muted silver (`#94a3b8`)
- **Success/confirm:** Soft emerald (`#34d399`)
- **Warning:** Amber glow (`#fbbf24`)
- **DO NOT use:** Pure white backgrounds, generic blue buttons, shadcn/ui gray scale, or anything that looks like a default Tailwind template

**Typography:**
- **Headings:** A clean sans-serif with slight character — use `Inter` with tight letter-spacing (-0.02em) or `Cal Sans` for the hero
- **Body:** `Inter` at regular weight
- **Code/technical:** `JetBrains Mono` — for MCP tool names, config snippets, terminal output
- **Sizing:** Large hero text (4xl-6xl), generous line-height, don't crowd the page

**Visual effects:**
- **Glowing orbs/particles:** Subtle CSS-animated radial gradients that drift slowly, like memory threads floating in the Pensieve. Use `background: radial-gradient(...)` with `animation: float` on pseudo-elements. 2-3 orbs maximum — ethereal, not carnival.
- **Glassmorphism on cards:** `backdrop-filter: blur(12px)` + semi-transparent backgrounds (`rgba(17, 24, 39, 0.7)`) + 1px border with subtle glow (`border-color: rgba(125, 211, 252, 0.1)`). Cards feel like looking through enchanted glass.
- **Hover states:** Elements gain a soft luminescent border glow on hover — `box-shadow: 0 0 20px rgba(125, 211, 252, 0.15)`. Transition 300ms.
- **Section dividers:** No hard lines. Use gradient fades (`linear-gradient(transparent, rgba(125, 211, 252, 0.05), transparent)`) instead.
- **Code blocks:** Dark background with subtle left-border accent glow. Syntax highlighting that feels magical — silver for strings, violet for keywords, emerald for values.

**Layout principles:**
- Generous whitespace — let the page breathe like a vast stone chamber
- Full-width sections with max-w-6xl content
- Asymmetric layouts welcome — not every section needs to be centered
- Scroll-triggered reveals (CSS `animation` with `IntersectionObserver`, not a library)

**What it should NOT look like:**
- A shadcn/ui template with gray cards and blue buttons
- A generic SaaS landing page with stock photos
- Anything with a white background
- Stripe's landing page (too corporate)
- A gaming site (too aggressive)

**What it SHOULD feel like:**
- Looking into a Pensieve — deep, luminous, contemplative
- Linear.app's dark aesthetic (clean, dev-focused) but warmer and more mystical
- A product that takes memory seriously — weight and gravity, not playful

### Imagery

No stock photos. No illustrations. The visuals are:
1. **The product itself:** Dashboard screenshots (we'll add these later — leave placeholder divs with the right aspect ratio and a subtle shimmer animation)
2. **Abstract memory visualization:** CSS/SVG animated elements that suggest swirling memory threads — interconnected nodes, flowing lines, gentle particle systems. All code-generated, no image files.
3. **Code snippets:** Real MCP config examples styled as terminal/editor blocks

## Page Structure

### Hero Section

Full viewport height. Dark indigo background with 2-3 slowly drifting luminous orbs (CSS animation).

**Headline:** "Your AI's memory, made visible."
**Subhead:** "A universal memory layer for AI agents — searchable, correctable, portable. Install once, remember everywhere."
**CTA:** Two buttons:
- Primary: "Get Started" → scrolls to install section. Glowing border, filled background.
- Secondary: "View on GitHub" → github.com/Sunrise-Labs-Dot-AI/engrams. Ghost style with subtle border.

Below the buttons, a terminal-style code block showing the install:
```json
{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}
```
Caption: "Add to Claude Code, Cursor, Windsurf, or any MCP client. That's it."

### Problem Section

**Headline:** "AI memory is broken."

Three cards in a row, each with an icon (lucide or custom SVG) and description:

1. **Invisible** — "Your AI remembers things about you, but you can't see what. OpenAI gives you a flat list. That's the state of the art."
2. **Siloed** — "Teach Claude your preferences, and Cursor doesn't know. Each tool's memory is a walled garden."
3. **Untrustworthy** — "Every memory is binary — it exists or it doesn't. No confidence score, no source attribution, no way to trace mistakes."

### Solution Section

**Headline:** "Engrams makes AI memory yours."

Three feature blocks (alternating layout: text left/visual right, then reversed):

1. **Search & Retrieve**
   "Hybrid search combines full-text and vector embeddings. Your agent finds the right memory even when the wording differs."
   Visual: Mock search query → results with confidence scores

2. **Correct & Control**
   "Confirm what's right. Correct what's wrong. Split compound memories. Flag mistakes. Your AI learns from your feedback."
   Visual: Memory card with confirm/correct/split actions

3. **Connect & Understand**
   "Memories form a knowledge graph. People, projects, preferences — automatically linked. Entity types extracted. Contradictions detected."
   Visual: Mini graph visualization (CSS/SVG animated nodes and edges)

### Tools Section

**Headline:** "16 MCP tools. One install."

A grid of tool cards — compact, showing tool name in monospace and a one-line description. Group into categories:

**Core:** memory_search, memory_write, memory_update, memory_remove
**Trust:** memory_confirm, memory_correct, memory_flag_mistake
**Graph:** memory_connect, memory_get_connections, memory_split
**Discovery:** memory_list, memory_list_domains, memory_list_entities, memory_classify
**Safety:** memory_scrub, memory_set_permissions

Each card has a subtle glow on hover. The tool name is in `JetBrains Mono`.

### Architecture Section

**Headline:** "Local-first. Zero config."

```
~/.engrams/engrams.db  ← Your memories live here. On your machine.
```

Key facts as icon + text pairs:
- SQLite + FTS5 + sqlite-vec — no external database
- Embeddings run locally (Transformers.js) — no API calls for search
- 0600 file permissions — OS-level access control
- JSON export — your data is always yours
- Optional cloud sync (Pro) — AES-256-GCM encrypted, zero-knowledge

### Install Section

**Headline:** "Get started in 30 seconds."

Tabbed code blocks for each client:

**Claude Code** (`~/.claude.json`):
```json
{
  "mcpServers": {
    "engrams": {
      "command": "npx",
      "args": ["-y", "engrams"]
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
Same config.

**Cursor** (`.cursor/mcp.json`):
Same config.

**Windsurf** (`~/.windsurf/mcp.json`):
Same config.

Each tab has the file path as a caption above the code block.

### Footer

Minimal. One line:
"Built by [Sunrise Labs](https://sunrise-labs.ai) · [GitHub](https://github.com/Sunrise-Labs-Dot-AI/engrams) · [npm](https://npmjs.com/package/engrams)"

## Technical Implementation

### Package setup

```bash
mkdir -p packages/landing
cd packages/landing
```

Create `packages/landing/package.json`:
```json
{
  "name": "@engrams/landing",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15.3.1",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "clsx": "^2.1.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.2.0",
    "@types/node": "25.5.2",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "tailwindcss": "^4.2.0",
    "typescript": "^5.8.3"
  }
}
```

Create `packages/landing/next.config.mjs`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

Create `packages/landing/tsconfig.json` — standard Next.js 15 tsconfig with `@/` path alias.

Create `packages/landing/postcss.config.mjs`:
```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

### Fonts

Load Inter and JetBrains Mono via `next/font/google` in layout.tsx:
```typescript
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
```

### CSS

Create `packages/landing/src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-void: #0a0e1a;
  --color-surface: #111827;
  --color-surface-raised: #1e293b;
  --color-glow: #7dd3fc;
  --color-glow-soft: #bae6fd;
  --color-violet: #a78bfa;
  --color-violet-soft: #c4b5fd;
  --color-emerald: #34d399;
  --color-amber: #fbbf24;
  --color-text: #e2e8f0;
  --color-text-muted: #94a3b8;
  --color-text-dim: #64748b;
  --color-border: rgba(125, 211, 252, 0.1);
  --color-border-hover: rgba(125, 211, 252, 0.25);

  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
}

body {
  background-color: var(--color-void);
  color: var(--color-text);
  font-family: var(--font-sans);
}

/* Floating orb animation */
@keyframes float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25% { transform: translate(30px, -20px) scale(1.05); }
  50% { transform: translate(-20px, 15px) scale(0.95); }
  75% { transform: translate(15px, 25px) scale(1.02); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  animation: float 20s ease-in-out infinite;
  pointer-events: none;
}

.orb-1 {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, rgba(125, 211, 252, 0.15), transparent 70%);
  top: 10%;
  left: 20%;
  animation-delay: 0s;
}

.orb-2 {
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, rgba(167, 139, 250, 0.12), transparent 70%);
  top: 40%;
  right: 15%;
  animation-delay: -7s;
}

.orb-3 {
  width: 250px;
  height: 250px;
  background: radial-gradient(circle, rgba(52, 211, 153, 0.08), transparent 70%);
  bottom: 20%;
  left: 40%;
  animation-delay: -13s;
}

/* Glass card */
.glass {
  background: rgba(17, 24, 39, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  transition: border-color 300ms, box-shadow 300ms;
}

.glass:hover {
  border-color: var(--color-border-hover);
  box-shadow: 0 0 20px rgba(125, 211, 252, 0.08);
}

/* Code block styling */
.code-block {
  background: rgba(10, 14, 26, 0.9);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-glow);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  line-height: 1.7;
  padding: 1.5rem;
  overflow-x: auto;
}

/* Placeholder shimmer for future screenshots */
.screenshot-placeholder {
  background: linear-gradient(
    90deg,
    rgba(17, 24, 39, 0.5) 25%,
    rgba(125, 211, 252, 0.05) 50%,
    rgba(17, 24, 39, 0.5) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 3s ease-in-out infinite;
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

/* Section gradient divider */
.section-divider {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(125, 211, 252, 0.15),
    transparent
  );
  margin: 4rem 0;
}

/* Glow button */
.btn-glow {
  background: linear-gradient(135deg, rgba(125, 211, 252, 0.15), rgba(167, 139, 250, 0.15));
  border: 1px solid var(--color-border-hover);
  color: var(--color-glow-soft);
  padding: 0.75rem 2rem;
  border-radius: 8px;
  font-weight: 500;
  transition: all 300ms;
  cursor: pointer;
}

.btn-glow:hover {
  background: linear-gradient(135deg, rgba(125, 211, 252, 0.25), rgba(167, 139, 250, 0.25));
  box-shadow: 0 0 30px rgba(125, 211, 252, 0.15);
  border-color: var(--color-glow);
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  padding: 0.75rem 2rem;
  border-radius: 8px;
  font-weight: 500;
  transition: all 300ms;
  cursor: pointer;
}

.btn-ghost:hover {
  border-color: var(--color-border-hover);
  color: var(--color-text);
}
```

### Page structure

Single page: `packages/landing/src/app/page.tsx`

Build each section as its own component in `packages/landing/src/components/`:
- `hero.tsx`
- `problem.tsx`
- `solution.tsx`
- `tools.tsx`
- `architecture.tsx`
- `install.tsx`
- `footer.tsx`

The `install.tsx` component needs a client-side tab switcher (`"use client"`) for the client configs. Everything else can be a server component.

### Memory thread SVG animation (hero background element)

Create a subtle SVG animation for the hero that suggests interconnected memories — a few nodes connected by curved lines, gently pulsing. Build this as an SVG with CSS animations, not canvas or JS. Keep it understated — it's a background element, not the focus.

```typescript
// packages/landing/src/components/memory-threads.tsx
export function MemoryThreads() {
  // 5-7 small circles (nodes) connected by curved paths
  // Circles pulse opacity between 0.3 and 0.7
  // Paths have a subtle dash animation (stroke-dashoffset)
  // Colors: glow and violet
  // Positioned absolutely behind the hero text
}
```

### Scroll-triggered reveals

Use IntersectionObserver to add a `.revealed` class when sections enter the viewport. CSS handles the animation:

```css
.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 600ms, transform 600ms;
}
.reveal.revealed {
  opacity: 1;
  transform: translateY(0);
}
```

Create a small client component `packages/landing/src/components/reveal.tsx`:
```typescript
"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) el.classList.add("revealed"); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${className ?? ""}`}>{children}</div>;
}
```

## Update turbo.json

Add the landing package to the workspace. In the root `pnpm-workspace.yaml` (if it exists) or `package.json` workspaces, the `packages/*` glob should already cover it.

Update `turbo.json` if needed to include the landing package in the build pipeline (should work automatically via `packages/*`).

---

## Part 2: Dashboard Restyle

Apply the same Pensieve design system to the existing dashboard. The dashboard currently uses a generic zinc/violet dark theme. Restyle it to match the landing page's aesthetic while keeping all functionality intact.

### Dashboard globals.css rewrite

Replace the contents of `packages/dashboard/src/globals.css`. The dashboard only uses dark mode (the `<html>` tag has `className="dark"`), so remove the light mode variables entirely.

```css
@import "tailwindcss";

/* Pensieve design system — shared with landing page */
:root, .dark {
  --color-bg: #0a0e1a;
  --color-bg-soft: #111827;
  --color-card: rgba(17, 24, 39, 0.7);
  --color-card-hover: rgba(30, 41, 59, 0.7);
  --color-accent: #7dd3fc;
  --color-accent-solid: #38bdf8;
  --color-accent-soft: rgba(125, 211, 252, 0.1);
  --color-accent-text: #bae6fd;
  --color-text: #e2e8f0;
  --color-text-secondary: #94a3b8;
  --color-text-muted: #64748b;
  --color-border: rgba(125, 211, 252, 0.1);
  --color-border-light: rgba(125, 211, 252, 0.05);
  --color-border-hover: rgba(125, 211, 252, 0.25);
  --color-success: #34d399;
  --color-success-bg: rgba(52, 211, 153, 0.1);
  --color-warning: #fbbf24;
  --color-warning-bg: rgba(251, 191, 36, 0.1);
  --color-danger: #ef4444;
  --color-danger-bg: rgba(239, 68, 68, 0.1);
  --color-violet: #a78bfa;
  --color-violet-soft: rgba(167, 139, 250, 0.12);
  --color-glow: #7dd3fc;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
```

Key changes from the current theme:
- Background goes from zinc-900 (`#18181b`) to deep indigo (`#0a0e1a`)
- Cards get `backdrop-filter: blur` treatment (glassmorphism)
- Borders change from solid zinc to translucent silver-blue glow
- Accent shifts from purple to silver-blue (Pensieve glow)
- Text colors shift from zinc to slate (cooler, more ethereal)

### Card component — glassmorphism

Update `packages/dashboard/src/components/ui/card.tsx`:

```typescript
import clsx from "clsx";
import { type HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export function Card({ hover, className, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        "bg-[var(--color-card)] backdrop-blur-xl border border-[var(--color-border)] rounded-xl transition-all duration-300",
        hover && "hover:bg-[var(--color-card-hover)] hover:border-[var(--color-border-hover)] hover:shadow-[0_0_20px_rgba(125,211,252,0.08)] cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}
```

### Button component — glow treatment

Update `packages/dashboard/src/components/ui/button.tsx`:

```typescript
"use client";

import { type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-gradient-to-r from-[rgba(125,211,252,0.15)] to-[rgba(167,139,250,0.15)] border border-[var(--color-border-hover)] text-[var(--color-accent-text)] hover:from-[rgba(125,211,252,0.25)] hover:to-[rgba(167,139,250,0.25)] hover:shadow-[0_0_20px_rgba(125,211,252,0.12)] hover:border-[var(--color-glow)]",
  secondary:
    "bg-[var(--color-bg-soft)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-card-hover)]",
  danger:
    "bg-[var(--color-danger-bg)] text-[var(--color-danger)] border border-[rgba(239,68,68,0.2)] hover:border-[rgba(239,68,68,0.4)] hover:shadow-[0_0_15px_rgba(239,68,68,0.1)]",
  ghost:
    "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[rgba(125,211,252,0.05)]",
};

const sizeStyles: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs rounded-md",
  md: "px-3.5 py-1.5 text-sm rounded-lg",
  lg: "px-5 py-2.5 text-base rounded-lg",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center font-medium transition-all duration-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  );
}
```

### StatusBadge — translucent with glow

Update `packages/dashboard/src/components/ui/status-badge.tsx`:

```typescript
import clsx from "clsx";

type BadgeVariant = "success" | "warning" | "danger" | "neutral" | "accent";

const variantStyles: Record<BadgeVariant, string> = {
  success: "bg-[var(--color-success-bg)] text-[var(--color-success)] border border-[rgba(52,211,153,0.2)]",
  warning: "bg-[var(--color-warning-bg)] text-[var(--color-warning)] border border-[rgba(251,191,36,0.2)]",
  danger: "bg-[var(--color-danger-bg)] text-[var(--color-danger)] border border-[rgba(239,68,68,0.2)]",
  neutral: "bg-[rgba(148,163,184,0.08)] text-[var(--color-text-secondary)] border border-[rgba(148,163,184,0.1)]",
  accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent-text)] border border-[rgba(125,211,252,0.15)]",
};

interface StatusBadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({
  variant = "neutral",
  children,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
```

### Modal — glass overlay

Update `packages/dashboard/src/components/ui/modal.tsx`:

Change the overlay from `bg-black/40` to `bg-[rgba(10,14,26,0.8)] backdrop-blur-sm` and the modal panel from `bg-[var(--color-card)]` to `bg-[var(--color-bg-soft)] backdrop-blur-xl border-[var(--color-border-hover)]`:

```typescript
// Overlay:
className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(10,14,26,0.8)] backdrop-blur-sm"

// Panel:
className={clsx(
  "bg-[var(--color-bg-soft)] backdrop-blur-xl border border-[var(--color-border-hover)] rounded-xl shadow-[0_0_40px_rgba(125,211,252,0.05)] w-full mx-4 p-6 max-h-[85vh] overflow-y-auto",
  size === "sm" && "max-w-sm",
  size === "md" && "max-w-md",
  size === "lg" && "max-w-xl",
)}
```

### ConfidenceBar — glow treatment

Update `packages/dashboard/src/components/confidence-bar.tsx`:

Change the track from `bg-[var(--color-bg-soft)]` to `bg-[rgba(125,211,252,0.05)]` and add a subtle glow to the fill bar:

```typescript
export function ConfidenceBar({ confidence, showLabel = true }: ConfidenceBarProps) {
  const color = confidenceColor(confidence);
  const pct = Math.round(confidence * 100);

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[rgba(125,211,252,0.05)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            boxShadow: `0 0 8px ${color}40`,
          }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-medium tabular-nums" style={{ color }}>
          {formatConfidence(confidence)}
        </span>
      )}
    </div>
  );
}
```

### Layout — header glow border

Update `packages/dashboard/src/app/layout.tsx` header:

Change the header from `border-b border-[var(--color-border)] bg-[var(--color-card)]` to:

```typescript
<header className="border-b border-[var(--color-border)] bg-[rgba(17,24,39,0.8)] backdrop-blur-xl">
```

Also update the Engrams title color to use the glow color:

```typescript
<h1 className="text-lg font-bold text-[var(--color-glow)]">
  Engrams
</h1>
```

### Nav links — active state glow

In `packages/dashboard/src/components/nav.tsx`, update the active link styling. Currently active links likely use a simple background highlight. Change to:

Active: `text-[var(--color-accent-text)] bg-[var(--color-accent-soft)]`
Hover: `hover:text-[var(--color-text)] hover:bg-[rgba(125,211,252,0.05)]`

### Memory card adjustments

The `MemoryCard` component in `packages/dashboard/src/components/memory-card.tsx` already uses the Card and Button components, so it will inherit the glass treatment. But update the expanded section's border:

Change `border-t border-[var(--color-border-light)]` to `border-t border-[var(--color-border)]`.

### Graph visualization — update colors

In `packages/dashboard/src/components/knowledge-graph.tsx`, update the entity type color map to align with the Pensieve palette:

```typescript
const ENTITY_COLORS: Record<string, string> = {
  person: "#7dd3fc",     // glow blue
  organization: "#a78bfa", // violet
  place: "#34d399",       // emerald
  project: "#fbbf24",     // amber
  preference: "#f472b6",  // pink
  event: "#fb923c",       // orange
  goal: "#f87171",        // red
  fact: "#94a3b8",        // slate
};
```

Also update the graph background to match the new `--color-bg` and any tooltip backgrounds to use `var(--color-bg-soft)` with `backdrop-blur`.

### Cleanup page, Settings page, Agents page

These pages use the same Card, Button, and Badge components, so they'll inherit the restyle automatically. Scan each page for any hardcoded colors (e.g., direct hex values or zinc references) and replace with CSS custom properties from the new palette.

Check these files:
- `packages/dashboard/src/app/cleanup/page.tsx`
- `packages/dashboard/src/app/settings/page.tsx`
- `packages/dashboard/src/app/agents/page.tsx`
- `packages/dashboard/src/components/memory-filters.tsx`
- `packages/dashboard/src/components/editable-memory.tsx`

### What NOT to change

- **Component structure and functionality** — don't change how components work, only how they look
- **Tailwind utility usage** — keep using `var(--color-*)` custom properties, don't hardcode colors in component classes
- **Dark mode class** — keep `className="dark"` on `<html>`, the new variables are defined under both `:root` and `.dark`

---

## Verification

### Landing page
```bash
cd packages/landing && pnpm install && pnpm dev
```

Open `http://localhost:3000` and verify:
1. Hero section loads with floating orbs and memory thread SVG
2. All sections render with correct content
3. Glass cards have blur and glow on hover
4. Code blocks have the accent left-border
5. Tab switcher works on install section
6. Scroll reveals trigger on scroll
7. No white backgrounds, no shadcn-looking elements
8. Typography is clean — Inter for body, JetBrains Mono for code
9. Overall feel: dark, luminous, contemplative, developer-friendly
10. Mobile responsive — stack cards vertically, reduce orb sizes

### Dashboard
```bash
cd packages/dashboard && pnpm dev
```

Open `http://localhost:3838` and verify:
1. Background is deep indigo (`#0a0e1a`), not zinc-900
2. Cards have glassmorphic treatment (blur, translucent bg, glow borders on hover)
3. Buttons have gradient glow treatment
4. Header has backdrop-blur
5. Badges have subtle borders matching their color
6. Confidence bars have soft glow on the fill
7. Modals have blurred overlay and glowing panel
8. Graph visualization uses updated Pensieve palette
9. All pages functional — no broken styles or missing colors
10. Overall feel matches the landing page — same visual family

```bash
pnpm build
```

Verify both packages build with no errors.

Commit and push when complete.
