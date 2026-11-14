# Benchmarks

Stock DeepSeek Harness against DeepSeek Harness with the `dsh-rsi` plugin, on four public benchmarks, in real `dsh` sessions on two models.

- [Results](#results)
- [What is compared](#what-is-compared)
- [The four benchmarks](#the-four-benchmarks)
- [Running it](#running-it)
- [Known limits](#known-limits)

Every number here comes from [`results/`](results), which `node bench/report.mjs --write` rewrites from the stored session logs.

## Results

Measured on 2026-11-13. One pass per configuration; the plugin starts every suite with an empty library.

### Tasks solved

| Benchmark | Tasks | `mimo-v2.6-pro` stock | `mimo-v2.6-pro` + DSHRSI | p | `mimo-v2.6-flash` stock | `mimo-v2.6-flash` + DSHRSI | p |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Aider Polyglot, first try | 225 | 224 | 224 | 1.00 | 220 | 223 | 0.38 |
| Aider Polyglot, within two tries | 225 | 225 | 225 | 1.00 | 225 | 225 | 1.00 |
| HumanEval | 164 | 163 | 162 | 1.00 | 162 | 162 | 1.00 |
| HumanEval+ | 164 | 156 | 157 | 1.00 | 153 | 153 | 1.00 |
| MBPP | 378 | 374 | 371 | 0.38 | 368 | 369 | 1.00 |
| MBPP+ | 378 | 320 | 319 | 1.00 | 308 | 315 | 0.17 |
| LiveCodeBench v6 (cut short) | 105 / 51 of 175 | 94 | 96 | 0.63 | 42 | 42 | 1.00 |

p is an exact two-sided McNemar test on the same tasks. No difference is distinguishable from chance.

**LiveCodeBench was cut short.** At 21:41 UTC the model account ran out of balance, and every session after that was refused by the API (`402 Insufficient account balance`). The tasks whose sessions were refused are not counted as answers (`node bench/void.mjs`); the row above is the tasks both arms had finished before that moment: 105 with `mimo-v2.6-pro`, 51 with `mimo-v2.6-flash`, in the fixed shuffled order they came in. A second pass (the same tasks again, on the library the first pass left behind) was queued and has not been run for the same reason. Both can be resumed: finished tasks are skipped.

### What the plugin did during the runs

Nothing was configured for the benchmarks and no adaptation was written by hand.

| Benchmark | Model | Adaptations written | Acted | Widened to the machine | Revisions | Promotions | Calls refused |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Aider Polyglot | `mimo-v2.6-pro` | 10 | 3 | 4 | 3 | 12 | 0 |
| Aider Polyglot | `mimo-v2.6-flash` | 15 | 3 | 3 | 1 | 3 | 3 |
| HumanEval+ | `mimo-v2.6-pro` | 4 | 1 | 1 | 4 | 9 | 0 |
| HumanEval+ | `mimo-v2.6-flash` | 7 | 1 | 2 | 2 | 4 | 0 |
| MBPP+ | `mimo-v2.6-pro` | 6 | 1 | 4 | 3 | 10 | 48 |
| MBPP+ | `mimo-v2.6-flash` | 7 | 2 | 4 | 2 | 6 | 0 |
| LiveCodeBench v6 | `mimo-v2.6-pro` | 3 | 2 | 2 | 1 | 5 | 0 |
| LiveCodeBench v6 | `mimo-v2.6-flash` | 4 | 2 | 1 | 0 | 3 | 0 |

56 adaptations in all, 54 written by the model and 2 by a built-in template; 15 of them acted at least once.

### Did those adaptations work

An adaptation starts out scoped to the workspace it was learned in, and every task is its own workspace. So only an adaptation that was widened to the whole machine can affect later tasks. Ten of those acted. For each one: the tasks that started after it took effect, counted by whether the failure it answers occurred, against the very same tasks under stock DSH. "Before" is the same count on the tasks that started earlier, when neither arm had it.

| Adaptation (title as the model wrote it) | Where | Failure it answers | Capabilities | Before: stock | Before: DSHRSI | After: stock | After: DSHRSI | p |
| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| *Stop inline python checks that abort on first mismatch* | MBPP+, `mimo-v2.6-pro` | `bash:test-failure:AssertionError` | deny, block, prompt | 2 / 68 | 5 / 68 | 16 / 310 | **3 / 310** | 0.002 |
| *Redirect missing lib.rs reads to a glob lookup* | Aider Polyglot, `mimo-v2.6-flash` | `read:fs_not_found:… "<path>/lib.rs"` | annotate, prompt | 5 / 74 | 4 / 74 | 7 / 151 | **1 / 151** | 0.07 |
| *Deny reruns of a failing invariant check* | LiveCodeBench v6, `mimo-v2.6-pro` | `bash:test-failure:AssertionError` | annotate, deny, prompt | 4 / 63 | 5 / 63 | 6 / 42 | 4 / 42 | 0.75 |
| *Recompute disputed values before editing solution.py* | HumanEval+, `mimo-v2.6-pro` | `bash:test-failure:AssertionError` | annotate, deny, prompt | 3 / 30 | 2 / 30 | 9 / 134 | 9 / 134 | 1.00 |
| *Guard Python test scripts against invalid-case crashes* | LiveCodeBench v6, `mimo-v2.6-pro` | `bash:other:Traceback …` | annotate, prompt | 6 / 88 | 6 / 88 | 1 / 17 | 1 / 17 | 1.00 |
| *Short-circuit repeated web_fetch timeouts* | MBPP+, `mimo-v2.6-flash` | `web_fetch:timeout:timed out` | annotate | 0 / 283 | 3 / 283 | 0 / 95 | 0 / 95 | 1.00 |
| *Verify expected values before trusting test assertions* | LiveCodeBench v6, `mimo-v2.6-flash` | `bash:test-failure:AssertionError` | annotate, prompt | 2 / 44 | 4 / 44 | 0 / 7 | 1 / 7 | 1.00 |
| *Refuse doctest/assert reruns until solution.py is edited* | HumanEval+, `mimo-v2.6-flash` | `bash:test-failure:AssertionError` | annotate, block, prompt | 4 / 99 | 6 / 99 | 1 / 65 | 3 / 65 | 0.63 |
| *Deny python runs after a solution.py traceback until solution.py is edited* | MBPP+, `mimo-v2.6-flash` | `bash:other:Traceback …` | deny, annotate, prompt | 0 / 105 | 4 / 105 | 3 / 273 | 5 / 273 | 0.73 |
| *Re-read before retrying a failed edit* | Aider Polyglot, `mimo-v2.6-flash` | `edit:edit-mismatch:old_string was not found` | annotate, deny | 2 / 225 | 3 / 225 | – | – | – |

The second row is followed step by step, from the first event of the session it was written in, in [`results/trace.json`](results/trace.json) and on the website's trace page (`website/trace.html`). On the 30 Rust exercises of that run, 12 sessions of the stock arm read a `lib.rs` that is not there, from the first session to the last; in the plugin's arm 5 did, and 1 of the 22 that started after the adaptation applied to the whole machine (7 of the same 22 in the stock arm).

Two cut the failure they were written for. Seven changed nothing that can be measured, and one took effect after the last task had started. Neither of the two made more tasks pass: the first one refused 48 calls along the way, and MBPP with `mimo-v2.6-pro` ended at 371 against 374.

### Cost per task

Failed tool calls are counted from the session logs by the same code for both arms and split by cause: the work not being right yet (a failed test, a compile error), a cause the classifier names (a missing command, a path that is not there, an edit that did not apply), and any other non-zero exit. A call the plugin refuses counts as a failed call.

| Benchmark | Model | Arm | Tasks | Tool calls | Failed per 100 tasks: tests, compiler | named cause | other | Model steps | Agent minutes | Tokens in (k) | Tokens out (k) |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Aider Polyglot | `mimo-v2.6-pro` | stock | 225 | 11.5 | 4.0 | 1.3 | 10.7 | 9.2 | 3.0 | 160 | 9.3 |
| Aider Polyglot | `mimo-v2.6-pro` | + DSHRSI | 225 | 11.7 | 6.7 | 3.6 | 16.4 | 9.3 | 3.3 | 173 | 9.8 |
| Aider Polyglot | `mimo-v2.6-flash` | stock | 225 | 12.4 | 11.1 | 21.3 | 10.7 | 10.1 | 4.5 | 190 | 8.8 |
| Aider Polyglot | `mimo-v2.6-flash` | + DSHRSI | 225 | 12.5 | 7.1 | 12.9 | 14.7 | 10.2 | 4.7 | 197 | 8.9 |
| HumanEval+ | `mimo-v2.6-pro` | stock | 164 | 6.4 | 12.8 | 5.5 | 5.5 | 6.6 | 1.0 | 55 | 2.5 |
| HumanEval+ | `mimo-v2.6-pro` | + DSHRSI | 164 | 6.6 | 12.2 | 4.3 | 4.9 | 6.5 | 1.1 | 55 | 3.4 |
| HumanEval+ | `mimo-v2.6-flash` | stock | 164 | 3.8 | 6.7 | 9.8 | 4.3 | 4.7 | 0.7 | 34 | 1.3 |
| HumanEval+ | `mimo-v2.6-flash` | + DSHRSI | 164 | 3.8 | 9.8 | 6.1 | 2.4 | 4.7 | 0.9 | 37 | 1.4 |
| MBPP+ | `mimo-v2.6-pro` | stock | 378 | 4.5 | 5.6 | 2.1 | 1.1 | 5.1 | 0.7 | 42 | 1.9 |
| MBPP+ | `mimo-v2.6-pro` | + DSHRSI | 378 | 4.9 | 3.4 | 1.6 | 13.0 | 5.5 | 0.8 | 47 | 1.9 |
| MBPP+ | `mimo-v2.6-flash` | stock | 378 | 3.7 | 11.6 | 1.6 | 1.1 | 4.6 | 0.8 | 33 | 1.1 |
| MBPP+ | `mimo-v2.6-flash` | + DSHRSI | 378 | 4.0 | 10.8 | 4.2 | 3.2 | 4.8 | 0.9 | 42 | 1.3 |
| LiveCodeBench v6 | `mimo-v2.6-pro` | stock | 105 | 8.1 | 15.2 | 3.8 | 10.5 | 7.9 | 5.9 | 185 | 14.9 |
| LiveCodeBench v6 | `mimo-v2.6-pro` | + DSHRSI | 111 | 8.4 | 13.5 | 5.4 | 9.0 | 8.0 | 6.1 | 186 | 14.8 |
| LiveCodeBench v6 | `mimo-v2.6-flash` | stock | 54 | 6.8 | 9.3 | 7.4 | 9.3 | 6.7 | 7.3 | 112 | 9.2 |
| LiveCodeBench v6 | `mimo-v2.6-flash` | + DSHRSI | 52 | 6.8 | 21.2 | 7.7 | 5.8 | 6.6 | 7.7 | 118 | 8.1 |

Over the three suites that ran to the end, the plugin arm took 9.3% more agent time and 8.4% more input tokens with `mimo-v2.6-pro`, and 7.8% and 8.8% more with `mimo-v2.6-flash`. The requests that write adaptations are not in the session logs and so not in the token columns; the time they take is in the agent minutes.

## What is compared

| | |
| :--- | :--- |
| **Stock** (`--arm dsh`) | `@deepseek-ai/dsh` 0.2.2-rc.3, `headless` profile |
| **With the plugin** (`--arm rsi`) | The same, plus `dsh-rsi` at its default settings |
| **Model** | The same model for both arms, set with `MIMO_MODEL` (`mimo-v2.6-pro` by default) |
| **Prompts** | The same, word for word |
| **Sandbox** | DSH's `workspace-write`: writes only inside the task's workspace and one shared build-cache directory; no approval is ever asked for |
| **Toolchains, task order** | The same; the order is a fixed shuffle (seed `20261113`) |

All sessions of one run share one harness home. In the `rsi` arm this means that what one session learns is there for every session that starts after it. Sessions of a run overlap (8 to 12 at a time), so a session only benefits from what was learned before it started.

A second pass (`--library-from <first run>`) starts with the library the first pass ended with and visits the same workspaces again.

## The four benchmarks

| Benchmark | Tasks | What the agent gets | Scored by |
| :--- | ---: | :--- | :--- |
| [Aider Polyglot](https://github.com/Aider-AI/polyglot-benchmark) | 225 | An Exercism exercise in C++, Go, Java, JavaScript, Python or Rust, with Aider's prompts. If the tests fail, one more turn in the same session with the test output, as in Aider's protocol | The exercise's own tests, restored from the benchmark after the agent finished |
| [HumanEval / HumanEval+](https://github.com/evalplus/evalplus) | 164 | A function stub with its docstring in `solution.py` | EvalPlus 0.3.1: the original tests, and EvalPlus's extended tests |
| [MBPP / MBPP+](https://github.com/evalplus/evalplus) | 378 | A one-sentence description and one example assertion in `solution.py` | EvalPlus 0.3.1, as above |
| [LiveCodeBench](https://github.com/LiveCodeBench/LiveCodeBench) v6 | 175 | The problem statement in `problem.md`, and the starter code where the problem has one | LiveCodeBench's own evaluator on the public and hidden tests, 6 s per test |

Tests are never placed in the workspace, except for Polyglot, whose protocol gives the agent the test file. Reference solutions and `.meta` folders are removed from Polyglot workspaces.

These are agentic runs: the agent can read, edit and run code for as long as it wants within a 30-minute turn. The numbers are therefore not comparable with leaderboard numbers of the same benchmarks, which give a model one shot (or, for Polyglot, two edits without running anything).

## Running it

```bash
bench/setup.sh                                   # toolchains, datasets, scoring code (macOS, Homebrew)
node bench/run.mjs polyglot --validate           # the reference solutions through the scoring commands: 225 / 225

export MIMO_API_KEY=...
node bench/run.mjs polyglot --arm dsh --run dsh-p1 --concurrency 12
node bench/run.mjs polyglot --arm rsi --run rsi-p1 --concurrency 12
node bench/run.mjs polyglot --arm rsi --run rsi-p2 --concurrency 12 --library-from rsi-p1

MIMO_MODEL=mimo-v2.6-flash node bench/run.mjs humaneval --arm rsi --run flash-rsi-p1

node bench/report.mjs --write                    # tables, bench/results/*.json, and the website's data file
node bench/readme-fill.mjs                       # the numbers in the README tables, in every language
node bench/trace.mjs --write                     # one adaptation's story out of the raw logs: results/trace.json
node scripts/hero/render.mjs                     # the README's animation and picture, drawn from that data
```

A run is resumable: finished tasks are skipped. A session the provider refuses (no balance, no valid key, too many requests) is not an answer; after eight refusals in a row the run stops, and `node bench/void.mjs <benchmark> <run>` takes back tasks that were recorded before that rule existed.

Everything a run produces is under `~/.cache/dshrsi-bench/runs/<benchmark>/<run>/` (`DSHRSI_BENCH_HOME` moves it): the harness home with every session log, the workspaces, `results.jsonl`, and for the `rsi` arm the adaptation library with its ledger and audit log.

## Known limits

- **One run per configuration.** No second sample of the same configuration exists yet, so the run-to-run spread is not measured; the paired tests are the guard against reading noise as an effect.
- **LiveCodeBench is partial and the second pass is missing**, as described above.
- **One machine** (macOS, Apple silicon, 16 GB) **and one model family.**
- **Sessions are not cut off from the network.** The sandbox confines writes, not downloads.
- **The shared build-cache directory is writable by every session**, and some sessions use it as scratch space.
- **Toolchain versions are the current Homebrew ones**, not those of the benchmarks' own containers. Every Polyglot reference solution passes with them.
- **Benchmarks that need a container per task (SWE-bench, Terminal-Bench) were not run:** the machine does not have the disk for their images. Their tasks work repeatedly inside one large repository or one environment, which is where a harness that learns its surroundings is most likely to differ.
