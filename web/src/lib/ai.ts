/**
 * AI abstraction layer. Runs on mock data until ANTHROPIC_API_KEY is set —
 * every function here returns deterministic, realistic-looking English output
 * so the rest of the product can be built and tested at zero cost.
 *
 * When ANTHROPIC_API_KEY is set, replace the mock branches below with real
 * calls to the Anthropic Messages API (see docs.claude.com). Nothing else in
 * the app needs to change — callers only depend on these function signatures.
 */

const hasRealApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

export interface ParsedCandidateProfile {
  seekingRole: string;
  ecosystem: string;
  format: string;
  compFrom: number;
  avoid: string;
}

export async function parseCv(rawText: string): Promise<ParsedCandidateProfile> {
  if (!hasRealApiKey) {
    return mockParseCv(rawText);
  }
  throw new Error("Real Anthropic CV parsing not yet wired up.");
}

function mockParseCv(rawText: string): ParsedCandidateProfile {
  const hasRust = /rust/i.test(rawText);
  const hasSolana = /solana/i.test(rawText);

  return {
    seekingRole: hasRust ? "Senior Rust / Protocol Engineer" : "Software Engineer",
    ecosystem: hasSolana ? "Solana" : "Ethereum / EVM",
    format: "Remote, EU timezone",
    compFrom: 150000,
    avoid: "NFT, gaming",
  };
}

export interface DraftInput {
  role: string;
  company?: string | null;
  sourceText: string;
  candidateSeekingRole: string;
}

export interface GeneratedDraft {
  whyYou: string;
  draftText: string;
}

export async function generateDraft(input: DraftInput): Promise<GeneratedDraft> {
  if (!hasRealApiKey) {
    return mockGenerateDraft(input);
  }
  throw new Error("Real Anthropic draft generation not yet wired up.");
}

function mockGenerateDraft(input: DraftInput): GeneratedDraft {
  const company = input.company ?? "the team";
  return {
    whyYou: `Your background as a ${input.candidateSeekingRole} lines up directly with what ${company} is asking for in this post.`,
    draftText:
      `Hi! Saw your post about the ${input.role} role` +
      (input.company ? ` at ${input.company}` : "") +
      `. I've got relevant experience and would love to learn more about what you're building — is now a good time to chat?`,
  };
}
