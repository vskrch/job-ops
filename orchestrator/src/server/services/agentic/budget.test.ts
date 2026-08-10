import { describe, expect, it } from "vitest";
import { createBudgetTracker, getBudgetLimits } from "./budget";

describe("getBudgetLimits", () => {
  it("returns ADR defaults when no overrides are given", () => {
    const limits = getBudgetLimits();
    expect(limits.maxLlmCalls).toBe(30);
    expect(limits.maxTotalTokens).toBe(100_000);
    expect(limits.maxEstimatedCost).toBe(0.5);
    expect(limits.maxElapsedMs).toBe(300_000);
    expect(limits.maxIterations).toBe(5);
    expect(limits.maxVerificationCalls).toBe(20);
  });

  it("merges overrides into the defaults", () => {
    const limits = getBudgetLimits({ maxIterations: 2, maxEstimatedCost: 0.1 });
    expect(limits.maxIterations).toBe(2);
    expect(limits.maxEstimatedCost).toBe(0.1);
    expect(limits.maxLlmCalls).toBe(30);
  });
});

describe("createBudgetTracker", () => {
  it("starts with zeroed usage", () => {
    const budget = createBudgetTracker();
    expect(budget.getUsage()).toEqual({
      llmCalls: 0,
      totalTokens: 0,
      estimatedCost: 0,
      elapsedMs: expect.any(Number),
    });
    expect(budget.canContinue().ok).toBe(true);
  });

  it("tracks LLM calls, tokens and cost", () => {
    const budget = createBudgetTracker();
    budget.recordLlmCall(100, 0.01);
    budget.recordLlmCall(50, 0.005);
    const usage = budget.getUsage();
    expect(usage.llmCalls).toBe(2);
    expect(usage.totalTokens).toBe(150);
    expect(usage.estimatedCost).toBeCloseTo(0.015);
  });

  it("blocks when max iterations is reached", () => {
    const budget = createBudgetTracker({ maxIterations: 2 });
    budget.incrementIteration();
    expect(budget.canContinue().ok).toBe(true);
    budget.incrementIteration();
    expect(budget.canContinue()).toEqual({
      ok: false,
      reason: "max_iterations",
    });
  });

  it("blocks when max LLM calls is reached", () => {
    const budget = createBudgetTracker({ maxLlmCalls: 3 });
    budget.recordLlmCall(1);
    budget.recordLlmCall(1);
    budget.recordLlmCall(1);
    expect(budget.canContinue()).toEqual({
      ok: false,
      reason: "max_llm_calls",
    });
  });

  it("blocks when the cost ceiling is reached", () => {
    const budget = createBudgetTracker({ maxEstimatedCost: 0.1 });
    budget.recordLlmCall(1, 0.1);
    expect(budget.canContinue()).toEqual({ ok: false, reason: "max_cost" });
  });

  it("blocks when the token ceiling is reached", () => {
    const budget = createBudgetTracker({ maxTotalTokens: 100 });
    budget.recordLlmCall(100);
    expect(budget.canContinue()).toEqual({ ok: false, reason: "max_tokens" });
  });

  it("blocks when the verification call ceiling is reached", () => {
    const budget = createBudgetTracker({ maxVerificationCalls: 2 });
    budget.recordVerificationCall();
    budget.recordVerificationCall();
    expect(budget.canContinue()).toEqual({
      ok: false,
      reason: "max_verification_calls",
    });
  });

  it("blocks when the elapsed time ceiling is reached", () => {
    const budget = createBudgetTracker({ maxElapsedMs: 0 });
    expect(budget.canContinue()).toEqual({ ok: false, reason: "max_elapsed" });
  });

  it("getUsage returns a snapshot, not a live reference", () => {
    const budget = createBudgetTracker();
    const usage = budget.getUsage();
    budget.recordLlmCall(10);
    expect(usage.llmCalls).toBe(0);
    expect(budget.getUsage().llmCalls).toBe(1);
  });
});
