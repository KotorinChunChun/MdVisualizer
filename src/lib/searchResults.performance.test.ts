import { describe, expect, it } from "vitest";
import { findSearchResults } from "./searchResults";

const SEARCH_FIXTURE_SEED = 1401;
const SEARCH_FIXTURE_LINES = 10_000;
const SEARCH_FIXTURE_HEADINGS = 1_000;
const SEARCH_FIXTURE_MATCHES = 501;
const SEARCH_P95_BUDGET_MS = 200;

interface SearchPerformanceFixture {
  content: string;
  lineCount: number;
  headingCount: number;
  matchCount: number;
}

function createSearchPerformanceFixture(seed: number): SearchPerformanceFixture {
  let state = seed >>> 0;
  const nextToken = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state.toString(36).padStart(7, "0");
  };

  const lines: string[] = [];
  for (let lineNumber = 1; lineNumber <= SEARCH_FIXTURE_LINES; lineNumber += 1) {
    if (lineNumber <= SEARCH_FIXTURE_HEADINGS) {
      lines.push(`## Section ${lineNumber.toString().padStart(4, "0")} ${nextToken()}`);
      continue;
    }
    if (lineNumber <= SEARCH_FIXTURE_HEADINGS + 20) {
      lines.push(`| key-${lineNumber} | value-${nextToken()} |`);
      continue;
    }
    if (lineNumber <= SEARCH_FIXTURE_HEADINGS + 20 + 10) {
      lines.push(`\`\`\`mermaid flowchart LR A${lineNumber} --> B${nextToken()} \`\`\``);
      continue;
    }

    const matchText = lineNumber > 2_000 && lineNumber <= 2_000 + SEARCH_FIXTURE_MATCHES
      ? ` Needle row-${lineNumber.toString().padStart(4, "0")}`
      : "";
    lines.push(`Paragraph ${lineNumber.toString().padStart(5, "0")} ${nextToken()}${matchText}`);
  }

  return {
    content: lines.join("\n"),
    lineCount: lines.length,
    headingCount: lines.filter((line) => /^#{1,6}\s/.test(line)).length,
    matchCount: lines.filter((line) => line.includes("Needle")).length,
  };
}

function percentile(values: number[], percentileRank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * percentileRank) - 1);
  return sorted[index];
}

function measureSearch(
  content: string,
  query: string,
  options: { regex?: boolean; caseSensitive?: boolean },
): { p50: number; p95: number; samples: number[] } {
  const run = () => findSearchResults(content, query, { ...options, contextLines: 0 });
  for (let index = 0; index < 10; index += 1) run();

  const samples: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    const startedAt = performance.now();
    run();
    samples.push(performance.now() - startedAt);
  }
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), samples };
}

describe("findSearchResults large-document performance", () => {
  const fixture = createSearchPerformanceFixture(SEARCH_FIXTURE_SEED);

  it("creates the fixed 10,000-line and 1,000-heading fixture", () => {
    expect(fixture.lineCount).toBe(SEARCH_FIXTURE_LINES);
    expect(fixture.headingCount).toBe(SEARCH_FIXTURE_HEADINGS);
    expect(fixture.matchCount).toBe(SEARCH_FIXTURE_MATCHES);
  });

  it("keeps the 0, 500, and 501 result boundaries", () => {
    expect(findSearchResults(fixture.content, "not-present", { contextLines: 0 }).results).toHaveLength(0);

    const capped = findSearchResults(fixture.content, "needle", { contextLines: 0 });
    expect(capped.results).toHaveLength(500);
    expect(capped.truncated).toBe(true);

    const uncapped = findSearchResults(fixture.content, "needle", { contextLines: 0, limit: SEARCH_FIXTURE_MATCHES });
    expect(uncapped.results).toHaveLength(SEARCH_FIXTURE_MATCHES);
    expect(uncapped.truncated).toBe(false);
  });

  it("records warmup-after-10 p50/p95 for literal, case-sensitive, and regex search", () => {
    const measurements = {
      literal: measureSearch(fixture.content, "needle", {}),
      caseSensitive: measureSearch(fixture.content, "Needle", { caseSensitive: true }),
      regex: measureSearch(fixture.content, String.raw`Needle\s+row-\d{4}`, { regex: true, caseSensitive: true }),
    };
    const maximumP95 = Math.max(...Object.values(measurements).map((measurement) => measurement.p95));

    console.info("[search-performance]", JSON.stringify({ seed: SEARCH_FIXTURE_SEED, measurements }));
    expect(maximumP95).toBeLessThanOrEqual(SEARCH_P95_BUDGET_MS);
  }, 10_000);
});
