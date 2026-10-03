# NSoft Mail Companion

## Engineering authority

Codex owns architecture, integration, security, database migrations, release decisions, and production operations. Local workers may perform only bounded tasks in isolated worktrees.

GPT-6 Luna (gpt-6-luna) is the lead orchestrator and reviewer, selected in the Codex model picker. Reserve GPT-6 Sol (gpt-6-sol) for architecture, security, authentication, authorization, payments, infrastructure, difficult debugging, deployment, database migrations, and final high-risk review. Use Qwen 3 4B Instruct through OpenCode/Ollama for fast exploration, documentation, simple fixes, and mechanical work. Use Qwen 2.5 Coder 7B for focused non-sensitive UI, animation, responsive design, styling, components, routine implementation, test fixes, and low-risk refactoring. Both local workers use no Codex subscription allowance.

Use Gemini 3.1 Flash Lite only for bounded, secret-scanned, read-only large-context review. Before any requested Git push or deployment, run the mandatory Groq Qwen 3.8 27B release gate over the bounded diff, checks, rollout plan, and rollback plan. Groq never executes the release. If the gate is unavailable or blocks, stop unless the user explicitly approves a recorded one-time bypass.

## Required workflow

1. Read relevant product and architecture documents.
2. Define acceptance criteria and affected paths.
3. Delegate only low/medium-risk tasks with explicit allowed paths and checks.
4. Review every worker diff.
5. Run formatting, lint, types, tests, security, accessibility, responsive, SEO, and build gates as applicable.
6. Before push or deployment, complete the Groq release gate, verify its findings with GPT-6 Luna, and require human approval. Require human approval before merge, publishing, signing, or destructive database operations as well.
7. Never share .env files, credentials, customer data, signing assets, payment code, or production configuration with Qwen. Inspect worker-visible context before delegation; keep sensitive work with Codex when exclusion cannot be enforced.

## Prohibited worker actions

- Production access, deployment, push, merge, signing, secret access, destructive database operations, or writes outside assigned paths.
- Remote Groq and Gemini reviewers may not use tools, edit files, access credentials, spawn agents, push, merge, deploy, publish, or sign.
- Disabling tests or security controls to obtain a passing result.
- Editing generated lockfiles unless dependency changes are part of the task.

## Product quality

- Web: semantic, accessible, responsive, SEO-ready, performant, reduced-motion compatible.
- Mobile: platform-appropriate UI, secure storage, safe areas, offline/error states, deep-link validation, staged release.
- API: validated inputs, server-side authorization, typed contracts, rate limits, auditability, backward-compatible changes.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
