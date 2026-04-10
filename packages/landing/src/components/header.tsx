export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-void/60 border-b border-border">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="/" className="font-mono text-xl font-bold text-glow tracking-tight">
          engrams
        </a>
        <a
          href="https://github.com/Sunrise-Labs-Dot-AI/engrams"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-text-muted hover:text-text transition-colors"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
