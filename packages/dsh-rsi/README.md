<img src="icon.svg" width="56" height="56" alt="">

# dsh-rsi

**English** · [简体中文](README.zh.md)

`dsh-rsi` brings **RSI, Recursive Self-Improvement,** to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): a plugin bundle through which the harness improves itself from its own runs, and each improvement becomes the ground the next one is built on.

Once installed, the harness watches every run: where calls keep failing, where the user corrects the model, where a turn ends without any check being run. When it finds such a spot, it has the session's model **write a piece of harness code on the spot** (an _adaptation_), passes that code through a validation gate, and mounts it into the running session **before the turn is over**. Adaptations that work are kept in a library on the machine, and the next session starts with them.

That is the recursion: the improved harness runs the next session, observes it with what it already learned in place, and improves again. Adaptations that did not hold are rewritten stricter, the ones that hold are promoted, and one whose trouble turns up in a second workspace is widened to the whole machine. The longer it runs, the closer the harness fits this machine, this person and this project. Which commands the machine lacks, what the project's rules are, what you corrected: these become part of the harness instead of a prompt that is read again every time. Rules learned in a project can also be written into the repository, and travel with the code to everyone's machine.

It is an ordinary plugin and changes no line of DSH's source.

## One full pass

```
session events ──▶ 16 detectors ──▶ friction found
                                         │
           library, past sessions ──▶ decide: worth a change? now, or when the turn ends?
                                         │
   model writes an adaptation ──▶ validation gate ──▶ rejected: back to the model with the reasons
                                  static / load / replay /       └─ still rejected: built-in template
                                  regression / permission
                                         │
                                         ▼
             mounted into the running session, in effect before the next model request
                                         │
   kept: promoted if it works, quarantined if it throws, rewritten stricter if it did not hold
```

An example from a run against a real model (`mimo-v2.6-pro`; the machine has `python3` and no `python`; the task's README says `python stats.py`):

- Sessions 1 and 2: the model hits the problem once in each (`python: command not found`) and works around it. The harness records this and changes nothing.
- Session 3: it happens again. This is the third time, so the harness has the model write an adaptation, "Route python invocations to python3". It states in the prompt that the machine has no `python`, and refuses `python ...` before the tool call is executed. It passes validation on the first attempt and is mounted in that turn.
- Sessions 4, 5 and 6: the problem does not occur. In one of them the model still tries `python`, and the harness refuses the call before it runs.

In the control run without the plugin, 5 sessions out of 5 hit the problem.

The scenario was run three times, each with an empty library. Before the adaptation was written, 9 sessions out of 9 hit the problem. After it, 7 sessions had no failed call; in 3 of them the model still tried `python` and the harness refused the call before it ran. The sample is small: one model, one scenario. It shows that the loop works end to end and is not a statistical statement about success rates.

## Install

**In the desktop app or the Web UI**: in the sidebar, open **Plugins → Add plugin → Install a third-party plugin**, enter one of the sources below, select **Install**, then **Enable now**.

| Source | What to enter |
|---|---|
| Release package | `https://github.com/qybaihe/dshrsi/releases/download/v0.1.1/dsh-rsi-0.1.1.tgz` |
| Local tarball | Run `npm pack` in `packages/dsh-rsi` and enter the absolute path of the resulting `.tgz` |
| Local folder | The absolute path of `packages/dsh-rsi` |

The repository can also be added as a plugin source: turn on **Custom plugin indexes** under Experimental plugins, then enter `https://raw.githubusercontent.com/qybaihe/dshrsi/main/market/index.json` in **Discover → Add index source**.

**From the command line**. Each profile keeps its own plugins, so install into every profile you use. `dsh plugin add` runs `pnpm`, which has to be on `PATH`.

```sh
dsh plugin --profile web add <source>        # Web UI: dsh web
dsh plugin --profile headless add <source>   # no UI: dsh headless "task"
# Desktop app: quit the app completely, then use the dsh that the app's "Manage dsh Command…" menu item installs
dsh plugin --profile desktop add <source>
```

To load it for a single run without installing, use a patch. Loaded this way, the plugin has its host half only, without the UI:

```sh
dsh --profile headless --patch rsi.yml "run the tests"
```

```yaml
# rsi.yml
- insert:
    - id: dsh-rsi
      name: /path/to/packages/dsh-rsi/index.js
      config: {}
```

The adaptation library is stored in `$DSH_HOME/rsi` (`~/.dsh/rsi` when `DSH_HOME` is not set).

## User interface

The Web UI (the desktop app uses the same pages) shows the plugin in three places:

- The **RSI** badge at the right of the session header: how many adaptations are at work in this session.
- The **Harness adapted to you** pill under the composer: how many are at work, how many were learned in this session, how many calls were refused. Selecting it opens a list that says what each adaptation does. At the moment the harness improves itself, the badge and the pill light up and read "The harness just improved itself · <adaptation title>".
- The slash command **/rsi**: which adaptations are mounted in this session, which layer each belongs to, and what in the library is waiting for approval.

When no adaptation is at work, none of the three appears on the page. The UI reads only what is already in the session log (the harness's notices, refused tool results, the adaptation sections of the system prompt) and logs nothing of its own.

![The moment the harness improves itself](../../assets/ui-evolving.png)

## Detectors

Every detector reads normalized session events, so the same detectors run on a live session and on a session stored on disk (`dsh-rsi mine`).

| Detector | What it finds |
|---|---|
| `repeat-failing-call` | The same call fails again with the same arguments |
| `failure-signature` | The same cause of failure keeps coming back (missing command, missing dependency, network, permission, port in use, path not found, edit mismatch, invalid arguments, out of memory, and others) |
| `command-flailing` | The same kind of command fails several times in a row with varying arguments |
| `read-thrash` | The same unchanged file is read over and over |
| `edit-churn` | The same file is edited many times in one turn |
| `error-storm` | Most of the recent tool calls failed |
| `stall` | Failures in a row with no success in between |
| `timeout-recurrence` | The same kind of command keeps timing out and being moved to the background |
| `output-flood` | The same kind of command keeps producing oversized output |
| `approval-denied` / `denied-repeat` | The user keeps denying the same kind of action; a denied call is retried unchanged |
| `user-correction` | The user corrected the model, or interrupted and changed direction |
| `user-interrupt` | The user interrupted mid-turn (recorded only) |
| `premature-completion` | Code was changed and the turn is about to end without any check being run |
| `negative-feedback` | The user marked a reply as bad and wrote a reason |
| `model-instability` | Model requests keep failing, being retried, or hitting the output limit (recorded only) |
| `context-pressure` | The context was compacted in the middle of the task (recorded only) |

A _friction_ is identified by a signature that is stable across sessions, such as `bash:command-not-found:python`. A signature seen in earlier sessions lowers the threshold for acting on it. By default, two occurrences within one turn lead to a change; a signature seen once in each of the two previous sessions leads to a change at its first occurrence in the third.

## What an adaptation is

A piece of JavaScript that can reach the harness only through the object `h`:

```js
define({
  title: 'Route python invocations to python3',
  description: '...',
  capabilities: ['deny', 'prompt'],
  setup(h) {
    h.promptSection('On this machine there is no `python` executable; use `python3`.')
    h.beforeTool({ tool: 'bash', command: /(^|[;&|(]\s*)python(\s|$)/ },
      () => h.deny('`python` is not installed on this machine. Use `python3` instead.'))
  },
})
```

| Capability | What it does | Tier |
|---|---|---|
| `annotate` | Appends a note to a tool result | Automatic |
| `steer` | Adds a note before the next model request | Automatic |
| `deny` | Refuses a tool call and gives the reason | Automatic |
| `ask` | Requires the user's approval for a call | Automatic |
| `block` | Turns a tool result into an error that carries a correction | Automatic |
| `verify` | Keeps the turn from ending while a condition is not met | Automatic |
| `prompt` | Adds a standing section to the system prompt | Automatic |
| `rewrite` | Replaces the text of a tool result | Needs approval |
| `tool` | Registers a new tool for the model | Needs approval |
| `exec` | Runs a command through the harness's shell tool (under the same sandbox and approval rules) | Needs approval |

The automatic tier can only add information, refuse, or demand more work. **No capability can allow an action the harness would otherwise refuse**: an adaptation's `deny` or `ask` can only make the verdict of the other policies on the chain stricter. An adaptation that needs approval is stored as `proposed` and waits for `dsh-rsi approve <id>`; with `autonomy` set to `full` it does not wait.

## Layers and the project harness

Every adaptation belongs to one of three layers, decided by the friction it answers:

| Layer | What it holds | Examples | Initial scope |
|---|---|---|---|
| `machine` | Facts about this machine, and how the harness's own tools behave on it | No `python`; a port is taken; an internal host name does not resolve | The workspace where it was learned; widened to the whole machine when the friction is met in a second workspace |
| `user` | How this person wants to be treated | A reply marked as bad with the reason "too long" | The whole machine |
| `project` | The rules and habits of one repository | "This repository uses pnpm, always"; which check to run after a change | The workspace where it was learned |

The `layers` setting switches whole layers off. A layer that is off is neither mounted nor learned.

**The project layer can travel with the repository.** Run this once in the repository:

```sh
dsh-rsi project init     # creates <repository>/.dsh-rsi/
```

From then on, a project-layer adaptation learned in this repository is written to `.dsh-rsi/adaptations/<name>.js` once it has acted in later sessions without throwing (status `active`). One file is one adaptation: commit it and your colleagues have it after a pull; delete it and it is unplugged. You can also write a file by hand and put it there, in the `define({...})` format shown above.

```
.dsh-rsi/
  harness.json           format marker and project-level settings
  adaptations/
    remember-the-user-s-instruction-3f2a1c.js
    no-force-push.js     a hand-written one works the same way
```

Code in a repository does not run on your machine because it was cloned there. Each machine reads the files first and accepts them after that:

```sh
dsh-rsi project          # what the project harness of this repository holds, and what this machine has accepted
dsh-rsi trust            # accept the files as they are on disk now
```

What is accepted is the exact content of a file. When a file changes (a colleague updated a rule), this machine keeps running the version you accepted until you run `trust` again; after `untrust`, none of them runs. For a file that uses a capability of the "needs approval" tier, `trust` is the approval. Adaptations that were learned on your own machine and written into the repository are accepted on that machine automatically.

Only the adaptation's source and one line about the friction it answers are written into the repository. No session ids, no working directories, no tool output.

`settings` in `harness.json` are project-level settings. They apply only to sessions opened in this repository:

```json
{ "format": 1, "settings": { "mode": "propose", "disabledDetectors": ["read-thrash"], "signals": { "editChurn": 9 } } }
```

A project can only make the harness more conservative, never less: `mode` can only move toward `observe`, and settings such as `autonomy` are out of a project's reach. If a project sets one, its settings are ignored as a whole and a warning is given.

The `projectHarness` setting: `auto` (the default, as described above), `manual` (only `dsh-rsi project add <id>` writes into the repository), `off` (`.dsh-rsi/` is ignored entirely). The `projectTrust` setting: `ask` (the default, as described above), `always` (whatever the repository holds is run, but capabilities of the "needs approval" tier still need you to accept them explicitly).

**Packs.** The machine and user layers do not go into a repository, but they can be exported as one file and carried to another machine:

```sh
dsh-rsi export -o my-harness.rsi.json            # everything in use; --layer machine exports one layer
dsh-rsi import my-harness.rsi.json               # imported as proposals; approve each with dsh-rsi approve
dsh-rsi import my-harness.rsi.json --trust       # enabled directly
```

On import, every source goes through the static and load checks again. The capabilities a pack claims for itself are not used.

## The validation gate

An adaptation has to pass, in order:

1. **Static**: a length limit; no `require`, `import`, `process`, `eval`, network access, and the like.
2. **Load**: it compiles, calls `define()`, registers something, and uses every capability it declares.
3. **Replay**: the calls that triggered it are replayed to it, and it has to act on them.
4. **Regression**: the calls that succeeded in this session are replayed to it, and it must not refuse, block or rewrite any of them. It must not refuse commands that only inspect the environment either, such as `command -v X` or `which X`.
5. **Permission**: if it uses a capability of the "needs approval" tier, `autonomy` decides whether it is held back.

If it fails, the reasons go back to the model for a rewrite (twice at most by default). If that fails too, a built-in template is used.

Adaptation code runs in its own `node:vm` context. Between it and the host there is only a bridge that passes JSON strings, so it cannot reach host objects. Every call has a synchronous and an asynchronous timeout. A handler that throws never affects the tool call it is attached to, and an adaptation is quarantined after three such errors. If a source stored in the library has been edited to hold more permissions than it had when it passed validation, it is refused at mount time and quarantined.

This isolation guards against mistakes and casual misuse. **It is not a security boundary against malicious code.**

## Lifecycle

- A new adaptation is a `candidate`. Once it has acted in later sessions without throwing, it becomes `active`.
- When the same friction occurs twice after its adaptation was mounted, a **revision** is triggered: the model gets the current source together with the fact that it did not hold, and is asked for a version that does. The old version stays in `versions/` and can be restored with `rollback`.
- When the same friction is met in a second workspace, the adaptation's scope widens from the workspace to the whole machine; it is not learned a second time.
- What the user has run `disable` or `retire` on is not learned again.
- Every decision is recorded in `audit.jsonl`. Every friction, mount, action and error is recorded in `ledger.jsonl`.

## Command line

```
dsh-rsi status                  what was learned, and whether it helps
dsh-rsi show <id>               one adaptation: record, source, validation, counters
dsh-rsi approve <id>            let a proposed adaptation mount
dsh-rsi disable|enable <id>     switch an adaptation off or back on
dsh-rsi retire <id>             remove it for good (the cause is not re-learned)
dsh-rsi rollback <id>           restore the previous version of a revised adaptation
dsh-rsi scope <id> global|<dir> change where it applies
dsh-rsi log [-n 20]             decisions the system took
dsh-rsi mine <session.jsonl>    run the detectors over a stored session; --adapt proposes adaptations

dsh-rsi project [dir]           the project harness of a repository, and what this machine has accepted of it
dsh-rsi project init [dir]      start a project harness (<repository>/.dsh-rsi)
dsh-rsi project add <id>        write a learned adaptation into the project harness
dsh-rsi project remove <entry>  delete a file from the project harness
dsh-rsi trust | untrust [dir]   accept the project harness files, or withdraw that
dsh-rsi export [id...] [-o file] [--layer machine|user|project]
dsh-rsi import <file> [--scope global|<dir>] [--trust]
```

The command is installed with the plugin, in the profile's own `node_modules`: `$DSH_HOME/profiles/<profile>/node_modules/.bin/dsh-rsi`, which is `~/.dsh/profiles/web/node_modules/.bin/dsh-rsi` for the Web UI when `DSH_HOME` is not set. In a checkout of this repository, `npm run rsi -- <command>` runs the same file.

Inside a session, `/rsi` shows the part of this information that concerns the current session.

SECOND-HIT in `status` is the central metric: the share of sessions in which the friction still occurs, before and after the adaptation was mounted.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `mode` | `adapt` | `observe` records only; `propose` generates and waits for approval; `adapt` mounts directly |
| `autonomy` | `tighten` | `tighten`: adaptations that rewrite results, add tools or run commands need approval; `full`: none does |
| `generator` | `model-then-synth` | Who writes adaptations: `model`, `synth` (built-in templates), or the model first with templates as the fallback |
| `maxRepairs` | `2` | How many rewrites after a rejection by the validation gate |
| `generatorTimeoutMs` | `120000` | Time limit of one generation request |
| `provider` / `model` | The session's current model | Write adaptations with another model (set both together) |
| `scope` | `workspace` | Whether a new adaptation first applies to the current workspace or to the whole machine (the `user` layer always applies to the whole machine) |
| `layers` | All three | Which layers are on: `machine`, `user`, `project` |
| `projectHarness` | `auto` | Whether project-layer adaptations are written to `<repository>/.dsh-rsi` automatically: `auto`, `manual`, `off` |
| `projectTrust` | `ask` | Whether adaptation files in a repository run only after `dsh-rsi trust` (`ask`) or directly (`always`) |
| `announce` | `true` | Whether the model is told after the harness changed itself |
| `signals` | See `src/signals.js` | Thresholds of the detectors |
| `disabledDetectors` | `[]` | Detectors to switch off |
| `policy` | See `src/trigger.js` | Trigger thresholds, per-session limits, revision conditions, and the like |
| `home` | `$DSH_HOME/rsi` | Where the adaptation library is stored |

With a wrong configuration (an unknown threshold name, a detector that does not exist, an invalid `mode`), the plugin refuses to load and reports the reason at startup. The harness itself runs as usual.

## What the model sees

Without friction and without mounted adaptations, the plugin is invisible to the model: system prompt, tool list and messages are unchanged byte for byte. An end-to-end test guards this.

With adaptations, the model may see notes that begin with `[harness adaptation: <title>]` (written into the session log as messages marked with the source `dsh-rsi`), the reasons of refused tool calls, additional standing sections in the system prompt, and new tools. The model request that writes an adaptation does not enter the session log. It is recorded in the audit records of the adaptation library.

## Known limits

- A new **tool** becomes visible only at the next model request (DSH assembles the tool list of a request before the step boundary), and the notice about it is delayed until then. Notes, refusals, blocks and standing prompt sections take effect in the same step.
- Writing an adaptation waits for one full model response. Measured on `mimo-v2.6-pro`, that is 30–60 seconds during which the step stands still. Under concurrent load, one request timed out and the built-in template took over.
- The detectors are heuristics. Whether something was verified is judged by whether a program was run after the change, so `npm install` counts as verification too.
- `negative-feedback`, `approval-denied`, `context-pressure` and `model-instability` were tested with constructed events only and have not been triggered in a real session.
- The automated end-to-end tests run on the `headless` profile. One more test installs the packed tarball into the `web` profile and confirms that the page loads the plugin's UI half. The UI itself was walked through by hand in the real `dsh web` page with a headless browser, in light and dark mode. There is no automated browser test.
- The desktop app is not installed on the development machine, and the plugin **has not been verified in the real desktop app**. The app wraps the same Web pages and the same installation mechanism, so it should behave the same according to the documentation. The ACP and SDK profiles have no UI and were not verified either.
- Trust in a project harness is tied to the hash of a file's content. It guards against code that runs just because it was cloned. It does not review the code: read the files yourself before `dsh-rsi trust`.
- The UI text exists in English and Chinese only.
- The plugin is pinned to DSH `0.2.2-rc.3`, a developer preview whose extension points are still changing.

## License

[MIT](LICENSE)
