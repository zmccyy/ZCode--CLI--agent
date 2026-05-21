# ZCode Phase 2 Regression Matrix

This matrix defines the fixed Phase 2 core scenarios for Windows parity work.
Each scenario carries a runtime track label:

- `common`: applies to both mainline tracks
- `anthropic`: required on the Anthropic mainline
- `openai-compatible`: required on the independent OpenAI-compatible track

| ID | Track | Scenario | Current automation target | Status |
| --- | --- | --- | --- | --- |
| S01 | common | Start a new local session from the public entry surface | `ZCode/test/publicCli.test.js` + `ZCode/test/phase2FirstWaveHarness.test.js` | present |
| S02 | common | Resume the most relevant recent session | `ZCode/test/phase2FirstWaveHarness.test.js` | present |
| S03 | common | Read and search workspace files | planned regression harness | planned |
| S04 | common | Edit and persist workspace files | planned regression harness | planned |
| S05 | common | Execute shell and PowerShell commands | `ZCode/test/phase2FirstWaveHarness.test.js` | present |
| S06 | common | Enter plan mode and inspect the current plan | `ZCode/test/phase2FirstWaveHarness.test.js` | present |
| S07 | common | Run subagent or teammate delegation on the main task loop | planned regression harness | planned |
| S08 | common | Load hooks and process hook-triggered outcomes | planned regression harness | planned |
| S09 | common | Discover, connect, and call MCP tools with failure recovery | planned regression harness | planned |
| S10 | common | Read and write memory files | planned regression harness | planned |
| S11 | common | Surface permission prompt, deny, and allow flows | `ZCode/test/phase2FirstWaveHarness.test.js` | present |
| S12 | common | Run doctor and update diagnostic flows | `ZCode/test/publicCli.test.js` | planned |

## First-wave implementation order

1. `S01` new session surface
2. `S02` resume surface
3. `S05` shell / PowerShell surface
4. `S06` plan mode surface
5. `S11` permission prompt surface
6. `S03` + `S04` file read/edit surface
7. `S10` memory surface

## Provider-specific regression track

The fixed `S01-S12` IDs map directly to the main development plan's
functional acceptance list. Provider-specific parity checks run alongside
that matrix and do not replace any core scenario ID.

| Track | Scenario | Current automation target | Status |
| --- | --- | --- | --- |
| `anthropic` | Complete the default Anthropic-backed coding loop on the mainline runtime | planned provider regression | planned |
| `openai-compatible` | Complete the supported OpenAI-compatible print/runtime loop | `ZCode/test/publicCli.test.js` | present |

## Non-goals for this wave

- Provider/model system unification
- Full interactive TUI end-to-end coverage
- Windows installer / release packaging work
