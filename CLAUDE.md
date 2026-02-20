# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An AWS Bedrock provider plugin for Alma that enables Claude models via Amazon Bedrock using API Key authentication. It registers as a provider in Alma's plugin system, handles model discovery through AWS inference profiles, and translates Anthropic-format API requests into Bedrock SDK calls.

Alma plugin API documentation: https://alma.now/docs/plugins/

## Commands

- `pnpm install` — install dependencies (use `--frozen-lockfile` in CI)
- `pnpm build` — compile TypeScript to `dist/`
- `pnpm dev` — watch mode compilation
- `pnpm clean` — remove `dist/`
- `pnpm typecheck` — run tsc type checking

No test framework is configured.

## Architecture

Two source files at root + `lib/`:

**`main.ts`** — Plugin entry point. Exports `activate(context)` which creates a `BedrockClient`, registers the provider with Alma (`context.providers.register()`), and listens for settings changes to reload the client.

**`lib/bedrock.ts`** — Core implementation. `BedrockClient` manages:
- `anthropicClient` (AnthropicBedrock SDK) — handles message creation. Initialized with `skipAuth: true` and a custom fetch that injects a Bearer token. Used via `getSDKConfig()` which returns a fake `baseURL` (`https://bedrock.local/v1`) and a custom fetch handler that intercepts Anthropic-format requests, routes them through the Bedrock SDK, and converts streaming responses to SSE format.
- Model listing via raw `fetch` to the Bedrock REST API (`GET /inference-profiles`), replacing the previous `@aws-sdk/client-bedrock` dependency.

Types come from the `alma-plugin-api` npm package (devDependency).

## Key Patterns

- **Auth strategy**: The AnthropicBedrock SDK bypasses standard AWS auth via `skipAuth: true`. Bearer API key is injected via custom fetch for both message handling and model listing.
- **Request flow**: Alma sends Anthropic-format requests → custom fetch in `getSDKConfig()` intercepts → parses body → delegates to `anthropicClient.messages.stream()` or `.create()` → returns SSE stream or JSON response.
- **Model listing**: Direct REST call to `https://bedrock.{region}.amazonaws.com/inference-profiles` with Bearer auth, paginated via `nextToken`.
- **Model capabilities**: Inferred from model ID regex patterns (Claude 4/3.5/3 families) with different context windows and feature flags.
- **Settings reactivity**: `context.settings.onDidChange()` triggers `client.reload()` when any `bedrock.*` setting changes.

## CI/CD

GitHub Actions builds on push to `main` and deploys compiled artifacts to the `release` branch (force orphan). Users install via `https://github.com/hephyr/alma-bedrock#release`.

## Plugin Manifest

`manifest.json` declares permissions (`network`, `secrets`, `providers:manage`), activation event (`onStartup`), provider registration (`contributes.providers`), and configuration schema (`bedrock.region`, `bedrock.apiKey`).
