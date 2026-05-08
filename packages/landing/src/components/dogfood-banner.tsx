export function DogfoodBanner() {
  return (
    <div className="w-full bg-[rgba(125,211,252,0.08)] border-b border-border text-center py-2 px-4">
      <p className="text-xs text-text-muted">
        <span className="font-semibold text-glow-soft">Internal prototype</span>
        {" — "}this is a dogfood build. Expect rough edges.
      </p>
    </div>
  );
}
