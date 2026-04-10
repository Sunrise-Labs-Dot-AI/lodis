/**
 * Ground truth test cases using real memory IDs from the user's database.
 * These IDs are from the production ~/.engrams/engrams.db as of April 2026.
 *
 * If the real DB is unavailable (CI), tests that depend on these IDs are skipped.
 */

export interface SearchGroundTruth {
  id: string;
  name: string;
  query: string;
  /** Memory IDs expected in the results, ordered by relevance */
  expectedIds: string[];
  /** Memory IDs that should NOT appear */
  expectedAbsent?: string[];
  filters?: {
    domain?: string;
    entityType?: string;
    minConfidence?: number;
  };
  /** Minimum acceptable precision@5 */
  minPrecisionAt5?: number;
  /** Minimum acceptable MRR */
  minMRR?: number;
}

// --- Known memory IDs from the real database ---

export const MEMORY_IDS = {
  // Product & work
  engrams_origin: "f8095ca4f3aae04bec1de7c2c726bfdc",
  engrams_pro: "b26ddf766fb9e003443939ee534fb0fd",
  james_pm: "4294ca9920c41365730e8296aa4683d6",
  james_technical_pm: "b5fac8491c710b09b7221e9e42b225ca",
  sunrise_labs: "abb48cda5d12fb1282eb932cf1882fcb",
  tech_stack_deferred: "dc23d0744b6684bb4f53ae36c328e8d9",
  three_products: "5e38996cae6182e4556c692e1a7a7709",

  // Career
  job_search: "bc5eb4ddb840da1e810ab929b86cf35f",
  anthropic_interview: "7ed5c23f62254b0b2ff72a816e7dc97b",
  anthropic_target: "b472213204e816ff2caa03142d938383",

  // Coding preferences
  dark_mode: "cfd3f4478f1635c44545e12c30543d17",
  git_workflow: "abfdb5b0a5cd2af0836cc5b3169a7870",
  sitter_stack: "5c78bfd69bfe167aa96e5c06dd919e4a",
  high_fidelity_ui: "a4eb6339f35142118aa90b52a5e6a3eb",

  // Personal
  bay_area: "462face88053814e141a3cca127f6c08",
  marin_schools: "5f8d5f07ff42ebe7fde7a2636e975af1",
  wife_allegra: "e5348a03c20d6d7587895009a33576dc",
  three_kids: "aea340d98be282e13263dcb800d3ebf6",

  // People
  nanny_maddie: "04fb9f878ac51a325e2dab20667d5a20",
  son_weston: "78d7f4bd29fe29cbfa6cd605b18494dc",
  dad_john: "a224c4502eebb63581c0011257479737",

  // Communication preferences
  no_em_dashes: "8b0f62a29e781caa18e396ae78ad5a13",
  direct_responses: "967487b0c39e7565ddd4f7e3adc91f9c",

  // Organizations
  chewie_labs: "e1cf1549154ddbfbc447fdbe8ea3e687",
  mill_px_team: "206bfa1a43133ac193cd9fb5c4473912",

  // Projects
  agent_forge: "c2d8e4df3cad776b735027295f0fab53",
  sitter_project: "943ea3d24295ae2471e8a32c07797dc1",
  rez_sniper: "44cb347a4cef01e1979412a28a0fe771",
} as const;

// --- Search eval cases ---

export const SEARCH_EXACT_CASES: SearchGroundTruth[] = [
  {
    id: "exact-1",
    name: "Engrams product query",
    query: "Engrams product",
    expectedIds: [MEMORY_IDS.engrams_origin, MEMORY_IDS.engrams_pro],
    minPrecisionAt5: 0.4,
    minMRR: 0.5,
  },
  {
    id: "exact-2",
    name: "James Heath PM role",
    query: "James Heath PM",
    expectedIds: [MEMORY_IDS.james_pm, MEMORY_IDS.james_technical_pm],
    minPrecisionAt5: 0.4,
    minMRR: 0.5,
  },
  {
    id: "exact-3",
    name: "Dark mode preference",
    query: "dark mode editor preference",
    expectedIds: [MEMORY_IDS.dark_mode],
    minPrecisionAt5: 0.2,
    minMRR: 0.3,
  },
];

export const SEARCH_SEMANTIC_CASES: SearchGroundTruth[] = [
  {
    id: "semantic-1",
    name: "Memory system for AI (rephrase)",
    query: "memory system for AI agents",
    expectedIds: [MEMORY_IDS.engrams_origin],
    minPrecisionAt5: 0.2,
    minMRR: 0.25,
  },
  {
    id: "semantic-2",
    name: "Coding style preferences",
    query: "coding style preferences",
    expectedIds: [MEMORY_IDS.dark_mode, MEMORY_IDS.git_workflow, MEMORY_IDS.high_fidelity_ui],
    minPrecisionAt5: 0.2,
    minMRR: 0.25,
  },
  {
    id: "semantic-3",
    name: "Who works at Sunrise Labs",
    query: "who works at Sunrise Labs",
    expectedIds: [MEMORY_IDS.sunrise_labs, MEMORY_IDS.james_pm],
    minPrecisionAt5: 0.2,
    minMRR: 0.25,
  },
  {
    id: "semantic-4",
    name: "Career goals",
    query: "career goals and job search",
    expectedIds: [MEMORY_IDS.job_search, MEMORY_IDS.anthropic_target],
    minPrecisionAt5: 0.2,
    minMRR: 0.25,
  },
];

export const SEARCH_DOMAIN_FILTER_CASES: SearchGroundTruth[] = [
  {
    id: "domain-1",
    name: "Engrams domain filter",
    query: "memory layer universal AI agent",
    filters: { domain: "engrams" },
    expectedIds: [MEMORY_IDS.engrams_origin],
    minPrecisionAt5: 0.2,
    minMRR: 0.25,
  },
  {
    id: "domain-2",
    name: "Personal domain filter",
    query: "Bay Area Marin schools",
    filters: { domain: "personal" },
    expectedIds: [MEMORY_IDS.bay_area, MEMORY_IDS.marin_schools],
    minPrecisionAt5: 0.2,
    minMRR: 0.25,
  },
  {
    id: "domain-3",
    name: "Cross-domain (no filter)",
    query: "James Heath",
    expectedIds: [MEMORY_IDS.james_pm, MEMORY_IDS.james_technical_pm, MEMORY_IDS.bay_area],
    minPrecisionAt5: 0.2,
    minMRR: 0.3,
  },
];

export const SEARCH_ENTITY_FILTER_CASES: SearchGroundTruth[] = [
  {
    id: "entity-1",
    name: "Person entity filter",
    query: "family member",
    filters: { entityType: "person" },
    expectedIds: [MEMORY_IDS.nanny_maddie, MEMORY_IDS.son_weston, MEMORY_IDS.dad_john],
    minPrecisionAt5: 0.2,
    minMRR: 0.2,
  },
  {
    id: "entity-2",
    name: "Preference entity filter",
    query: "git workflow branches",
    filters: { entityType: "preference" },
    expectedIds: [MEMORY_IDS.git_workflow],
    minPrecisionAt5: 0.2,
    minMRR: 0.25,
  },
  {
    id: "entity-3",
    name: "Project entity filter",
    query: "Engrams memory AI",
    filters: { entityType: "project" },
    expectedIds: [MEMORY_IDS.engrams_origin],
    minPrecisionAt5: 0.2,
    minMRR: 0.25,
  },
];

export const SEARCH_EDGE_CASES: SearchGroundTruth[] = [
  {
    id: "edge-1",
    name: "Unrelated query",
    query: "quantum physics recipes for sourdough bread",
    expectedIds: [], // Nothing should be highly relevant
    minPrecisionAt5: 0,
    minMRR: 0,
  },
  {
    id: "edge-2",
    name: "Single word query",
    query: "TypeScript",
    expectedIds: [MEMORY_IDS.tech_stack_deferred, MEMORY_IDS.sitter_stack],
    minPrecisionAt5: 0.2,
    minMRR: 0.25,
  },
  {
    id: "edge-3",
    name: "High confidence filter",
    query: "James",
    filters: { minConfidence: 0.95 },
    expectedIds: [MEMORY_IDS.james_pm, MEMORY_IDS.wife_allegra, MEMORY_IDS.bay_area],
    minPrecisionAt5: 0.2,
    minMRR: 0.25,
  },
];

// --- Dedup eval cases ---

export interface DedupGroundTruth {
  id: string;
  name: string;
  /** Content of the "new" memory being written */
  newContent: string;
  newDomain: string;
  /** ID of the existing memory it should (or should not) match */
  existingId: string;
  /** Whether dedup SHOULD flag this as a duplicate */
  shouldMatch: boolean;
}

export const DEDUP_TRUE_POSITIVE_CASES: DedupGroundTruth[] = [
  {
    id: "dedup-tp-1",
    name: "Exact rephrasing of Sunrise Labs",
    newContent: "James Heath runs Sunrise Labs as a side project software studio",
    newDomain: "work",
    existingId: MEMORY_IDS.sunrise_labs,
    shouldMatch: true,
  },
  {
    id: "dedup-tp-2",
    name: "Paraphrase of dark mode preference",
    newContent: "Prefers dark mode in editors and IDEs",
    newDomain: "coding",
    existingId: MEMORY_IDS.dark_mode,
    shouldMatch: true,
  },
  {
    id: "dedup-tp-3",
    name: "Rephrased Engrams project description",
    newContent: "Engrams came from the Anthropic take-home demo's universal memory concept. It fills a gap in transparent, user-controlled AI memory with a consumer UI.",
    newDomain: "engrams",
    existingId: MEMORY_IDS.engrams_origin,
    shouldMatch: true,
  },
];

export const DEDUP_TRUE_NEGATIVE_CASES: DedupGroundTruth[] = [
  {
    id: "dedup-tn-1",
    name: "Same domain, different topic",
    newContent: "Engrams uses a Reciprocal Rank Fusion algorithm for search",
    newDomain: "engrams",
    existingId: MEMORY_IDS.engrams_origin,
    shouldMatch: false,
  },
  {
    id: "dedup-tn-2",
    name: "Similar structure, different entity",
    newContent: "Prefers light mode on mobile devices",
    newDomain: "coding",
    existingId: MEMORY_IDS.dark_mode,
    shouldMatch: false,
  },
  {
    id: "dedup-tn-3",
    name: "Different fact about same person",
    newContent: "James Heath plays golf on weekends",
    newDomain: "personal",
    existingId: MEMORY_IDS.james_pm,
    shouldMatch: false,
  },
];

export const DEDUP_EDGE_CASES: DedupGroundTruth[] = [
  {
    id: "dedup-edge-1",
    name: "Very short content",
    newContent: "Prefers dark mode",
    newDomain: "coding",
    existingId: MEMORY_IDS.dark_mode,
    shouldMatch: true,
  },
  {
    id: "dedup-edge-2",
    name: "Same person, unrelated topic",
    newContent: "James Heath has a dentist appointment next Tuesday at 3pm",
    newDomain: "personal",
    existingId: MEMORY_IDS.sunrise_labs,
    shouldMatch: false,
  },
];

// --- Entity extraction eval cases ---

export interface EntityExtractionCase {
  id: string;
  name: string;
  content: string;
  detail: string | null;
  expectedType: string;
  expectedName: string | null;
  expectedStructuredKeys: string[];
}

export const ENTITY_EXTRACTION_CASES: EntityExtractionCase[] = [
  {
    id: "entity-extract-1",
    name: "Person with role and org",
    content: "Sarah Chen is the CTO at TechCorp",
    detail: "Met her at a conference in March 2026",
    expectedType: "person",
    expectedName: "Sarah Chen",
    expectedStructuredKeys: ["name", "role"],
  },
  {
    id: "entity-extract-2",
    name: "Coding preference",
    content: "Always use 2-space indentation in Python files",
    detail: null,
    expectedType: "preference",
    expectedName: null,
    expectedStructuredKeys: ["category"],
  },
  {
    id: "entity-extract-3",
    name: "Project with tech stack",
    content: "The Engrams project uses SQLite for storage and TypeScript for the codebase",
    detail: "Open-source MCP server for AI memory",
    expectedType: "project",
    expectedName: "Engrams",
    expectedStructuredKeys: ["name"],
  },
  {
    id: "entity-extract-4",
    name: "Ambiguous input (event or fact)",
    content: "Met with the team on Tuesday about the new API design",
    detail: null,
    expectedType: "event", // could also be "fact", both acceptable
    expectedName: null,
    expectedStructuredKeys: [],
  },
];
