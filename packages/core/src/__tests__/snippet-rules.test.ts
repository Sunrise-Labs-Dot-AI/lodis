import { describe, it, expect } from "vitest";
import { evaluateAutoPin } from "../snippet-rules.js";

describe("evaluateAutoPin", () => {
  it("returns null for a plain advanced snippet with no meta", () => {
    expect(
      evaluateAutoPin({ snippet_type: "advanced", life_domain: "work" }),
    ).toBeNull();
  });

  it("returns active+180d for a shipped snippet with a linked goal", () => {
    const r = evaluateAutoPin({
      snippet_type: "shipped",
      life_domain: "work",
      linked_goal_id: "T4",
    });
    expect(r).toEqual({ permanence: "active", ttl: "180d", reason: "goal-linked ship" });
  });

  it("returns null for shipped snippet without a linked goal", () => {
    expect(
      evaluateAutoPin({ snippet_type: "shipped", life_domain: "work" }),
    ).toBeNull();
    expect(
      evaluateAutoPin({ snippet_type: "shipped", life_domain: "work", linked_goal_id: null }),
    ).toBeNull();
  });

  it("returns canonical for meta.milestone === true", () => {
    const r = evaluateAutoPin({
      snippet_type: "advanced",
      life_domain: "work",
      meta: { milestone: true },
    });
    expect(r).toEqual({ permanence: "canonical", ttl: null, reason: "explicit milestone flag" });
  });

  it("does not match meta.milestone when value is truthy but not strictly true", () => {
    expect(
      evaluateAutoPin({ snippet_type: "advanced", life_domain: "work", meta: { milestone: 1 } }),
    ).toBeNull();
    expect(
      evaluateAutoPin({ snippet_type: "advanced", life_domain: "work", meta: { milestone: "true" } }),
    ).toBeNull();
  });

  it("goal-linked ship takes precedence over meta.milestone when both apply", () => {
    const r = evaluateAutoPin({
      snippet_type: "shipped",
      life_domain: "work",
      linked_goal_id: "T4",
      meta: { milestone: true },
    });
    expect(r?.permanence).toBe("active");
    expect(r?.reason).toBe("goal-linked ship");
  });

  it("handles null/undefined meta without throwing", () => {
    expect(evaluateAutoPin({ snippet_type: "started", life_domain: "work", meta: null })).toBeNull();
    expect(evaluateAutoPin({ snippet_type: "started", life_domain: "work" })).toBeNull();
  });
});
