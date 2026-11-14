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
| **Model** | The same model for both arms, set with `MIMO_MODEL` (`mimo-v2.6-pro` by default), or any OpenAI-compatible endpoint with `BENCH_BASE_URL`, `BENCH_MODEL` and `BENCH_API_KEY` |
| **Prompts** | The same, word for word |
| **Sandbox** | DSH's `workspace-write`: writes only inside the task's workspace and one shared build-cache directory; no approval is ever asked for. SWE-bench sessions are [sealed](#sealed-sessions) on top of that |
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

Another model endpoint (any that speaks the OpenAI chat-completions protocol) is named by three variables, which take the place of the `MIMO_*` ones; `BENCH_PROVIDER` optionally gives it a display name. The key is read from the environment by the harness and is never written to a file.

```bash
export BENCH_BASE_URL=https://api.example.com/v1 BENCH_MODEL=some-model BENCH_API_KEY=...
```

### SWE-bench Verified

```bash
node bench/lib/swebench.mjs repos                # optional: all 12 repositories' object stores ahead of the run
node bench/lib/swebench.mjs seal                 # what a session can and cannot do, tried in a session's sandbox
node bench/run.mjs swebench --arm dsh --run dsh-p1 --concurrency 4
node bench/run.mjs swebench --arm rsi --run rsi-p1 --concurrency 4
node bench/run.mjs swebench --arm rsi --run rsi-mini --subset mini     # the 50 instances of swe-bench-verified-mini
node bench/lib/swebench.mjs check dsh-p1         # every patch against a fresh checkout: git apply --check
node bench/lib/swebench.mjs audit dsh-p1         # every session log, for attempts to reach outside
```

Each of the [500 instances](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified) is one turn in a checkout of its repository at the commit the issue was reported against. The agent gets the issue text, one sentence asking it to resolve the issue in the source and not in the tests, and a note about the machine. It never gets the reference patch, the hints, the test patch or the names of the tests; those are in `~/.cache/dshrsi-bench/swebench/evaluation.jsonl`, which no session can read.

What the agent changed is collected as a unified diff against that commit (edits, deletions and new files; not what `.gitignore` names, and not virtual environments, caches or new files over 1 MB) and written to the result row and to `<run>/predictions.jsonl`, one `{instance_id, model_name_or_path, model_patch}` line per task. **Nothing is scored here.** SWE-bench's evaluation runs each project's tests in one container per instance and takes that file as it is.

#### Sealed sessions

The fix of every instance is public. In the first trials of this suite, 7 of 12 sessions went and got it (`audit smoke-dsh` lists the calls). A session of this suite therefore cannot leave its own directory, in either arm:

| | A session of this suite |
| :--- | :--- |
| **Network** | None. The `dsh` process reaches the model relay on loopback and nothing else. Its commands reach a package index on loopback and nothing else: not the relay, not another loopback port, no name lookup. The harness's web tools are switched off |
| **Packages** | The index ([`lib/pypi-index.mjs`](lib/pypi-index.mjs)) passes PyPI through and refuses the project under test, under every name it is published or bundled as (`scikit-learn` and `sklearn`; for `requests` also `pip`, which carries a copy). The names are in a signed prefix of the session's index URL, so a session cannot make itself a prefix that refuses less |
| **Files** | It reads the operating system, its checkout, its own temporary directory, and the interpreters it is given. Not the home directory, not another session's checkout or log, not Homebrew, not `/tmp`. This holds for its commands, and for the harness's own `read`, `glob` and `grep` with one addition: the `dsh` process has to read its own code, wherever that is installed (see [Known limits](#known-limits)) |
| **Git** | A checkout is a repository of its own: one pack with the history up to its commit and the files of that commit. No remote, no objects borrowed from the shared store, nothing later than its commit. Asking for an older version of a file (`git log -p`, `git blame`, `git show <commit>`) ends at once with "unable to read": those were never downloaded |
| **Paths** | Everything it sees is under `/Users/Shared/dshrsi-bench` (`DSHRSI_BENCH_SEALED_ROOT`), in directories named by digests. The account's name, the instance id (which ends in the number of the pull request that fixed the issue) and the run's name are in no path, variable or command output |
| **Model key** | In no variable a command sees, and commands cannot look at other processes |
| **Environment** | Python 3.9 to 3.12 with pip, and `uv`; no other package. The prompt says so, and says what is closed, in the same words in both arms (`environmentNote` in [`lib/swebench.mjs`](lib/swebench.mjs)) |
| **State** | Checkout, virtual environments, package caches and temporary files belong to one session and are removed with it. Nothing an arm installs is there for the other, or for the next session of the same arm. A session may hold 3 GB (`BENCH_SESSION_GB`) |

It is enforced by macOS's sandbox, in two layers ([`lib/sealed.mjs`](lib/sealed.mjs)). The `dsh` process starts inside one profile; that covers its tools and whatever a plugin does in the process. Each command the session runs is started by a broker in the runner under a second, stricter profile: sandbox profiles cannot be nested, so the harness's sandbox runner is a small client that hands the command over. `node bench/lib/swebench.mjs seal [instance id]` tries all of the above in a session made the way the runner makes it, and with a model key set also runs one real turn.

`node bench/lib/swebench.mjs audit <run>` reads every session log of a run and lists, per instance, each call that reached or tried to reach outside: URLs, network commands, git remotes, the project under test from the index (also from the index's own log), paths under a home directory, searches of the disk, requests for history the checkout does not hold. Each entry says how the call ended: `refused` when the sandbox, git or the index said no, otherwise the call's own exit status. It reads what the agent asked for and is broad on purpose; an entry is something to read, not a verdict.

The rest of the harness is the same in both arms and in the other suites. The four other suites are not sealed and run as they did when their numbers were made.

#### Endpoint, outages and disk

The model endpoint has to be a loopback relay, because one loopback port is all a sealed `dsh` process may connect to. With a provider whose name the network resolves wrongly, that relay is [`lib/relay.mjs`](lib/relay.mjs); `--keep-alive` starts it again whenever it exits:

```bash
nohup node bench/lib/relay.mjs --keep-alive https://api.example.com 203.0.113.7,203.0.113.8 8791 > ~/.cache/dshrsi-bench/logs/relay.log 2>&1 &
export BENCH_BASE_URL=http://127.0.0.1:8791/v1 BENCH_MODEL=some-model BENCH_API_KEY=...
```

When the endpoint stops answering, the run waits and asks it for one token, at most once a minute, until it answers again. Tasks whose sessions were cut short start over from a fresh checkout and lose no attempt. The package index is started by the first run that needs it and keeps running (`pkill -f bench/lib/pypi-index.mjs` stops it); it keeps at most 1 GB of downloaded files (`BENCH_INDEX_CACHE_GB`).

A run's results are in `/Users/Shared/dshrsi-bench/runs/swebench/<run>/`; its sessions work in `/Users/Shared/dshrsi-bench/w/<digest>/`, which is empty when the run is not running. No new checkout is started while less than 4.5 GB is free on the disk, and a session's commands are refused under 3 GB (`BENCH_MIN_FREE_GB`); a task that happened to is not an answer and runs again when the run is resumed. A session with a virtual environment holds 0.2 to 1 GB, so the concurrency of the two arms together should stay under the free space in GB minus 4.

A run is resumable: finished tasks are skipped. A session the provider refuses (no balance, no valid key, too many requests) is not an answer; after eight refusals in a row the run stops, and `node bench/void.mjs <benchmark> <run>` takes back tasks that were recorded before that rule existed.

Everything a run produces is under `~/.cache/dshrsi-bench/runs/<benchmark>/<run>/` (`DSHRSI_BENCH_HOME` moves it; SWE-bench runs are under `/Users/Shared/dshrsi-bench/runs/` instead): the harness home with every session log, the workspaces, `results.jsonl`, and for the `rsi` arm the adaptation library with its ledger and audit log.

## Known limits

- **One run per configuration.** No second sample of the same configuration exists yet, so the run-to-run spread is not measured; the paired tests are the guard against reading noise as an effect.
- **LiveCodeBench is partial and the second pass is missing**, as described above.
- **One machine** (macOS, Apple silicon, 16 GB) **and one model family.**
- **The four suites above are not sealed.** Their sandbox confines writes, not downloads or reads: a session can use the network, read every file of the user, and write into one build-cache directory all sessions share. An agent that lacks a dependency searches the disk for it, the home directory included, and uses what it finds. For tasks whose answer is not public this decides little; for SWE-bench it decided everything, which is why those sessions are [sealed](#sealed-sessions).
- **What the seal of SWE-bench sessions leaves open.** A package on PyPI that carries a copy of a project under another name than the ones refused is served; the audit lists every project a session asked the index for. The `dsh` process reads its own code, which is installed in this repository and so under a home directory: its file tools could read that code, the plugin's, and the harness home of their run (not other sessions' logs) if a session knew those paths. No session is shown them and none can list the directories above them; a call that names any path under `/Users` outside the session is in the audit, as `home-directory` or `outside-session`. The plugin's adaptations run inside the `dsh` process, so they are held by that process's profile and not by the stricter one of commands. The seal is macOS's sandbox; it has not been tried on another system.
- **SWE-bench sessions do not get the benchmark's own environments.** Each instance's container has the interpreter and the dependencies its project needed at the time. Here a session gets Python 3.9 to 3.12 and an index, and builds what it can; old projects do not install on these interpreters without effort, and a server on a loopback port cannot be started. Patches are still scored by SWE-bench's evaluation in its containers.
- **Toolchain versions are the current Homebrew ones**, not those of the benchmarks' own containers. Every Polyglot reference solution passes with them.
- **SWE-bench has not been run in full, and nothing here scores it.** Three instances were run in both arms to try the seal. Terminal-Bench, which needs a container per task, was not run: the machine does not have the disk for the images.
