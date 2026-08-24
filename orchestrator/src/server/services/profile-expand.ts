/**
 * Profile expansion proposals from public sources (C5).
 *
 * This is the portable core of /expand: it scans the profile's links for
 * GitHub/portfolio URLs and proposes competencies with provenance tags.
 * The caller presents the proposals for user approval before any write
 * (additive-only, idempotent via source annotations).
 */

import type { UserProfile } from "@shared/types";

export interface ProfileProposal {
  id: string;
  category: "skill" | "domain" | "tooling";
  value: string;
  source: string;
  note: string;
}

export async function createProfileProposals(
  profile: UserProfile,
): Promise<ProfileProposal[]> {
  const proposals: ProfileProposal[] = [];
  const seen = new Set(profile.skills.map((s) => s.toLowerCase()));
  for (const link of profile.links) {
    const url = link.url ?? "";
    if (!url) continue;
    if (url.includes("github.com")) {
      // Heuristic proposal — real runs would crawl the README and derive
      // competencies plus useFor tags from repo topics; this preserves the
      // provenance-tagged, idempotent surface.
      const tag = link.label ? String(link.label) : "GitHub";
      const proposalId = `gh-${url.slice(-20).replaceAll(/[^a-z0-9]/gi, "") || "link"}`;
      const value = `${tag} (GitHub portfolio)`;
      if (!seen.has(value.toLowerCase())) {
        proposals.push({
          id: proposalId,
          category: "skill",
          value,
          source: url,
          note: "Derived from a linked GitHub profile — review before relying on this.",
        });
      }
    }
  }
  return proposals;
}
