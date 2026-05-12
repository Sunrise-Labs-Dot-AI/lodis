"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CodeBlock } from "@/components/code-block";

type ClientId = "codex" | "claude-code" | "desktop" | "editor" | "claude-ai" | "unsure";
type StorageId = "local" | "cloud" | "self-hosted" | "unsure";
type StartId = "new" | "import" | "migrate" | "unsure";

const clients: Array<{
  id: ClientId;
  label: string;
  description: string;
}> = [
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Terminal-based Claude development work.",
  },
  {
    id: "desktop",
    label: "Claude Desktop",
    description: "A local desktop MCP client.",
  },
  {
    id: "claude-ai",
    label: "Claude.ai",
    description: "Browser-based use with hosted OAuth.",
  },
  {
    id: "codex",
    label: "Codex",
    description: "CLI, IDE extension, or app workflows.",
  },
  {
    id: "editor",
    label: "Cursor, Windsurf, or Cline",
    description: "Editor agents that read MCP JSON config.",
  },
  {
    id: "unsure",
    label: "I'm not sure",
    description: "Show me the safest default and explain the choice.",
  },
];

const storageModes: Array<{
  id: StorageId;
  label: string;
  description: string;
}> = [
  {
    id: "local",
    label: "Local on this machine",
    description: "Best first install. SQLite data stays on your computer.",
  },
  {
    id: "cloud",
    label: "Cloud beta, invite required",
    description: "For cross-device memory after you request access from James.",
  },
  {
    id: "self-hosted",
    label: "Self-hosted HTTP",
    description: "For remote clients that need to reach your own Lodis server.",
  },
  {
    id: "unsure",
    label: "I'm not sure",
    description: "Recommend the lowest-friction option.",
  },
];

const starts: Array<{
  id: StartId;
  label: string;
  description: string;
}> = [
  {
    id: "new",
    label: "Start fresh",
    description: "Let Lodis interview you and seed useful context.",
  },
  {
    id: "import",
    label: "Import existing context",
    description: "Bring in Claude memories, ChatGPT exports, rules, or git config.",
  },
  {
    id: "migrate",
    label: "Move local to cloud",
    description: "Use when you already dogfood Lodis locally.",
  },
  {
    id: "unsure",
    label: "I'm not sure",
    description: "Start with the guided setup prompt.",
  },
];

const jsonStdioConfig = `{
  "mcpServers": {
    "lodis": {
      "command": "npx",
      "args": ["-y", "lodis-mcp"]
    }
  }
}`;

const jsonCloudConfig = `{
  "mcpServers": {
    "lodis": {
      "type": "streamable-http",
      "url": "https://app.lodis.ai/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}`;

const jsonLocalHttpConfig = `{
  "mcpServers": {
    "lodis": {
      "type": "streamable-http",
      "url": "http://localhost:3939/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}`;

const codexLocalConfig = `[mcp_servers.lodis]
command = "npx"
args = ["-y", "lodis-mcp"]`;

const codexCloudConfig = `[mcp_servers.lodis]
url = "https://app.lodis.ai/api/mcp"
bearer_token_env_var = "LODIS_API_TOKEN"`;

const codexLocalHttpConfig = `[mcp_servers.lodis]
url = "http://localhost:3939/mcp"
bearer_token_env_var = "LODIS_API_TOKEN"`;

const promptSnippet = `Use Lodis MCP tools for all persistent memory. At the start of
conversations, call memory_search with relevant terms to retrieve
context. When the user states a preference, corrects an assumption,
shares personal context, or provides information useful across future
conversations, save it with memory_write.`;

const claudeCodePrompt = `## Memory — CRITICAL OVERRIDE

**DO NOT use the built-in file-based auto-memory system.** Never create,
read, or write to \`MEMORY.md\` or any files in the
\`~/.claude/projects/.../memory/\` directory. That system is fully
replaced by Lodis.

**USE Lodis MCP tools for ALL persistent memory.** Lodis is the
single source of truth.

### At conversation start
- Call \`memory_search\` with terms relevant to the user's request to
  retrieve prior context

### When to write
- \`memory_write\` — user states a preference, corrects an assumption,
  shares personal context, or says anything useful for future conversations
- \`memory_confirm\` — user validates a recalled fact
- \`memory_correct\` — user corrects a stored memory
- \`memory_flag_mistake\` — a memory turns out to be wrong

### When to search
- \`memory_search\` — before answering questions where prior context
  would help
- \`memory_context\` — token-budget-aware retrieval for building responses
- \`memory_briefing\` — entity summaries (people, projects, etc.)

### Rules
- Never duplicate memories to both Lodis and the built-in file system
- Treat Lodis memories as the persistent record — they survive across
  all MCP-connected tools (Claude Code, Cursor, Windsurf, Claude Desktop)
- When the user says "remember this," save immediately via \`memory_write\``;

function getInstructionTarget(client: ClientId) {
  switch (client) {
    case "unsure":
      return "the instructions file for whichever MCP client you choose first";
    case "codex":
      return "~/.codex/AGENTS.md or project AGENTS.md";
    case "claude-code":
      return "~/.claude/CLAUDE.md or project CLAUDE.md";
    case "desktop":
      return "Claude Desktop system prompt";
    case "editor":
      return "Cursor rules, Windsurf system prompt, or Cline custom instructions";
    case "claude-ai":
      return "Claude.ai custom instructions or project instructions";
  }
}

function getInstallPlan(client: ClientId, storage: StorageId) {
  if (client === "unsure" || storage === "unsure") {
    return {
      title: "Start with the safest local setup",
      intro:
        "If you are not sure yet, start local. It avoids cloud access, tokens, and networking. Once Lodis works in one client, you can add more tools later.",
      steps: [
        "Pick the AI tool you already use most often.",
        "If it is Codex, use the Codex command. If it is Cursor, Windsurf, Cline, or Claude Desktop, use the JSON config.",
        "Skip cloud and self-hosted HTTP until local memory works.",
      ],
      codeLabel: "Codex fast path",
      code: "codex mcp add lodis -- npx -y lodis-mcp",
      fallbackLabel: "Most other MCP clients",
      fallbackCode: jsonStdioConfig,
    };
  }

  if (client === "claude-ai") {
    return {
      title: "Connect Lodis from Claude.ai",
      intro:
        "Claude.ai is the hosted path. Use OAuth instead of editing local config files.",
      steps: [
        "Sign up or sign in at app.lodis.ai.",
        "In Claude.ai, open Settings -> Integrations and add Lodis as an MCP server.",
        "Authorize the connection through app.lodis.ai.",
      ],
      codeLabel: null,
      code: null,
    };
  }

  if (storage === "cloud") {
    return {
      title: client === "codex" ? "Add hosted Lodis to Codex" : "Add hosted Lodis to your MCP client",
      intro:
        "Cloud mode is invite-only. Request access from James first, then create an API token. Codex reads the token from your environment; most other clients paste it into JSON.",
      steps: [
        "Email james@sunriselabs.ai to request beta access, then create an account at app.lodis.ai.",
        "Generate an API token in Settings -> API Tokens.",
        client === "codex"
          ? "Set LODIS_API_TOKEN in your shell, then add this TOML to Codex."
          : "Paste this JSON into your MCP client config.",
      ],
      codeLabel: client === "codex" ? "~/.codex/config.toml" : "MCP client JSON",
      code: client === "codex" ? codexCloudConfig : jsonCloudConfig,
    };
  }

  if (storage === "self-hosted") {
    return {
      title: client === "codex" ? "Point Codex at your local HTTP server" : "Point your client at your local HTTP server",
      intro:
        "Use this when the client cannot launch Lodis as a local process but can reach your machine over HTTP.",
      steps: [
        "Start Lodis HTTP mode with lodis --serve.",
        "Create an API token in the Lodis dashboard at localhost:3838.",
        client === "codex"
          ? "Set LODIS_API_TOKEN in your shell, then add this TOML to Codex."
          : "Paste this HTTP config into your MCP client.",
      ],
      codeLabel: client === "codex" ? "~/.codex/config.toml" : "MCP client JSON",
      code: client === "codex" ? codexLocalHttpConfig : jsonLocalHttpConfig,
    };
  }

  if (client === "codex") {
    return {
      title: "Add local Lodis to Codex",
      intro:
        "This is the best first path for Codex: one command writes the shared CLI and IDE MCP config.",
      steps: [
        "Run the Codex MCP command below.",
        "Open a fresh Codex session and run /mcp, or run codex mcp list.",
        "Add the Lodis memory policy to AGENTS.md so Codex uses it consistently.",
      ],
      codeLabel: "Fast path",
      code: "codex mcp add lodis -- npx -y lodis-mcp",
      fallbackLabel: "~/.codex/config.toml",
      fallbackCode: codexLocalConfig,
    };
  }

  return {
    title: "Add local Lodis to your MCP client",
    intro:
      "This launches Lodis through npx and stores memory locally on this machine.",
    steps: [
      "Paste the JSON into your client config.",
      "Restart the client if it does not pick up MCP config automatically.",
      "Add the Lodis memory policy to your client instructions.",
    ],
    codeLabel: "MCP client JSON",
    code: jsonStdioConfig,
  };
}

function getStartPlan(start: StartId) {
  switch (start) {
    case "unsure":
      return {
        title: "Use the guided setup prompt",
        prompt: "Help me set up Lodis",
        detail:
          "This is the safest default. Your assistant should ask a few questions before writing memories, then show you what it saved in the dashboard.",
      };
    case "import":
      return {
        title: "Seed from what you already have",
        prompt: "Import my existing memories and rules into Lodis",
        detail:
          "Good sources include Claude memories, ChatGPT memory exports, .cursorrules, Windsurf rules, git config, and plaintext notes you explicitly choose.",
      };
    case "migrate":
      return {
        title: "Move existing local Lodis data",
        prompt: "Migrate my local Lodis memories to cloud",
        detail:
          "Use this after cloud access is active. Review the migrated memories in the dashboard before relying on them across tools.",
      };
    case "new":
      return {
        title: "Let Lodis interview you",
        prompt: "Help me set up Lodis",
        detail:
          "Your assistant should call memory_onboard, ask targeted questions, and seed useful people, projects, preferences, and working agreements.",
      };
  }
}

function getInstructionPrompt(client: ClientId) {
  return client === "claude-code" ? claudeCodePrompt : promptSnippet;
}

function getLimits(selectedClients: ClientId[], storage: StorageId, starts: StartId[]) {
  const limits = [
    "Lodis only helps tools that are connected through MCP and instructed to use it.",
    "Lodis will not automatically crawl private apps or files. You choose what to import or index.",
  ];

  if (storage === "cloud") {
    limits.push("Cloud access is invite-only during beta.");
  }

  if (storage === "unsure") {
    limits.push("If you are not sure where memory should live, do not start with cloud or self-hosted HTTP. Use local setup first.");
  }

  if (selectedClients.includes("claude-ai")) {
    limits.push("Claude.ai uses hosted OAuth; local stdio config does not apply there.");
    limits.push("The local and self-hosted choices are for local MCP clients, not the browser-based Claude.ai connector.");
  }

  if (selectedClients.includes("codex")) {
    limits.push("Codex uses TOML in ~/.codex/config.toml, not the JSON used by many MCP clients.");
  }

  if (selectedClients.includes("unsure")) {
    limits.push("If you are not sure which client you use, start with the tool already open in front of you and add others later.");
  }

  if (starts.includes("import")) {
    limits.push("Imports are only as good as the source material; review the dashboard before trusting old context.");
  }

  if (starts.includes("unsure")) {
    limits.push("When in doubt, let Lodis ask questions before importing old memory.");
  }

  return limits;
}

function toggleValue<T extends string>(values: T[], value: T) {
  if (values.includes(value)) {
    return values.length === 1 ? values : values.filter((v) => v !== value);
  }

  return [...values, value];
}

function labelsFor<T extends string>(
  values: T[],
  options: Array<{ id: T; label: string }>
) {
  return values.map((value) => options.find((option) => option.id === value)?.label ?? value);
}

function AnswerSummary({
  selectedClientLabels,
  selectedStorageLabel,
  selectedStartLabels,
  hasStorage,
}: {
  selectedClientLabels: string[];
  selectedStorageLabel: string;
  selectedStartLabels: string[];
  hasStorage: boolean;
}) {
  const items = [
    {
      label: "Tools",
      value: selectedClientLabels.length > 0 ? selectedClientLabels.join(", ") : "Not selected",
      complete: selectedClientLabels.length > 0,
    },
    {
      label: "Memory",
      value: hasStorage ? selectedStorageLabel : "Not selected",
      complete: hasStorage,
    },
    {
      label: "Start",
      value: selectedStartLabels.length > 0 ? selectedStartLabels.join(", ") : "Not selected",
      complete: selectedStartLabels.length > 0,
    },
  ];

  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.label}
          className={clsx(
            "rounded-md border px-3 py-2",
            item.complete
              ? "border-border-hover bg-glow/10"
              : "border-border bg-white/[0.02]"
          )}
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-dim">
            {item.label}
          </p>
          <p
            className={clsx(
              "mt-1 text-sm leading-snug",
              item.complete ? "text-text" : "text-text-dim"
            )}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: Array<{ id: T; label: string; description: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-3">
        {label}
      </p>
      <div className="grid gap-3">
        {options.map((option) => {
          const selected = value === option.id;

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.id)}
              className={clsx(
                "text-left rounded-lg border p-4 transition-all duration-200",
                selected
                  ? "border-border-hover bg-[rgba(125,211,252,0.1)]"
                  : "border-border bg-white/[0.02] hover:border-border-hover"
              )}
            >
              <span className="block text-sm font-semibold text-text">
                {option.label}
              </span>
              <span className="mt-1 block text-sm text-text-muted">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MultiChoiceGroup<T extends string>({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: T[];
  options: Array<{ id: T; label: string; description: string }>;
  onChange: (values: T[]) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-3">
        {label}
      </p>
      <div className="grid gap-3">
        {options.map((option) => {
          const selected = values.includes(option.id);

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(toggleValue(values, option.id))}
              className={clsx(
                "text-left rounded-lg border p-4 transition-all duration-200",
                selected
                  ? "border-border-hover bg-[rgba(125,211,252,0.1)]"
                  : "border-border bg-white/[0.02] hover:border-border-hover"
              )}
            >
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-semibold text-text">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-sm text-text-muted">
                    {option.description}
                  </span>
                </span>
                <span
                  className={clsx(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs",
                    selected
                      ? "border-border-hover bg-glow/20 text-glow"
                      : "border-border text-transparent"
                  )}
                >
                  ✓
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SetupPlanner() {
  const [selectedClients, setSelectedClients] = useState<ClientId[]>([]);
  const [storage, setStorage] = useState<StorageId | null>(null);
  const [selectedStarts, setSelectedStarts] = useState<StartId[]>([]);
  const [step, setStep] = useState(0);
  const questionRef = useRef<HTMLDivElement>(null);
  const previousStepRef = useRef(step);
  const effectiveStorage = storage ?? "unsure";

  const installPlans = useMemo(
    () => selectedClients.map((client) => ({ client, plan: getInstallPlan(client, effectiveStorage) })),
    [selectedClients, effectiveStorage]
  );
  const startPlans = useMemo(
    () => selectedStarts.map((start) => getStartPlan(start)),
    [selectedStarts]
  );
  const limits = useMemo(
    () => getLimits(selectedClients, effectiveStorage, selectedStarts),
    [selectedClients, effectiveStorage, selectedStarts]
  );
  const selectedClientLabels = useMemo(
    () => labelsFor(selectedClients, clients),
    [selectedClients]
  );
  const selectedStartLabels = useMemo(
    () => labelsFor(selectedStarts, starts),
    [selectedStarts]
  );
  const selectedStorageLabel = storageModes.find((mode) => mode.id === effectiveStorage)?.label ?? effectiveStorage;
  const isResultStep = step === 3;
  const needsGuidance =
    selectedClients.includes("unsure") ||
    selectedStarts.includes("unsure") ||
    effectiveStorage === "unsure";
  const canContinue =
    (step === 0 && selectedClients.length > 0) ||
    (step === 1 && storage !== null) ||
    (step === 2 && selectedStarts.length > 0);
  const stepLabels = ["Tools", "Memory", "Starting point"];

  const goNext = () => {
    if (!canContinue) return;
    setStep((current) => Math.min(current + 1, 3));
  };
  const goBack = () => setStep((current) => Math.max(current - 1, 0));

  useEffect(() => {
    if (previousStepRef.current === step) return;

    previousStepRef.current = step;
    if (isResultStep) return;

    questionRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [isResultStep, step]);

  return (
    <section id="setup-planner" className="mb-20 scroll-mt-24">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-3">
          Setup planner
        </p>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          Build the path that matches your agent.
        </h2>
        <p className="text-text-muted leading-relaxed">
          Answer three questions and Lodis will give you the install command,
          instruction location, first prompt, and the sharp edges to know up front.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-black/20 p-5 sm:p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-widest text-text-dim">
            <span aria-live="polite" aria-atomic="true">
              {isResultStep ? "Your setup path" : `Question ${step + 1} of 3`}
            </span>
            <a href="/setup/all" className="text-text-muted hover:text-glow transition-colors">
              Skip to everything
            </a>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden="true">
            {stepLabels.map((label, index) => (
              <div
                key={label}
                className={clsx(
                  "h-1.5 rounded-full",
                  step >= index ? "bg-glow/70" : "bg-white/10"
                )}
              />
            ))}
          </div>
          {(step > 0 || isResultStep) && (
            <AnswerSummary
              selectedClientLabels={selectedClientLabels}
              selectedStorageLabel={selectedStorageLabel}
              selectedStartLabels={selectedStartLabels}
              hasStorage={storage !== null}
            />
          )}
        </div>

        {!isResultStep ? (
          <div ref={questionRef}>
            {step === 0 && (
              <MultiChoiceGroup
                label="What are you connecting?"
                values={selectedClients}
                options={clients}
                onChange={setSelectedClients}
              />
            )}

            {step === 1 && (
              <ChoiceGroup
                label="Where should memory live?"
                value={storage}
                options={storageModes}
                onChange={setStorage}
              />
            )}

            {step === 2 && (
              <MultiChoiceGroup
                label="How are you starting?"
                values={selectedStarts}
                options={starts}
                onChange={setSelectedStarts}
              />
            )}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={goBack}
                disabled={step === 0}
                className={clsx(
                  "btn-ghost justify-center text-center",
                  step === 0 && "pointer-events-none opacity-40"
                )}
              >
                Back
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!canContinue}
                className={clsx(
                  "btn-glow justify-center text-center",
                  !canContinue && "pointer-events-none opacity-40"
                )}
              >
                {step === 2 ? "Show my setup path" : "Continue"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-white/[0.02] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-2">
                    {needsGuidance ? "Recommended default" : "Recommended path"}
                  </p>
                  <h3 className="font-semibold mb-2">
                    {needsGuidance
                      ? "Start local, then add complexity later"
                      : `${selectedClientLabels.join(", ")} with ${selectedStorageLabel.toLowerCase()}`}
                  </h3>
                  <p className="text-sm text-text-muted">
                    {needsGuidance
                      ? "This path avoids invite-only cloud setup and self-hosted networking until Lodis is working in one client."
                      : `Starting point: ${selectedStartLabels.join(", ")}.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="btn-ghost shrink-0 justify-center text-center text-sm"
                >
                  Edit answers
                </button>
              </div>
            </div>

            {installPlans.map(({ client, plan: installPlan }) => (
              <div key={client} className="rounded-lg border border-border bg-white/[0.02] p-5">
                <h3 className="font-semibold mb-2">{installPlan.title}</h3>
                <p className="text-sm text-text-muted mb-4">{installPlan.intro}</p>
                <ol className="space-y-2 text-sm text-text-muted mb-4">
                  {installPlan.steps.map((planStep, index) => (
                    <li key={`${installPlan.title}-${index}`} className="flex gap-3">
                      <span className="font-mono text-glow shrink-0">
                        {index + 1}.
                      </span>
                      <span>{planStep}</span>
                    </li>
                  ))}
                </ol>
                {installPlan.code && (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-2">
                      {installPlan.codeLabel}
                    </p>
                    <CodeBlock className="text-xs">{installPlan.code}</CodeBlock>
                  </>
                )}
                {"fallbackCode" in installPlan && installPlan.fallbackCode && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-widest text-text-dim mb-2">
                      {installPlan.fallbackLabel}
                    </p>
                    <CodeBlock className="text-xs">{installPlan.fallbackCode}</CodeBlock>
                  </div>
                )}
              </div>
            ))}

            <div className="rounded-lg border border-border bg-white/[0.02] p-5">
              <h3 className="font-semibold mb-2">Teach your agents to use Lodis</h3>
              <div className="space-y-5">
                {selectedClients.map((client) => (
                  <div key={client} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                    <p className="text-sm text-text-muted mb-3">
                      Put this in{" "}
                      <code className="font-mono text-glow">{getInstructionTarget(client)}</code>.
                    </p>
                    {client === "claude-code" && (
                      <p className="mb-3 rounded-md border border-border-hover bg-glow/10 px-3 py-2 text-sm text-text">
                        Claude Code requires a stronger override because it can also read
                        its own file-based memory system.
                      </p>
                    )}
                    <CodeBlock className="text-xs">{getInstructionPrompt(client)}</CodeBlock>
                  </div>
                ))}
              </div>
            </div>

            {startPlans.map((startPlan) => (
              <div key={startPlan.title} className="rounded-lg border border-border bg-white/[0.02] p-5">
                <h3 className="font-semibold mb-2">{startPlan.title}</h3>
                <p className="text-sm text-text-muted mb-3">{startPlan.detail}</p>
                <code className="block text-sm font-mono text-glow bg-glow/10 rounded-md px-3 py-2 break-words">
                  &ldquo;{startPlan.prompt}&rdquo;
                </code>
              </div>
            ))}

            <div className="rounded-lg border border-border bg-white/[0.02] p-5">
              <h3 className="font-semibold mb-3">What Lodis cannot do yet</h3>
              <ul className="space-y-2 text-sm text-text-muted">
                {limits.map((limit) => (
                  <li key={limit} className="flex gap-2">
                    <span className="text-text-dim">-</span>
                    <span>{limit}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-ghost justify-center text-center"
              >
                Back
              </button>
              <a href="/setup/all" className="btn-ghost justify-center text-center">
                View everything
              </a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
