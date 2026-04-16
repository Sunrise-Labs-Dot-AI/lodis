"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Key, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  createApiToken,
  revokeApiToken,
  type TokenInfo,
} from "@/app/settings/token-actions";

interface Props {
  userId: string;
  tokens: TokenInfo[];
  isHosted?: boolean;
  baseUrl?: string;
}

export function ApiTokens({ userId, tokens, isHosted, baseUrl }: Props) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState("Claude Desktop");
  const [newTokenExpiry, setNewTokenExpiry] = useState("90");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    const expiresInDays = newTokenExpiry ? parseInt(newTokenExpiry) : undefined;
    const result = await createApiToken(userId, newTokenName, "read,write", expiresInDays);
    if ("token" in result) {
      setCreatedToken(result.token);
      router.refresh();
    }
    setCreating(false);
  }

  async function handleRevoke(tokenId: string) {
    setRevoking(tokenId);
    await revokeApiToken(userId, tokenId);
    setRevoking(null);
    router.refresh();
  }

  function handleCopy() {
    if (createdToken) {
      navigator.clipboard.writeText(createdToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleCloseCreate() {
    setCreateOpen(false);
    setCreatedToken(null);
    setNewTokenName("Claude Desktop");
    setNewTokenExpiry("90");
    setCopied(false);
  }

  function formatDate(iso: string | null) {
    if (!iso) return "Never";
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">API Tokens</h3>
          <p className="text-xs text-[var(--text-dim)] mt-0.5">
            Connect MCP clients like Claude Desktop, Cursor, or Claude Code.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} className="mr-1" />
          New Token
        </Button>
      </div>

      {tokens.length === 0 ? (
        <p className="text-xs text-[var(--text-dim)] py-4 text-center">
          No API tokens yet. Create one to connect your MCP client.
        </p>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => {
            const isExpired = t.expiresAt && new Date(t.expiresAt) < new Date();
            return (
              <div
                key={t.id}
                className="flex items-center justify-between rounded border border-[var(--border)] px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Key size={14} className="text-[var(--text-dim)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{t.name}</div>
                    <div className="text-xs text-[var(--text-dim)] font-mono">
                      {t.tokenPrefix}...
                      {isExpired && (
                        <span className="text-[var(--danger)] ml-1">expired</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-[10px] text-[var(--text-dim)]">
                      Last used: {formatDate(t.lastUsedAt)}
                    </div>
                    <div className="text-[10px] text-[var(--text-dim)]">
                      {t.expiresAt ? `Expires: ${formatDate(t.expiresAt)}` : "No expiration"}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(t.id)}
                    disabled={revoking === t.id}
                  >
                    <Trash2 size={14} className="text-[var(--danger)]" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tokens.length > 0 && (
        <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg)] p-3">
          <h4 className="text-xs font-semibold mb-1.5">Connect a remote MCP client</h4>
          {isHosted ? (
            <>
              <p className="text-[10px] text-[var(--text-dim)] mb-2">
                Configure your MCP client with these environment variables:
              </p>
              <pre className="text-[10px] font-mono bg-black/20 rounded px-2 py-1.5 overflow-x-auto">{`LODIS_MCP_URL=${baseUrl}/api/mcp
LODIS_API_KEY=<your-token>`}</pre>
            </>
          ) : (
            <>
              <p className="text-[10px] text-[var(--text-dim)] mb-2">
                Start the server with <code className="font-mono">lodis --serve</code>, then configure your client:
              </p>
              <pre className="text-[10px] font-mono bg-black/20 rounded px-2 py-1.5 overflow-x-auto">{`LODIS_MCP_URL=http://<host>:3939/mcp
LODIS_API_KEY=<your-token>`}</pre>
            </>
          )}
        </div>
      )}

      {/* Create token modal */}
      <Modal open={createOpen} onClose={handleCloseCreate} title="Create API Token">
        {createdToken ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-muted)]">
              Copy this token now. You won&apos;t be able to see it again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-mono break-all">
                {createdToken}
              </code>
              <Button variant="secondary" size="sm" onClick={handleCopy}>
                <Copy size={14} />
              </Button>
            </div>
            {copied && (
              <p className="text-xs text-[var(--success)]">Copied to clipboard</p>
            )}
            <p className="text-xs text-[var(--text-dim)]">
              Add this to your MCP client config as the Bearer token for the Lodis server URL.
            </p>
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={handleCloseCreate}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Name</label>
              <input
                type="text"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder="Claude Desktop"
                className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
              <p className="text-[10px] text-[var(--text-dim)] mt-0.5">
                A label to identify which client uses this token.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Expires in</label>
              <select
                value={newTokenExpiry}
                onChange={(e) => setNewTokenExpiry(e.target.value)}
                className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              >
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="">No expiration</option>
              </select>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleCloseCreate}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={creating || !newTokenName.trim()}
                onClick={handleCreate}
              >
                {creating ? "Creating..." : "Create Token"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
