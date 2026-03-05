/**
 * Content Writer Agent — example Clawdia agent using the SDK.
 *
 * Generates marketing copy and technical documentation.
 * In production, replace the template-based output with Claude API calls.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "@clawdia/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const soulMd = readFileSync(join(__dirname, "..", "soul.md"), "utf-8");

// ─── Task handlers ────────────────────────────────────────────────────────────

function writeMarketing(input: unknown): unknown {
  const {
    product_name,
    product_description,
    target_audience,
    tone = "professional",
    content_type = "landing_page",
    key_benefits = [],
    word_limit = 200,
  } = input as {
    product_name: string;
    product_description: string;
    target_audience: string;
    tone?: string;
    content_type?: string;
    key_benefits?: string[];
    word_limit?: number;
  };

  const toneAdverb = {
    professional: "effectively",
    casual: "easily",
    playful: "brilliantly",
    urgent: "now",
    inspiring: "boldly",
  }[tone] ?? "effectively";

  const benefitLines =
    key_benefits.length > 0
      ? key_benefits.map((b) => `• ${b}`).join("\n")
      : `• Designed for ${target_audience}\n• ${product_description}`;

  const templates: Record<string, string> = {
    headline: `${product_name}: ${product_description} — ${toneAdverb}.`,
    tagline: `${product_name} — built for ${target_audience}.`,
    email_subject: `[${product_name}] ${product_description.slice(0, 40)}…`,
    social_post: `Introducing ${product_name} 🚀\n\n${product_description}\n\nPerfect for ${target_audience}.\n\n${benefitLines}`,
    ad_copy: `${product_name}: ${product_description.slice(0, 60)}. Get started today.`,
    product_description: `${product_name} is ${product_description.toLowerCase()}. Built for ${target_audience}, it helps you accomplish your goals ${toneAdverb}.\n\n${benefitLines}`,
    landing_page: `# ${product_name}\n\n> ${product_description}\n\n**Made for ${target_audience}.**\n\n## Why ${product_name}?\n\n${benefitLines}\n\n## Get Started\n\nJoin thousands of users who chose ${product_name} to ${product_description.toLowerCase()} ${toneAdverb}.`,
    email_body: `Hi there,\n\nWe're excited to introduce ${product_name} — ${product_description.toLowerCase()}.\n\nAs someone focused on ${target_audience}, this is for you:\n\n${benefitLines}\n\nGet started today.\n\nBest,\nThe ${product_name} Team`,
  };

  const content = (templates[content_type] ?? templates["landing_page"]!).slice(0, word_limit * 6);
  const wordCount = content.split(/\s+/).length;

  return {
    content,
    headline: `${product_name}: ${product_description.slice(0, 50)}`,
    cta: `Get ${product_name} today`,
    word_count: wordCount,
    variants: [
      { variant: "A", content: content },
      { variant: "B", content: content.replace(product_name, `✨ ${product_name}`) },
    ],
  };
}

function writeTechnical(input: unknown): unknown {
  const {
    subject,
    doc_type = "readme",
    audience_level = "intermediate",
    code_samples = [],
    sections = [],
  } = input as {
    subject: string;
    doc_type?: string;
    audience_level?: string;
    code_samples?: Array<{ language: string; code: string }>;
    sections?: string[];
    style_guide?: string;
  };

  const defaultSections: Record<string, string[]> = {
    readme: ["Overview", "Installation", "Usage", "API", "Contributing"],
    api_reference: ["Authentication", "Endpoints", "Request Format", "Response Format", "Errors"],
    tutorial: ["Prerequisites", "Setup", "Step 1", "Step 2", "Step 3", "Conclusion"],
    how_to: ["Prerequisites", "Steps", "Verification", "Troubleshooting"],
    release_notes: ["What's New", "Bug Fixes", "Breaking Changes", "Migration Guide"],
    architecture_overview: ["System Design", "Components", "Data Flow", "Security", "Scalability"],
  };

  const sectionsToWrite = sections.length > 0 ? sections : (defaultSections[doc_type] ?? ["Overview", "Usage"]);

  const codeBlock =
    code_samples.length > 0
      ? `\`\`\`${code_samples[0]!.language}\n${code_samples[0]!.code}\n\`\`\``
      : `\`\`\`bash\n# Install\nnpm install ${subject.toLowerCase().replace(/\s+/g, "-")}\n\`\`\``;

  const sectionContent = sectionsToWrite
    .map((s) => `## ${s}\n\n_${audience_level}-level documentation for ${s.toLowerCase()} of ${subject}._\n\n${s === "Installation" || s === "Setup" ? codeBlock + "\n" : ""}`)
    .join("\n");

  const markdown = `# ${subject}\n\n> ${doc_type.replace(/_/g, " ")} — ${audience_level} level\n\n${sectionContent}`;
  const wordCount = markdown.split(/\s+/).length;

  return {
    markdown,
    sections_written: sectionsToWrite,
    word_count: wordCount,
    estimated_read_time_min: Math.ceil(wordCount / 200),
  };
}

// ─── Agent factory ────────────────────────────────────────────────────────────

export async function startContentWriter(
  ...args: Parameters<typeof createAgent>
): ReturnType<typeof createAgent> {
  const [opts] = args;
  return createAgent({
    ...opts,
    soulMd,
    async onTask({ input, contract, ctx }) {
      ctx.log(`Writing content: ${contract.capability}`);

      switch (contract.capability) {
        case "content.writing.marketing":
          return writeMarketing(input);
        case "content.writing.technical":
          return writeTechnical(input);
        default:
          throw new Error(`Unknown capability: ${contract.capability}`);
      }
    },
  });
}

// ─── Standalone runner ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { InMemoryBus, ContractEngine } = await import("@clawdia/core");
  const { ServiceRegistry } = await import("@clawdia/orchestrator");

  const bus = new InMemoryBus();
  await bus.connect();

  const agent = await createAgent({
    soulMd,
    bus,
    registry: new ServiceRegistry(bus),
    contracts: new ContractEngine(bus),
    async onTask({ input, contract, ctx }) {
      ctx.log(`Writing content: ${contract.capability}`);
      switch (contract.capability) {
        case "content.writing.marketing": return writeMarketing(input);
        case "content.writing.technical": return writeTechnical(input);
        default: throw new Error(`Unknown capability: ${contract.capability}`);
      }
    },
  });

  console.log(`[content-writer] Online — ${agent.identity.capabilities.length} capabilities`);

  process.on("SIGINT", async () => { await agent.stop(); process.exit(0); });
  process.on("SIGTERM", async () => { await agent.stop(); process.exit(0); });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) main().catch(console.error);
