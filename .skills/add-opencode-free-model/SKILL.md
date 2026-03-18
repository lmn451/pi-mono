---
name: add-opencode-free-model
description: Add a free model from OpenCode to the model registry. Fetches OpenCode's available models, identifies free models by cost=0, and updates the generated models file.
---

# Add OpenCode Free Model

This skill adds a free model from OpenCode to the my-pi model registry.

## How Free Models Work

OpenCode marks free models with `allowAnonymous: true` in their server config, but this isn't publicly exposed. Instead, free models are identified by:
- `cost.input = 0` and `cost.output = 0`
- Model IDs often contain `-free` suffix (e.g., `minimax-m2.5-free`, `nemotron-3-super-free`)

## Usage

Run from the repo root:

```bash
npm run generate-models
```

This fetches models from:
1. models.dev API - comprehensive model registry
2. OpenRouter API - xAI and other providers
3. Vercel AI Gateway - OpenAI-compatible catalog
4. OpenCode Zen API - validates available models

## Adding a New Free Model

### Option 1: Model is in models.dev

If the model exists in models.dev with `cost.input = 0` and `cost.output = 0`, it's automatically included.

### Option 2: Model exists on OpenCode but not in models.dev

1. Fetch OpenCode's model list:
   ```bash
   curl https://opencode.ai/zen/v1/models
   ```

2. Manually add the model to `packages/ai/scripts/generate-models.ts`:
   ```typescript
   // Add missing OpenCode free model
   if (!allModels.some(m => m.provider === "opencode" && m.id === "model-id")) {
     allModels.push({
       id: "model-id",
       name: "Model Name",
       api: "openai-responses", // or appropriate API
       baseUrl: "https://opencode.ai/zen/v1",
       reasoning: true,
       input: ["text"],
       cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
       contextWindow: 128000,
       maxTokens: 16384,
     });
   }
   ```

### Option 3: Discover free models from OpenCode

1. Check OpenCode's available models:
   ```bash
   curl https://opencode.ai/zen/v1/models
   ```

2. Check if model supports tools by testing without API key:
   ```bash
   curl -X POST https://opencode.ai/zen/v1/responses \
     -H "Content-Type: application/json" \
     -d '{"model":"model-id","max_output_tokens":100,"input":[{"role":"user","content":"Hi"}]}'
   ```

3. If successful (no auth error), add to generate-models.ts

## Regenerating Models

After modifying `generate-models.ts`:

```bash
cd packages/ai
npm run generate-models
```

This regenerates `src/models.generated.ts` with all models.

## Files to Update

- `packages/ai/scripts/generate-models.ts` - Add new models or modify existing ones
- `packages/ai/src/models.generated.ts` - Auto-generated, do not edit manually

## Testing

Verify the model appears:

```typescript
import { getModel } from "@mariozechner/pi-ai";
const model = getModel("opencode", "model-id");
console.log(model.cost); // Should show input: 0, output: 0
```
