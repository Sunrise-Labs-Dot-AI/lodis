export function MemoryThreads() {
  const nodes = [
    { cx: 120, cy: 80, r: 4, color: "var(--color-glow)", delay: 0 },
    { cx: 280, cy: 140, r: 5, color: "var(--color-violet)", delay: 0.5 },
    { cx: 200, cy: 260, r: 3.5, color: "var(--color-glow)", delay: 1 },
    { cx: 380, cy: 60, r: 4, color: "var(--color-emerald)", delay: 1.5 },
    { cx: 440, cy: 220, r: 3, color: "var(--color-violet)", delay: 2 },
    { cx: 60, cy: 200, r: 3.5, color: "var(--color-glow)", delay: 0.8 },
    { cx: 340, cy: 300, r: 4, color: "var(--color-emerald)", delay: 1.2 },
  ];

  const edges = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 1, to: 3 },
    { from: 3, to: 4 },
    { from: 2, to: 4 },
    { from: 5, to: 0 },
    { from: 5, to: 2 },
    { from: 4, to: 6 },
    { from: 2, to: 6 },
  ];

  return (
    <svg
      viewBox="0 0 500 360"
      className="absolute inset-0 w-full h-full opacity-30 pointer-events-none"
      fill="none"
      aria-hidden="true"
    >
      {edges.map((edge, i) => {
        const from = nodes[edge.from];
        const to = nodes[edge.to];
        const mx = (from.cx + to.cx) / 2 + (i % 2 === 0 ? 30 : -30);
        const my = (from.cy + to.cy) / 2 + (i % 2 === 0 ? -20 : 20);
        return (
          <path
            key={i}
            d={`M ${from.cx} ${from.cy} Q ${mx} ${my} ${to.cx} ${to.cy}`}
            stroke="var(--color-glow)"
            strokeWidth="1"
            strokeOpacity="0.3"
            className="thread-path"
            style={{ animationDelay: `${i * 0.3}s` }}
          />
        );
      })}
      {nodes.map((node, i) => (
        <circle
          key={i}
          cx={node.cx}
          cy={node.cy}
          r={node.r}
          fill={node.color}
          className="thread-node"
          style={{ animationDelay: `${node.delay}s` }}
        />
      ))}
    </svg>
  );
}
