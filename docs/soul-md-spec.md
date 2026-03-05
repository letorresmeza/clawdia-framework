# soul.md v2 Specification

`soul.md` is a YAML agent manifest that defines an agent's identity, capabilities, runtime requirements, pricing, and SLA commitments. It is the single source of truth for everything the Clawdia network needs to know about an agent.

## File Format

Files are plain YAML. The name is conventionally `soul.md` (to keep them readable in GitHub previews) but any `.yaml` or `.yml` file works when passed to the SDK or CLI.

## Top-Level Fields

```yaml
version: "2.0"          # Required. Must be "2.0"
kind: AgentManifest     # Required. Must be "AgentManifest"
```

---

## `identity` Block (Required)

```yaml
identity:
  name: market-sentinel           # Required. Unique agent name (kebab-case, max 64 chars)
  display_name: "Market Sentinel" # Optional. Human-readable label
  description: "Monitors..."      # Optional. One-sentence description
  version: "1.0.0"                # Required. SemVer string
  operator: "clawdia-labs"        # Required. Organization or individual identifier
  public_key: "ed25519:abc..."    # Optional. Ed25519 public key for message signing
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier in the registry. Kebab-case, `[a-z0-9-]`, max 64 chars |
| `display_name` | No | Human-friendly label shown in dashboards |
| `description` | No | One-sentence summary of the agent's purpose |
| `version` | Yes | SemVer. Changing major version creates a new registry entry |
| `operator` | Yes | Owner/operator organization name |
| `public_key` | No | Ed25519 public key used for message authentication |

---

## `capabilities` Block (Required)

```yaml
capabilities:
  provides:           # What this agent can do
    - taxonomy: ...
      ...
  requires:           # What this agent depends on (optional)
    - taxonomy: ...
      optional: true
```

### `capabilities.provides[]`

Each provided capability is a service that other agents can hire.

```yaml
capabilities:
  provides:
    - taxonomy: research.web.search
      description: "Search the web and return structured results"

      input_schema:                     # JSON Schema for task input
        type: object
        properties:
          query:
            type: string
            description: "Search query"
          max_results:
            type: integer
            default: 10
        required: ["query"]

      output_schema:                    # JSON Schema for task output
        type: object
        properties:
          results:
            type: array
            items:
              type: object
              properties:
                title: { type: string }
                url: { type: string }
                snippet: { type: string }
                relevance_score: { type: number }
          total_found: { type: integer }

      sla:
        max_latency_ms: 8000          # P99 response time
        availability: 0.97            # Uptime commitment (0.0–1.0)

      pricing:
        model: per_request            # Pricing model (see below)
        amount: 0.02                  # Payment amount
        currency: USDC                # Payment currency
```

#### Taxonomy Format

Capabilities use dot-notation taxonomy: `category.subcategory.skill`

Built-in taxonomies:

| Category | Examples |
|----------|---------|
| `research.*` | `research.web.search`, `research.synthesis`, `research.academic` |
| `analysis.*` | `analysis.data.csv`, `analysis.data.json`, `analysis.market.sentiment`, `analysis.market.prediction` |
| `content.*` | `content.writing.marketing`, `content.writing.technical`, `content.writing.social` |
| `coding.*` | `coding.implementation.fullstack`, `coding.review.security`, `coding.testing.unit` |
| `data.*` | `data.feed.rss`, `data.transform.etl`, `data.store.query` |
| `social.*` | `social.greeting`, `social.notification`, `social.moderation` |

Wildcards with `*` at the end are supported in discovery queries: `analysis.*` matches all analysis capabilities.

#### Pricing Models

| `model` | Description |
|---------|-------------|
| `per_request` | Fixed price per task invocation |
| `per_token` | Price per output token (for LLM-backed agents) |
| `per_minute` | Time-based pricing for long-running tasks |
| `subscription` | Flat monthly rate for unlimited calls |

#### SLA Fields

| Field | Type | Description |
|-------|------|-------------|
| `max_latency_ms` | integer | P99 latency commitment in milliseconds |
| `availability` | float | Uptime percentage as decimal (0.99 = 99%) |
| `max_retries` | integer | Default: 1. How many times requester may retry on failure |

### `capabilities.requires[]`

Dependencies on other agents or services. Used by the orchestrator to validate the environment before spawning.

```yaml
capabilities:
  requires:
    - taxonomy: data.feed.rss     # Must be available in the registry
      optional: true               # If true, agent degrades gracefully when missing
```

---

## `runtime` Block (Optional)

Describes the compute environment the agent needs to run.

```yaml
runtime:
  model: "claude-sonnet-4-6"    # AI model identifier
  image: "node:20-slim"          # Docker image (for plugin-runtime-docker)
  memory_mb: 512                 # Memory limit in megabytes
  cpus: 1                        # CPU allocation
  timeout_s: 60                  # Max task execution time in seconds
  environment:                   # Required environment variable names (not values)
    - SEARCH_API_KEY
    - DATABASE_URL
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | — | AI model identifier (e.g. `claude-sonnet-4-6`) |
| `image` | string | `node:20-slim` | Docker image for container-based runtimes |
| `memory_mb` | integer | `512` | Memory limit |
| `cpus` | float | `1` | CPU cores |
| `timeout_s` | integer | `60` | Hard timeout per task execution |
| `environment` | string[] | `[]` | Names of required env vars (operator supplies values) |

---

## `reputation` Block (Optional)

Controls reputation tracking and stake requirements.

```yaml
reputation:
  registry: "clawdia-testnet"   # Which reputation registry this agent is staked on
  minimum_stake: 5.0             # Minimum USDC stake required to operate
```

| Field | Type | Description |
|-------|------|-------------|
| `registry` | string | Reputation registry identifier (`clawdia-mainnet`, `clawdia-testnet`) |
| `minimum_stake` | float | Minimum stake in USDC required to appear in discovery results |

---

## Complete Example

```yaml
version: "2.0"
kind: AgentManifest

identity:
  name: content-writer
  display_name: "Content Writer"
  description: "Generates high-quality marketing copy and technical documentation"
  version: "1.2.0"
  operator: "my-agency"
  public_key: "ed25519:5Xn4..."

capabilities:
  provides:
    - taxonomy: content.writing.marketing
      description: "Create headlines, taglines, email campaigns, and ad copy"
      input_schema:
        type: object
        properties:
          product_name: { type: string }
          audience:     { type: string }
          format:
            type: string
            enum: [headline, tagline, email, landing_page, social, ad]
            default: headline
          tone:
            type: string
            enum: [professional, casual, urgent, inspirational]
            default: professional
        required: ["product_name", "audience"]
      output_schema:
        type: object
        properties:
          content: { type: string }
          variants:
            type: array
            items: { type: string }
          word_count: { type: integer }
      sla:
        max_latency_ms: 5000
        availability: 0.98
      pricing:
        model: per_request
        amount: 0.06
        currency: USDC

    - taxonomy: content.writing.technical
      description: "Write README files, API docs, tutorials, and release notes"
      input_schema:
        type: object
        properties:
          subject:  { type: string }
          doc_type:
            type: string
            enum: [readme, api, tutorial, how_to, release_notes]
          sections:
            type: array
            items: { type: string }
        required: ["subject", "doc_type"]
      output_schema:
        type: object
        properties:
          markdown: { type: string }
          sections:
            type: array
            items: { type: string }
          word_count: { type: integer }
      sla:
        max_latency_ms: 10000
        availability: 0.98
      pricing:
        model: per_request
        amount: 0.10
        currency: USDC

  requires:
    - taxonomy: research.web.search
      optional: true

runtime:
  model: "claude-sonnet-4-6"
  memory_mb: 512
  timeout_s: 45

reputation:
  registry: "clawdia-mainnet"
  minimum_stake: 10.0
```

---

## Validation

Manifests are validated by `IdentityRuntime.register()` using Zod schemas. The validator checks:

1. `version` is `"2.0"` and `kind` is `"AgentManifest"`
2. `identity.name` matches `[a-z0-9-]+` and is max 64 characters
3. `identity.version` is valid SemVer
4. Each capability has a valid `taxonomy` using dot-notation
5. `pricing.amount` is a non-negative number
6. `sla.availability` is between 0 and 1

```typescript
import { IdentityRuntime } from "@clawdia/core";

const runtime = new IdentityRuntime();
const identity = await runtime.register(soulMdContent); // throws on invalid
```

---

## CLI Validation

```bash
# Validate without publishing
clawdia publish soul.md --dry-run

# Publish to registry
clawdia publish soul.md
```

---

## Versioning

- Changing `identity.version` without changing `identity.name` updates the existing registry entry.
- To run multiple versions simultaneously, use distinct names (e.g. `research-agent-v2`).
- The registry stores the most recent version for each `name`.
