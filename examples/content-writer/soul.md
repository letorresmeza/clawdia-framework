version: "2.0"
kind: AgentManifest

identity:
  name: content-writer
  display_name: "Content Writer"
  description: "Generates high-quality marketing copy, technical documentation, and editorial content tailored to brand voice and target audience"
  version: "1.0.0"
  operator: "clawdia-labs"

capabilities:
  provides:
    - taxonomy: content.writing.marketing
      description: "Generate marketing copy — ads, emails, landing pages, social posts, and campaign messaging"
      input_schema:
        type: object
        properties:
          product_name:
            type: string
            description: "Name of the product or service"
          product_description:
            type: string
            description: "Brief description of what it does"
          target_audience:
            type: string
            description: "Who this content is for"
          tone:
            type: string
            enum: ["professional", "casual", "playful", "urgent", "inspiring"]
            default: "professional"
          content_type:
            type: string
            enum: ["headline", "tagline", "email_subject", "email_body", "landing_page", "social_post", "ad_copy", "product_description"]
            default: "landing_page"
          key_benefits:
            type: array
            items: { type: string }
            description: "Key benefits or features to highlight"
          word_limit:
            type: integer
            description: "Maximum word count"
        required: ["product_name", "product_description", "target_audience", "content_type"]
      output_schema:
        type: object
        properties:
          content: { type: string }
          headline: { type: string }
          cta: { type: string }
          word_count: { type: integer }
          variants:
            type: array
            items:
              type: object
              properties:
                variant: { type: string }
                content: { type: string }
      sla:
        max_latency_ms: 12000
        availability: 0.98
      pricing:
        model: per_request
        amount: 0.06
        currency: USDC

    - taxonomy: content.writing.technical
      description: "Write technical documentation — READMEs, API docs, tutorials, how-to guides, and release notes"
      input_schema:
        type: object
        properties:
          subject:
            type: string
            description: "What to document"
          doc_type:
            type: string
            enum: ["readme", "api_reference", "tutorial", "how_to", "release_notes", "architecture_overview"]
            default: "readme"
          audience_level:
            type: string
            enum: ["beginner", "intermediate", "expert"]
            default: "intermediate"
          code_samples:
            type: array
            items:
              type: object
              properties:
                language: { type: string }
                code: { type: string }
            description: "Code samples to document or reference"
          sections:
            type: array
            items: { type: string }
            description: "Required sections (e.g. [Installation, Usage, API, Contributing])"
          style_guide:
            type: string
            enum: ["google", "microsoft", "apple", "minimal"]
            default: "minimal"
        required: ["subject", "doc_type"]
      output_schema:
        type: object
        properties:
          markdown: { type: string }
          sections_written:
            type: array
            items: { type: string }
          word_count: { type: integer }
          estimated_read_time_min: { type: number }
      sla:
        max_latency_ms: 20000
        availability: 0.98
      pricing:
        model: per_request
        amount: 0.10
        currency: USDC

runtime:
  model: "claude-sonnet-4-6"
  memory_mb: 512
  timeout_s: 90

reputation:
  registry: "clawdia-testnet"
  minimum_stake: 5.0
