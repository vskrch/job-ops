/**
 * robots.txt gate for fetch escalation (C2).
 *
 * This is the minimal, portable core of tools/robots_check.py from the
 * source repo (longest-match, tie→Disallow, percent-decode rule patterns,
 * wildcard + Claude-User matching, HTML-200 trap). The network layer
 * (reading the policy as browser when anon-403) lives in the crawl engine;
 * this file is the rule evaluator.
 */

export type RobotsDirective = {
  pattern: string;
  allow: boolean;
};

export type RobotsRecord = {
  userAgents: string[];
  rules: RobotsDirective[];
};

export function parseRobotsRecords(text: string): RobotsRecord[] {
  if (!text.trim()) return [];
  const records: RobotsRecord[] = [];
  let current: RobotsRecord | null = null;
  const lines = text.split(/\r?\n/);
  let sawDirectiveInRecord = false;

  function startRecord(ua: string): void {
    // A blank line ends the current directive block, but user-agent lines
    // after it still belong to the same record until a non-UA directive
    // appears (per the source's tie-break semantics). Treat empty lines as
    // boundaries only between complete blocks: we close the current record
    // once a non-UA, non-empty line arrives after a completed UA set.
    if (!current || sawDirectiveInRecord) {
      if (current) records.push(current);
      current = { userAgents: [], rules: [] };
      sawDirectiveInRecord = false;
    }
    current.userAgents.push(ua.toLowerCase());
  }

  for (const raw of lines) {
    const line = raw.split("#")[0]?.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!value) continue;
      startRecord(value);
    } else if (key === "allow" || key === "disallow") {
      if (!current) continue;
      sawDirectiveInRecord = true;
      if (value === "") continue; // per spec: empty Disallow: = allow
      const allow = key === "allow";
      const rec: RobotsRecord = current;
      rec.rules.push({ pattern: value, allow });
    }
  }
  if (current) records.push(current);
  return records;
}

export function unrecognizedDirectivesTreatedAsEmpty(
  records: RobotsRecord[],
): boolean {
  // A non-empty body carrying zero recognized directives (e.g. an HTML 200)
  // is unreadable, not allow-all (the FAIL-OPEN trap).
  // We signal this by: body non-empty but records has no rules at all.
  return (
    records.length > 0 &&
    records.every((r: RobotsRecord) => r.rules.length === 0)
  );
}

function percentDecodeRule(pattern: string): string {
  try {
    return decodeURIComponent(pattern);
  } catch {
    return pattern;
  }
}

function patternMatchesRulePath(pattern: string, requestPath: string): boolean {
  // RFC 9309 longest-match: pattern is a prefix match (optionally with `$` anchor or `*`).
  // For our project the patterns are simple prefixes (`/foo`, `/bar%20baz`, `/cs/`); implement that.
  let pat = percentDecodeRule(pattern);
  const path = requestPath;
  // Anchored exact match.
  if (pat.endsWith("$")) {
    pat = pat.slice(0, -1);
    return path === pat;
  }
  // Wildcard `*` → prefix up to star (good enough for transported patterns).
  const starIdx = pat.indexOf("*");
  if (starIdx !== -1) {
    pat = pat.slice(0, starIdx);
  }
  return path.startsWith(pat);
}

export function isAllowedByRobots(
  records: RobotsRecord[],
  requestPath: string,
  uaCandidates: string[] = ["*", "claude-user"],
): boolean {
  // Collect applicable records: any record matching one of the UA candidates.
  const applicable: RobotsDirective[] = [];
  const lowerCandidates = uaCandidates.map((u) => u.toLowerCase());
  for (const record of records) {
    const matches = record.userAgents.some(
      (ua) => lowerCandidates.includes(ua) || ua === "*",
    );
    if (matches) applicable.push(...record.rules);
  }
  if (applicable.length === 0) return true;

  // Longest-match wins; tie between Allow and Disallow → Disallow, and a
  // disallow for either candidate blocks the retry (fail-closed per spec).
  let best: { directive: RobotsDirective; length: number } | null = null;
  for (const rule of applicable) {
    if (!patternMatchesRulePath(rule.pattern, requestPath)) continue;
    const len = rule.pattern.length;
    if (
      best === null ||
      len > best.length ||
      (len === best.length && !rule.allow && best.directive.allow)
    ) {
      best = { directive: rule, length: len };
    }
  }
  if (!best) return true;
  return best.directive.allow;
}
