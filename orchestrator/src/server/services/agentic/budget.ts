import type { BudgetLimits, BudgetUsage } from "@shared/types";

const DEFAULT_LIMITS: BudgetLimits = {
  maxLlmCalls: 30,
  maxTotalTokens: 100_000,
  maxEstimatedCost: 0.5,
  maxElapsedMs: 300_000,
  maxIterations: 5,
  maxVerificationCalls: 20,
};

export function getBudgetLimits(
  overrides?: Partial<BudgetLimits>,
): BudgetLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

export function createBudgetTracker(overrides?: Partial<BudgetLimits>) {
  const resolved = getBudgetLimits(overrides);
  const usage: BudgetUsage = {
    llmCalls: 0,
    totalTokens: 0,
    estimatedCost: 0,
    elapsedMs: 0,
  };
  const startTime = Date.now();
  let verificationCalls = 0;
  let iterations = 0;

  return {
    getUsage(): BudgetUsage {
      usage.elapsedMs = Date.now() - startTime;
      return { ...usage };
    },
    getLimits(): BudgetLimits {
      return resolved;
    },
    recordLlmCall(tokens: number, costEstimate = 0): void {
      usage.llmCalls += 1;
      usage.totalTokens += tokens;
      usage.estimatedCost += costEstimate;
    },
    recordVerificationCall(): void {
      verificationCalls += 1;
    },
    incrementIteration(): void {
      iterations += 1;
    },
    canContinue(): { ok: boolean; reason?: string } {
      usage.elapsedMs = Date.now() - startTime;
      if (iterations >= resolved.maxIterations)
        return { ok: false, reason: "max_iterations" };
      if (usage.llmCalls >= resolved.maxLlmCalls)
        return { ok: false, reason: "max_llm_calls" };
      if (usage.totalTokens >= resolved.maxTotalTokens)
        return { ok: false, reason: "max_tokens" };
      if (usage.estimatedCost >= resolved.maxEstimatedCost)
        return { ok: false, reason: "max_cost" };
      if (usage.elapsedMs >= resolved.maxElapsedMs)
        return { ok: false, reason: "max_elapsed" };
      if (verificationCalls >= resolved.maxVerificationCalls)
        return { ok: false, reason: "max_verification_calls" };
      return { ok: true };
    },
  };
}
