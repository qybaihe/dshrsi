#!/bin/sh
# Builds the benchmark home: the datasets, the official scoring code, and the
# toolchains the tests run with. macOS with Homebrew; about 1.5 GB.
#
# These are the steps the measured environment was built with. The script as a
# whole has not been re-run from an empty machine.
set -eu

BENCH="${DSHRSI_BENCH_HOME:-$HOME/.cache/dshrsi-bench}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$BENCH/src" "$BENCH/env/js" "$BENCH/logs"

# Toolchains: Go, Rust, CMake and Boost for C++, a JDK for Gradle, uv for the Python environments.
brew install go rust cmake boost openjdk@21 uv

# Aider Polyglot: 225 Exercism exercises, at the commit the numbers were measured on.
[ -d "$BENCH/src/polyglot-benchmark" ] || git clone https://github.com/Aider-AI/polyglot-benchmark.git "$BENCH/src/polyglot-benchmark"
git -C "$BENCH/src/polyglot-benchmark" checkout 7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f

# Python for the Polyglot Python exercises.
uv venv --python 3.12 "$BENCH/env/py"
uv pip install --python "$BENCH/env/py/bin/python" pytest==9.2.0

# JavaScript: every exercise declares the same devDependencies, so one node_modules is shared by all of them.
cp "$BENCH/src/polyglot-benchmark/javascript/exercises/practice/affine-cipher/package.json" "$BENCH/env/js/package.json"
(cd "$BENCH/env/js" && npm install)

# EvalPlus (HumanEval+, MBPP+) and what its evaluator imports, without the model-inference dependencies.
uv venv --python 3.12 "$BENCH/env/evalplus"
uv pip install --python "$BENCH/env/evalplus/bin/python" --no-deps evalplus==0.3.1
uv pip install --python "$BENCH/env/evalplus/bin/python" appdirs termcolor tqdm numpy psutil tempdir wget fire tree-sitter tree-sitter-python rich
# EvalPlus imports `datasets` at load and only calls it for EvalPerf, which is not used here.
cp "$HERE/lib/datasets_stub.py" "$("$BENCH/env/evalplus/bin/python" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')/datasets.py"

# LiveCodeBench: its evaluator, at the commit the numbers were measured on. The problems are downloaded on first use.
mkdir -p "$BENCH/src/livecodebench"
[ -d "$BENCH/src/livecodebench/LiveCodeBench" ] || git clone https://github.com/LiveCodeBench/LiveCodeBench.git "$BENCH/src/livecodebench/LiveCodeBench"
git -C "$BENCH/src/livecodebench/LiveCodeBench" checkout 28fef95ea8c9f7a547c8329f2cd3d32b92c1fa24

# SWE-bench Verified: the 500 instances and the id list of the 50-instance subset (7 MB). Each repository's object
# store is cloned on first use, without file contents; `node bench/lib/swebench.mjs repos` fetches all 12 ahead of a run.
node "$HERE/lib/swebench.mjs" fetch
# What SWE-bench sessions see is not under the home directory but under a root whose path does not name the account
# (/Users/Shared/dshrsi-bench, or DSHRSI_BENCH_SEALED_ROOT): Python 3.9 to 3.12 and a copy of uv, about 300 MB.
node "$HERE/lib/swebench.mjs" toolchains

echo "benchmark home ready at $BENCH"
echo "check it with: node bench/run.mjs polyglot --validate"
echo "and the seal of SWE-bench sessions with: node bench/lib/swebench.mjs seal"
