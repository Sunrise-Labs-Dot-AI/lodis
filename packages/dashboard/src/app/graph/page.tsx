import { getEntityGraphData, getGraphData } from "@/lib/db";
import { KnowledgeGraph } from "@/components/knowledge-graph";

export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const entityData = getEntityGraphData();
  const { nodes: rawNodes, edges: rawEdges } = getGraphData();

  const hasEntities = entityData.entities.length > 0;
  const totalMemories = rawNodes.length + entityData.uncategorized.length;
  const totalConnections = rawEdges.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Knowledge Graph</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {hasEntities
            ? `${entityData.entities.length} entities · ${entityData.edges.length} relationships`
            : `${rawNodes.length} memories · ${rawEdges.length} connections`}
        </p>
      </div>
      <KnowledgeGraph
        entities={entityData.entities}
        entityEdges={entityData.edges}
        uncategorized={entityData.uncategorized}
        rawNodes={rawNodes}
        rawEdges={rawEdges}
      />
    </div>
  );
}
