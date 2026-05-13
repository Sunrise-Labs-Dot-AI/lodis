export function Footer() {
  return (
    <footer className="py-12 px-6 text-center">
      <div className="section-divider" />
      <p className="text-text-dim text-sm mt-8">
        &copy; 2026{" "}
        <a
          href="https://sunriselabs.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-muted hover:text-text transition-colors"
        >
          Sunrise Labs
        </a>
        {" · "}
        <a
          href="/setup"
          className="text-text-muted hover:text-text transition-colors"
        >
          Setup Guide
        </a>
        {" · "}
        <a
          href="https://github.com/Sunrise-Labs-Dot-AI/lodis"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-muted hover:text-text transition-colors"
        >
          GitHub
        </a>
        {" · "}
        <a
          href="https://npmjs.com/package/@sunriselabs/lodis"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-muted hover:text-text transition-colors"
        >
          npm
        </a>
        {" · "}
        <a
          href="/terms"
          className="text-text-muted hover:text-text transition-colors"
        >
          Terms
        </a>
        {" · "}
        <a
          href="/privacy"
          className="text-text-muted hover:text-text transition-colors"
        >
          Privacy
        </a>
      </p>
    </footer>
  );
}
