# Guidelines for contributors and AI agents

This file states the rules for working in this repository. The automated code review
(`.github/workflows/claude-code-review.yml`) checks pull requests against it.

## What this repository is

A headless filter builder library. It holds the filter format, the rules that decide whether a
row matches a filter, and (later) the builder UI. It replaces DataTables SearchBuilder and keeps
SearchBuilder's JSON shape and matching rules.

| Package                  | Holds                                                                  |
| ------------------------ | ---------------------------------------------------------------------- |
| `@arvilmena/filter-core` | Filter types, matching rules, transforms and the plain-English summary |
| `…/filter-core/schema`   | Validation with Effect Schema. The only entry point that loads Effect. |

## Tools

- **Node.js 26 or later, and pnpm.** Do not add Bun, npm or yarn commands, lockfiles or APIs.
- **TypeScript 7,** built with tsdown.
- **Effect 4.** Its APIs differ from Effect 3. Check `node_modules/effect/dist/*.d.ts` before
  using an API from memory.
- **Vitest** with `@effect/vitest` for tests.
- **Biome** for linting and formatting.
- **`jq`** for the tests of the review workflow's script (`.github/scripts`).

Run `pnpm verify` before you push. It runs the linter, type checks, tests and build. It also
checks that the main entry imports no packages, and runs the tests for the CI scripts.

## Matching rules

`packages/filter-core/src/evaluate.ts` reproduces how SearchBuilder matches a row. Four rules
matter most:

1. Every value compares as text, so a blank number counts as 0.
2. A condition that is not filled in is skipped, not failed.
3. "Equals" on text is case-sensitive, and the other text conditions are not.
4. "Between" accepts its two bounds in either order.

**Do not change these rules or the filter's JSON shape as a side effect.** A change makes saved
filters return different rows. Make such a change only as a deliberate decision, stated in the
pull request, with tests.

Stored filters are read loosely. A slot that holds something broken is skipped, and must never
crash the evaluator.

Two test files guard these rules. Keep both passing, and extend them when you add a rule:

- `searchbuilder-parity.test.ts` runs the real SearchBuilder beside this library on thousands of
  generated filters and rows, and fails on any difference. SearchBuilder is a development
  dependency for this purpose only.
  One rule is outside its reach: whether a condition counts as filled in. SearchBuilder decides
  that from its input boxes on screen, so the test takes the answer from this library. Guard
  that rule with tests of `isConditionFilled`.
- `searchbuilder-upstream.test.ts` holds SearchBuilder's own matching tests, ported with their
  sample data.

Where this library goes beyond SearchBuilder, say so in a comment at that spot. Today that is one
place: "on or before" and "on or after" for dates.

## Where Effect is used

- **Use Effect Schema for validation,** and typed errors (`Data.TaggedError`) for failures a
  caller is expected to handle.
- **Only `schema.ts` and its tests may import `effect`.** The main entry must import no packages,
  so that browser bundles never load the Effect runtime. `pnpm verify` enforces this.
- **Keep the evaluator plain, synchronous code.** It runs for every row on every keystroke,
  cannot fail and does no input or output. An Effect per row would add cost for no gain.
- **Validate where filters enter,** such as pasted JSON or API input. Do not validate inside the
  evaluator.

## Keep the library generic

- An app passes in its own field list and a function that reads a row's value. The library never
  knows an app's field names or business rules.
- `filter-core` has no table, UI framework or styling dependency.
- Do not name private projects, people or internal systems in code, comments, tests, docs or
  commit messages.

## Code style

- Prefer code that is easier to maintain over code that is easier to write.
- Comment non-obvious logic to say why. Keep comments short and free of jargon. When a technical
  term is unavoidable, explain it in plain English in brackets at its first use.
- Give every exported function and type a `/** */` JSDoc comment.
- Tests are behavioural contracts. Do not delete, skip or weaken a test to make a change pass.
- When you deviate from a rule for an obvious performance or security gain, say so in a one-line
  comment at that spot.

## Commits

- Write the subject line in the imperative mood, capitalised, at most 50 characters, with no
  full stop.
- Use the body to explain what changed and why.
- Do not credit AI tools as authors or co-authors.

## Licence

The repository is private and unlicensed for now. Every `package.json` has `"private": true` and
`"license": "UNLICENSED"`. Do not publish a package or add a licence file without the owner's
decision.
