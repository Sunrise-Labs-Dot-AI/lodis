"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as d3 from "d3";
import clsx from "clsx";
import type { GraphNode, GraphEdge, EntityNode, EntityEdge } from "@/lib/db";

const ENTITY_COLORS: Record<string, string> = {
  person: "#7dd3fc",
  organization: "#a78bfa",
  place: "#34d399",
  project: "#fbbf24",
  preference: "#f472b6",
  event: "#fb923c",
  goal: "#f87171",
  fact: "#94a3b8",
};
const DEFAULT_NODE_COLOR = "#64748b";

const EDGE_COLORS: Record<string, string> = {
  contradicts: "#ef4444",
  supports: "#34d399",
  works_at: "#7dd3fc",
  part_of: "#7dd3fc",
  involves: "#7dd3fc",
  about: "#a78bfa",
  located_at: "#a78bfa",
  related: "#64748b",
  influences: "#fbbf24",
  "learned-together": "#64748b",
};

// --- Entity-centric graph types ---

interface EntitySimNode extends d3.SimulationNodeDatum {
  id: string;
  entityName: string;
  entityType: string;
  memoryCount: number;
  avgConfidence: number;
  memoryIds: string[];
  isUncategorized?: boolean;
  // For uncategorized individual nodes
  content?: string;
  domain?: string;
  confidence?: number;
}

interface EntitySimEdge extends d3.SimulationLinkDatum<EntitySimNode> {
  connectionCount: number;
  relationships: string[];
}

// --- Raw fallback types ---

interface RawSimNode extends d3.SimulationNodeDatum {
  id: string;
  content: string;
  entity_type: string | null;
  entity_name: string | null;
  domain: string;
  confidence: number;
  connectionCount: number;
}

interface RawSimEdge extends d3.SimulationLinkDatum<RawSimNode> {
  relationship: string;
}

interface KnowledgeGraphProps {
  entities: EntityNode[];
  entityEdges: EntityEdge[];
  uncategorized: GraphNode[];
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
}

function entityNodeRadius(memoryCount: number): number {
  return Math.min(Math.max(12, 8 + memoryCount * 4), 32);
}

function rawNodeRadius(connectionCount: number): number {
  return Math.min(Math.max(8, 8 + connectionCount * 2), 24);
}

export function KnowledgeGraph({ entities, entityEdges, uncategorized, rawNodes, rawEdges }: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<EntitySimNode, EntitySimEdge> | d3.Simulation<RawSimNode, RawSimEdge> | null>(null);
  const router = useRouter();

  const [showLabels, setShowLabels] = useState(true);
  const [entityFilters, setEntityFilters] = useState<Record<string, boolean>>({});
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: Record<string, unknown> } | null>(null);

  const hasEntities = entities.length > 0;

  // Entity types present
  const entityTypesPresent = hasEntities
    ? Array.from(new Set(entities.map((e) => e.entityType)))
    : Array.from(new Set(rawNodes.map((n) => n.entity_type ?? "untyped")));

  // Initialize filters
  useEffect(() => {
    const ef: Record<string, boolean> = {};
    for (const t of entityTypesPresent) ef[t] = true;
    setEntityFilters(ef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetView = useCallback(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(500).call(
      d3.zoom<SVGSVGElement, unknown>().transform as never,
      d3.zoomIdentity,
    );
    if (simulationRef.current) {
      simulationRef.current.alpha(0.3).restart();
    }
  }, []);

  // ===== Entity-centric rendering =====
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (!hasEntities && rawNodes.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("class", "graph-group").style("will-change", "transform");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        setTooltip(null);
      });
    svg.call(zoom);

    if (hasEntities) {
      renderEntityGraph(g, svg, width, height, zoom);
    } else {
      renderRawGraph(g, svg, width, height, zoom);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        svg.attr("width", w).attr("height", h);
      }
    });
    resizeObserver.observe(container);

    return () => {
      if (simulationRef.current) simulationRef.current.stop();
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEntities, entities, entityEdges, uncategorized, rawNodes, rawEdges, entityFilters, showLabels]);

  function renderEntityGraph(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    width: number,
    height: number,
    zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
  ) {
    const activeTypes = new Set(
      Object.entries(entityFilters).filter(([, v]) => v).map(([k]) => k),
    );
    const showAll = activeTypes.size === 0;

    const filteredEntities = entities.filter(
      (e) => showAll || activeTypes.has(e.entityType),
    );

    const simNodes: EntitySimNode[] = filteredEntities.map((e) => ({
      id: `entity:${e.entityName}`,
      entityName: e.entityName,
      entityType: e.entityType,
      memoryCount: e.memoryCount,
      avgConfidence: e.avgConfidence,
      memoryIds: e.memoryIds,
    }));

    // Add uncategorized as a single cluster node if present
    if (uncategorized.length > 0) {
      simNodes.push({
        id: "entity:__uncategorized__",
        entityName: "Uncategorized",
        entityType: "untyped",
        memoryCount: uncategorized.length,
        avgConfidence: uncategorized.reduce((s, n) => s + n.confidence, 0) / uncategorized.length,
        memoryIds: uncategorized.map((n) => n.id),
        isUncategorized: true,
      });
    }

    const entityNameSet = new Set(filteredEntities.map((e) => e.entityName));
    const simEdges: EntitySimEdge[] = entityEdges
      .filter((e) => entityNameSet.has(e.sourceEntity) && entityNameSet.has(e.targetEntity))
      .map((e) => ({
        source: `entity:${e.sourceEntity}`,
        target: `entity:${e.targetEntity}`,
        connectionCount: e.connectionCount,
        relationships: e.relationships,
      }));

    // Defs
    const defs = svg.select("defs").empty() ? svg.append("defs") : svg.select("defs");
    defs.append("marker")
      .attr("id", "arrow-default")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 25)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#64748b");

    const simulation = d3
      .forceSimulation<EntitySimNode>(simNodes)
      .force(
        "link",
        d3.forceLink<EntitySimNode, EntitySimEdge>(simEdges).id((d) => d.id).distance(140),
      )
      .force("charge", d3.forceManyBody<EntitySimNode>().strength((d) => -200 - d.memoryCount * 30))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<EntitySimNode>().radius((d) => entityNodeRadius(d.memoryCount) + 8));

    simulationRef.current = simulation as d3.Simulation<EntitySimNode, EntitySimEdge>;

    // Edges
    const link = g.append("g")
      .selectAll<SVGLineElement, EntitySimEdge>("line")
      .data(simEdges)
      .join("line")
      .attr("stroke", (d) => EDGE_COLORS[d.relationships[0]] ?? "#64748b")
      .attr("stroke-width", (d) => Math.min(1 + d.connectionCount, 5))
      .attr("stroke-opacity", 0.5)
      .attr("marker-end", "url(#arrow-default)");

    // Edge labels on hover
    const edgeLabel = g.append("g")
      .selectAll<SVGTextElement, EntitySimEdge>("text")
      .data(simEdges)
      .join("text")
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-text-muted)")
      .attr("font-size", 9)
      .attr("opacity", 0)
      .attr("pointer-events", "none")
      .text((d) => d.relationships.join(", "));

    // Edge hit areas
    g.append("g")
      .selectAll<SVGLineElement, EntitySimEdge>("line")
      .data(simEdges)
      .join("line")
      .attr("stroke", "transparent")
      .attr("stroke-width", 14)
      .on("mouseenter", (_, d) => {
        const idx = simEdges.indexOf(d);
        edgeLabel.filter((_, j) => j === idx).attr("opacity", 1);
        link.filter((_, j) => j === idx).attr("stroke-opacity", 1);
      })
      .on("mouseleave", (_, d) => {
        const idx = simEdges.indexOf(d);
        edgeLabel.filter((_, j) => j === idx).attr("opacity", 0);
        link.filter((_, j) => j === idx).attr("stroke-opacity", 0.5);
      });

    // Nodes
    const node = g.append("g")
      .selectAll<SVGCircleElement, EntitySimNode>("circle")
      .data(simNodes)
      .join("circle")
      .attr("r", (d) => entityNodeRadius(d.memoryCount))
      .attr("fill", (d) => d.isUncategorized ? "#475569" : (ENTITY_COLORS[d.entityType] ?? DEFAULT_NODE_COLOR))
      .attr("fill-opacity", (d) => 0.4 + d.avgConfidence * 0.6)
      .attr("stroke", (d) => d.isUncategorized ? "#475569" : (ENTITY_COLORS[d.entityType] ?? DEFAULT_NODE_COLOR))
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.8)
      .attr("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        const [x, y] = d3.pointer(event, containerRef.current!);
        setTooltip({
          x, y,
          data: {
            name: d.entityName,
            type: d.entityType,
            memoryCount: d.memoryCount,
            avgConfidence: d.avgConfidence,
            isUncategorized: d.isUncategorized,
          },
        });
        d3.select(event.currentTarget).attr("stroke-width", 3.5);
      })
      .on("mouseleave", (event) => {
        setTooltip(null);
        d3.select(event.currentTarget).attr("stroke-width", 2);
      })
      .on("click", (_, d) => {
        if (d.memoryIds.length === 1) {
          router.push(`/memory/${d.memoryIds[0]}`);
        } else if (!d.isUncategorized) {
          router.push(`/?q=${encodeURIComponent(d.entityName)}`);
        }
      });

    // Memory count badge
    g.append("g")
      .selectAll<SVGTextElement, EntitySimNode>("text")
      .data(simNodes.filter((d) => d.memoryCount > 1))
      .join("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", "#fff")
      .attr("font-size", 10)
      .attr("font-weight", 600)
      .attr("pointer-events", "none")
      .text((d) => d.memoryCount);

    // Labels
    const label = g.append("g")
      .selectAll<SVGTextElement, EntitySimNode>("text")
      .data(simNodes)
      .join("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => entityNodeRadius(d.memoryCount) + 14)
      .attr("fill", "var(--color-text-secondary)")
      .attr("font-size", 11)
      .attr("font-weight", 500)
      .attr("pointer-events", "none")
      .attr("visibility", showLabels ? "visible" : "hidden")
      .text((d) => d.entityName);

    // Badge text refs for positioning
    const badgeText = g.selectAll<SVGTextElement, EntitySimNode>("g:nth-child(5) text");

    // Drag
    const drag = d3.drag<SVGCircleElement, EntitySimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });
    node.call(drag);

    const hitAreas = g.selectAll<SVGLineElement, EntitySimEdge>("g:nth-child(3) line");

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as EntitySimNode).x!)
        .attr("y1", (d) => (d.source as EntitySimNode).y!)
        .attr("x2", (d) => (d.target as EntitySimNode).x!)
        .attr("y2", (d) => (d.target as EntitySimNode).y!);
      hitAreas
        .attr("x1", (d) => (d.source as EntitySimNode).x!)
        .attr("y1", (d) => (d.source as EntitySimNode).y!)
        .attr("x2", (d) => (d.target as EntitySimNode).x!)
        .attr("y2", (d) => (d.target as EntitySimNode).y!);
      edgeLabel
        .attr("x", (d) => ((d.source as EntitySimNode).x! + (d.target as EntitySimNode).x!) / 2)
        .attr("y", (d) => ((d.source as EntitySimNode).y! + (d.target as EntitySimNode).y!) / 2);
      node.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);
      badgeText.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
      label.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
    });
  }

  function renderRawGraph(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    width: number,
    height: number,
    zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
  ) {
    const activeTypes = new Set(
      Object.entries(entityFilters).filter(([, v]) => v).map(([k]) => k),
    );
    const showAll = activeTypes.size === 0;

    const filteredNodes: RawSimNode[] = rawNodes
      .filter((n) => showAll || activeTypes.has(n.entity_type ?? "untyped"))
      .slice(0, 200)
      .map((n) => ({ ...n }));

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges: RawSimEdge[] = rawEdges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({ ...e }));

    // Defs for arrows
    const defs = svg.select("defs").empty() ? svg.append("defs") : svg.select("defs");
    defs.append("marker")
      .attr("id", "arrow-raw")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#64748b");

    const simulation = d3
      .forceSimulation<RawSimNode>(filteredNodes)
      .force(
        "link",
        d3.forceLink<RawSimNode, RawSimEdge>(filteredEdges).id((d) => d.id).distance(120),
      )
      .force("charge", d3.forceManyBody<RawSimNode>().strength((d) => -100 - d.connectionCount * 20))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<RawSimNode>().radius((d) => rawNodeRadius(d.connectionCount) + 4));

    simulationRef.current = simulation as d3.Simulation<RawSimNode, RawSimEdge>;

    const link = g.append("g")
      .selectAll<SVGLineElement, RawSimEdge>("line")
      .data(filteredEdges)
      .join("line")
      .attr("stroke", (d) => EDGE_COLORS[d.relationship] ?? "#64748b")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.5)
      .attr("stroke-dasharray", (d) => (d.relationship === "contradicts" ? "4,4" : null))
      .attr("marker-end", "url(#arrow-raw)");

    const node = g.append("g")
      .selectAll<SVGCircleElement, RawSimNode>("circle")
      .data(filteredNodes)
      .join("circle")
      .attr("r", (d) => rawNodeRadius(d.connectionCount))
      .attr("fill", (d) => ENTITY_COLORS[d.entity_type ?? ""] ?? DEFAULT_NODE_COLOR)
      .attr("fill-opacity", (d) => 0.4 + d.confidence * 0.6)
      .attr("stroke", (d) => ENTITY_COLORS[d.entity_type ?? ""] ?? DEFAULT_NODE_COLOR)
      .attr("stroke-width", 1.5)
      .attr("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        const [x, y] = d3.pointer(event, containerRef.current!);
        setTooltip({
          x, y,
          data: {
            name: d.entity_name ?? d.content,
            content: d.content,
            type: d.entity_type,
            domain: d.domain,
            confidence: d.confidence,
            connectionCount: d.connectionCount,
          },
        });
        d3.select(event.currentTarget).attr("stroke-width", 3);
      })
      .on("mouseleave", (event) => {
        setTooltip(null);
        d3.select(event.currentTarget).attr("stroke-width", 1.5);
      })
      .on("click", (_, d) => router.push(`/memory/${d.id}`));

    const drag = d3.drag<SVGCircleElement, RawSimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });
    node.call(drag);

    const label = g.append("g")
      .selectAll<SVGTextElement, RawSimNode>("text")
      .data(filteredNodes)
      .join("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => rawNodeRadius(d.connectionCount) + 12)
      .attr("fill", "var(--color-text-secondary)")
      .attr("font-size", 10)
      .attr("pointer-events", "none")
      .attr("visibility", showLabels ? "visible" : "hidden")
      .text((d) => d.entity_name ?? (d.content.length > 30 ? d.content.slice(0, 30) + "..." : d.content));

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as RawSimNode).x!)
        .attr("y1", (d) => (d.source as RawSimNode).y!)
        .attr("x2", (d) => (d.target as RawSimNode).x!)
        .attr("y2", (d) => (d.target as RawSimNode).y!);
      node.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);
      label.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
    });
  }

  // ===== Empty states =====
  if (rawNodes.length === 0 && entities.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-12rem)]">
        <div className="text-center max-w-md p-8 bg-[var(--color-bg-soft)] rounded-xl">
          <p className="text-lg font-medium mb-2">No memories yet</p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Your knowledge graph will appear here as memories form connections.
            Write more memories or run cleanup to discover relationships.
          </p>
        </div>
      </div>
    );
  }

  if (!hasEntities && rawEdges.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-12rem)]">
        <div className="text-center max-w-md space-y-4">
          <div className="p-8 bg-[var(--color-bg-soft)] rounded-xl">
            <p className="text-lg font-medium mb-2">Memories need classification</p>
            <p className="text-sm text-[var(--color-text-muted)]">
              Run <code className="bg-[var(--color-bg)] px-1.5 py-0.5 rounded text-xs">memory_classify</code> to
              extract entities and build the knowledge graph.
            </p>
          </div>
          <div className="flex justify-center gap-4 text-sm text-[var(--color-text-muted)]">
            <span>{rawNodes.length} memories</span>
            <span>&middot;</span>
            <span>{rawEdges.length} connections</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-[calc(100vh-12rem)] bg-[var(--color-bg)] rounded-xl border border-[var(--color-border-light)] overflow-hidden">
      <svg ref={svgRef} className="w-full h-full" />

      {/* Controls — top right */}
      <div className="absolute top-3 right-3 bg-[var(--color-card)] border border-[var(--color-border-light)] rounded-lg p-3 text-xs space-y-3 max-h-[60vh] overflow-y-auto shadow-lg">
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium text-[var(--color-text)]">Controls</span>
          <button
            onClick={resetView}
            className="px-2 py-0.5 bg-[var(--color-bg-soft)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
          >
            Reset view
          </button>
        </div>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showLabels} onChange={() => setShowLabels(!showLabels)} className="rounded" />
          <span className="text-[var(--color-text-secondary)]">Show labels</span>
        </label>

        {entityTypesPresent.length > 1 && (
          <div>
            <p className="font-medium text-[var(--color-text-muted)] mb-1">Entity Types</p>
            {entityTypesPresent.map((t) => (
              <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={entityFilters[t] ?? true}
                  onChange={() => setEntityFilters((prev) => ({ ...prev, [t]: !(prev[t] ?? true) }))}
                  className="rounded"
                />
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ENTITY_COLORS[t] ?? DEFAULT_NODE_COLOR }} />
                <span className="text-[var(--color-text-secondary)]">{t}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Legend — bottom left */}
      <div className="absolute bottom-3 left-3 bg-[var(--color-card)] border border-[var(--color-border-light)] rounded-lg p-2.5 text-xs space-y-1 shadow-lg">
        {entityTypesPresent.map((t) => (
          <div key={t} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: ENTITY_COLORS[t] ?? DEFAULT_NODE_COLOR }} />
            <span className="text-[var(--color-text-muted)]">{t}</span>
          </div>
        ))}
        {hasEntities && (
          <div className="pt-1 mt-1 border-t border-[var(--color-border-light)] text-[var(--color-text-muted)]">
            Node size = memory count
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3 text-xs shadow-xl max-w-xs z-50"
          style={{ left: Math.min(tooltip.x + 16, (containerRef.current?.clientWidth ?? 800) - 250), top: tooltip.y - 8 }}
        >
          <p className="font-medium text-sm mb-1">{String(tooltip.data.name)}</p>
          {Boolean(tooltip.data.content && tooltip.data.name !== tooltip.data.content) && (
            <p className="text-[var(--color-text-muted)] mb-1 line-clamp-2">{String(tooltip.data.content)}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            {Boolean(tooltip.data.type) && (
              <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg-soft)] text-[var(--color-text-secondary)]">
                {String(tooltip.data.type)}
              </span>
            )}
            {Boolean(tooltip.data.domain) && (
              <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg-soft)] text-[var(--color-text-secondary)]">
                {String(tooltip.data.domain)}
              </span>
            )}
            {tooltip.data.memoryCount != null && (
              <span className="text-[var(--color-text-muted)]">
                {String(tooltip.data.memoryCount)} memories
              </span>
            )}
            {tooltip.data.avgConfidence != null && (
              <span className="text-[var(--color-text-muted)]">
                {Math.round(Number(tooltip.data.avgConfidence) * 100)}% avg confidence
              </span>
            )}
            {Boolean(tooltip.data.confidence != null && tooltip.data.avgConfidence == null) && (
              <span className="text-[var(--color-text-muted)]">
                {Math.round(Number(tooltip.data.confidence) * 100)}% confidence
              </span>
            )}
            {tooltip.data.connectionCount !== undefined && (
              <span className="text-[var(--color-text-muted)]">
                {String(tooltip.data.connectionCount)} connections
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
