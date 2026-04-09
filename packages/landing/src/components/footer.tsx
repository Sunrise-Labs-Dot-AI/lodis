export function Footer() {
  return (
    <footer className="py-12 px-6 text-center">
      <div className="section-divider" />
      <p className="text-text-dim text-sm mt-8">
        &copy; 2026{" "}
        <a
          href="https://sunrise-labs.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-muted hover:text-text transition-colors"
        >
          Sunrise Labs
        </a>
        {" · "}
        <a
          href="https://github.com/Sunrise-Labs-Dot-AI/engrams"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-muted hover:text-text transition-colors"
        >
          GitHub
        </a>
        {" · "}
        <a
          href="https://npmjs.com/package/engrams"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-muted hover:text-text transition-colors"
        >
          npm
        </a>
      </p>
    </footer>
  );
}
