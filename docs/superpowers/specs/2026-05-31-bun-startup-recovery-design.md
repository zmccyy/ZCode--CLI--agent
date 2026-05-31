# Bun Startup Recovery Design

## Document Type

Explanation / design spec for restoring the Bun-backed full CLI startup path.

## Audience

- Maintainers working on the Bun REPL / TUI startup chain
- Future planners who need an implementation-ready view of the T2.2 fix scope

## Goal

Restore the Bun full startup path so that:

- `bun src/entrypoints/cli.tsx --help` starts successfully
- `bun src/entrypoints/cli.tsx --bare -p "hello"` reaches runtime validation or request execution instead of failing during module evaluation

The document defines the minimum safe changes required to get Bun startup running again without reopening the earlier Node.js compatibility work.

## Scope

Included:

- Diagnose the current Bun startup blocker in the latest repo state
- Define the minimal adapter change for `color-diff`
- Define the startup dependency slimming change in `setup.ts`
- Define the validation sequence and acceptance criteria for Bun recovery

Excluded:

- Reworking the Node.js public CLI surface
- Bulk conversion of `require()` usage to dynamic `import()`
- A full redesign of the command registry
- Large-scale REPL interaction testing

## Context

The repo now has two distinct entrypoint surfaces:

- `ZCode/src/entrypoints/publicCli.js` is the stable Node.js public CLI
- `ZCode/src/entrypoints/cli.tsx` is the Bun-backed full REPL / TUI chain

This is the correct runtime boundary. T2.2 is no longer about forcing Node.js to run the full REPL path. It is about getting the Bun full startup chain back to a runnable state.

The earlier diagnosis recorded in `docs/T2.2-repl-startup-hang-analysis.md` identified `await import('./setup.js')` in `main.tsx` as the observed hang point at that time. After the repo was synced forward, the latest code now fails earlier in module evaluation, so that diagnosis is no longer the active top-level blocker.

## Current Diagnosis

### Active blocker in the latest code

The first confirmed Bun startup failure is:

- `Cannot find package 'color-diff-napi'`

The failure occurs before `setup()` runs. The confirmed import surface is:

- `src/setup.ts`
- static import of `./commands.js`
- `commands.js` evaluates a command/UI graph during module load
- that reachable graph includes `components/ThemePicker.tsx` as a confirmed consumer of syntax-highlighted diff rendering
- `ThemePicker.tsx` imports `components/StructuredDiff/colorDiff.ts`
- `colorDiff.ts` hard-imports `color-diff-napi`

The repo does not currently contain an installed `color-diff-napi` package, but it does already contain a local TypeScript implementation at:

- `ZCode/src/native-ts/color-diff/index.ts`

### Structural startup risk that remains after the first blocker

`ZCode/src/setup.ts` currently has a top-level static import of:

- `import { getCommands } from './commands.js'`

Even though `getCommands()` is only needed later for background prefetch, this top-level import pulls the command graph into module evaluation immediately. That means a non-core UI or display dependency can still break startup before `setup()` executes any meaningful logic.

This is the structural issue behind the earlier "hang around setup import" diagnosis: `setup.ts` is acting as a gateway to a much wider dependency graph than the startup path actually needs.

## Approaches Considered

### Approach 1: Fix only `color-diff`

Change `components/StructuredDiff/colorDiff.ts` so that it no longer hard-requires `color-diff-napi` at module evaluation time, and falls back to the local TypeScript implementation.

Pros:

- Smallest possible change
- Removes the currently confirmed Bun startup blocker quickly

Cons:

- Does not reduce startup dependency breadth
- Likely exposes the next import-time blocker immediately afterward

### Approach 2: Slim the startup dependency graph first

Move `setup.ts` away from top-level command graph imports before addressing `color-diff`.

Pros:

- Directly addresses the structural startup issue
- Reduces the chance that non-core UI code breaks startup

Cons:

- Does not by itself solve the already confirmed `color-diff-napi` failure
- Still leaves the current Bun startup path broken until the adapter problem is fixed

### Approach 3: Combined recovery plan

First, make `color-diff` optional at startup. Then slim `setup.ts` so startup no longer evaluates the full command/UI graph unless needed. After that, re-run Bun smoke validation and continue moving any newly exposed non-core blockers behind later boundaries.

Pros:

- Removes the immediate blocker
- Also addresses the structural cause of similar failures
- Avoids a large refactor while still improving startup resilience

Cons:

- Requires two targeted changes instead of one

## Recommendation

Use Approach 3.

This best matches the goal of "Bun startup truly runs again" rather than "this one missing package no longer crashes first." It also preserves the current runtime split:

- Node.js remains responsible for the public CLI
- Bun remains responsible for the full REPL / TUI path

## Proposed Design

### 1. Make `color-diff` an optional startup dependency

Target file:

- `ZCode/src/components/StructuredDiff/colorDiff.ts`

#### Design intent

This file should remain the single adapter layer for syntax-highlighted diff rendering. Callers should not know or care whether rendering is backed by the native package or the local TypeScript implementation.

#### Required behavior

- Keep the exported surface stable:
  - `getColorModuleUnavailableReason()`
  - `expectColorDiff()`
  - `expectColorFile()`
  - `getSyntaxTheme()`
- Preserve the existing environment gate:
  - if `CLAUDE_CODE_SYNTAX_HIGHLIGHT` is explicitly disabled, treat the color module as unavailable
- Resolve the rendering backend lazily instead of at module evaluation time
- Prefer the native package when available
- Fall back automatically to `ZCode/src/native-ts/color-diff/index.ts` when the native package is missing or cannot be loaded
- If both backends fail unexpectedly, return `null` or use the existing fallback-oriented behavior instead of throwing during startup

#### Boundary rule

Syntax highlighting is a display capability, not a startup-critical capability. Missing optional rendering support must never block Bun CLI startup.

### 2. Remove the top-level command graph dependency from `setup.ts`

Target file:

- `ZCode/src/setup.ts`

#### Design intent

`setup.ts` should evaluate only startup-critical dependencies at import time. Background command prefetch must not force command/UI module evaluation before the setup function is even entered.

#### Required behavior

- Remove the top-level static import of `getCommands`
- Keep the current background prefetch behavior in place
- Load `commands.js` only inside the branch that actually performs prefetch
- Preserve current semantics for:
  - `--bare`
  - plugin prefetch gating
  - non-blocking background work

#### Boundary rule

If a dependency is only needed for background prefetch, it must not be part of `setup.ts` module evaluation.

### 3. Recover Bun startup iteratively from the outside in

After the first two changes, validation must re-run against the real Bun entrypoint. If a new blocker appears, handle it using the same rule set:

- identify the exact import-time failure
- classify whether it is core startup logic or optional display/interaction logic
- if optional, move it behind a later boundary or make it degradable
- avoid broad refactors unless a newly exposed blocker proves the narrower boundary is insufficient

This keeps the recovery plan focused on real startup blockers rather than speculative cleanup.

## Acceptance Criteria

### Startup acceptance

The following commands must succeed in the sense that they start and reach command handling rather than crashing during module evaluation:

- `bun src/entrypoints/cli.tsx --help`
- `bun src/entrypoints/cli.tsx --bare -p "hello"`

### Runtime acceptance

For `--bare -p "hello"`:

- if provider configuration is missing, the command may fail with an explicit provider/configuration error
- if provider configuration is present, the command must advance into the real print-mode runtime instead of failing in startup imports

### Structural acceptance

- `color-diff-napi` absence does not crash Bun startup
- `setup.ts` no longer pulls `commands.ts` into module evaluation via a top-level static import

## Validation Plan

Run validation in this order:

1. Import-level check for `colorDiff.ts`
   - verify Bun can evaluate the module without `color-diff-napi` installed
2. Import-level check for `setup.ts`
   - verify Bun can evaluate `setup.ts` without immediately failing through the command/UI graph
3. Entrypoint smoke check
   - `bun src/entrypoints/cli.tsx --help`
4. Non-interactive Bun print check
   - `bun src/entrypoints/cli.tsx --bare -p "hello"`
5. If a new blocker appears
   - trace the new import path
   - classify it as startup-critical or optional
   - apply the same boundary rule before widening scope

## Testing Strategy

### Regression test

Add a focused test that covers the `colorDiff` adapter behavior when the native package is unavailable. The purpose is to lock in "no import-time crash" rather than to exhaustively validate syntax highlighting output.

### Bun smoke test

Add or document a Bun smoke test for the full entrypoint. The assertion target is:

- startup does not fail during module evaluation because an optional display dependency is missing

Heavy interactive REPL coverage is not required for this change set.

## Risks and Mitigations

### Risk: fallback behavior hides a real rendering bug

Mitigation:

- keep the adapter boundary narrow
- log or preserve enough failure signal for debugging
- only degrade optional rendering paths, not core command logic

### Risk: additional import-time blockers appear after `color-diff`

Mitigation:

- treat this as expected for the recovery sequence
- validate incrementally after each change
- only widen the refactor if repeated blockers show a common structural cause

### Risk: `setup.ts` behavior changes unintentionally when moving `getCommands`

Mitigation:

- keep the prefetch branch behavior identical
- move only the import boundary, not the control flow
- verify `--bare` and non-bare smoke behavior after the change

## Non-Goals Reconfirmed

This design does not attempt to:

- restore full Node.js REPL compatibility
- remove all `require()` usage
- redesign command registration
- promise complete Bun parity for every optional UI feature in one patch

## Implementation Readiness

This spec is ready for implementation planning. The required changes are localized, their boundaries are explicit, and the validation sequence is defined.
