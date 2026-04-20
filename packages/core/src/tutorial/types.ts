// Closed union for demo-scope type safety. Widening this is a deliberate
// schema change — update the type, CHAPTERS, dashboardAnchor map, and any
// route sync together.
export type ChapterId =
  | "overview"
  | "architecture"
  | "write"
  | "search"
  | "trust"
  | "graph"
  | "permanence"
  | "entities"
  | "permissions"
  | "onboarding";

export type Section = {
  heading: string;
  body: string;
  codeExample?: string;
};

export type ToolReference = {
  name: string;
  blurb: string;
  example?: string;
};

// Each entry is an ILLUSTRATIVE suggestion the narrating agent may OFFER
// to the user — never an auto-run directive. chapterToMarkdown renders
// these inside a ```lodis-example fenced block with a "do not auto-run"
// header so MCP clients do not interpret the block as runnable.
export type TryItNext = {
  toolName: string;
  naturalLanguage: string;
  exampleInvocation?: string;
};

export type Chapter = {
  id: ChapterId;
  title: string;
  oneLiner: string;
  sections: Section[];
  tools: ToolReference[];
  tryItNext: TryItNext[];
  dashboardAnchor?: string;
};

export type ChapterFormat = "narrative" | "reference";
