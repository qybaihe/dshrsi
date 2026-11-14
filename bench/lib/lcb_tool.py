"""LiveCodeBench helper: lists the problems of a release file and scores solutions with LiveCodeBench's own evaluator.

    python -I lcb_tool.py export <release.jsonl> <problems.jsonl>
    python -I lcb_tool.py score  <LiveCodeBench checkout> <release.jsonl> <samples.jsonl> <out.json> [processes] [timeout]

The hidden tests stay inside the release file. They are decoded here, at scoring time, the way LiveCodeBench decodes
them (lcb_runner/benchmarks/code_generation.py), and never written anywhere an agent session can read.
"""
import base64
import json
import pickle
import sys
import zlib


def decode_private(text):
    try:
        return json.loads(text)
    except Exception:
        return json.loads(pickle.loads(zlib.decompress(base64.b64decode(text.encode("utf-8")))))


def export(release, out):
    with open(release) as source, open(out, "w") as target:
        for line in source:
            row = json.loads(line)
            metadata = json.loads(row["metadata"]) if row.get("metadata") else {}
            target.write(json.dumps({
                "id": row["question_id"],
                "title": row["question_title"],
                "content": row["question_content"],
                "starter": row["starter_code"],
                "platform": row["platform"],
                "difficulty": row["difficulty"],
                "date": row["contest_date"],
                "fn_name": metadata.get("func_name"),
            }) + "\n")


def score(checkout, release, samples_file, out, processes, timeout):
    sys.path.insert(0, checkout)
    import numpy as np
    from lcb_runner.evaluation.compute_code_generation_metrics import codegen_metrics

    solutions = {}
    with open(samples_file) as source:
        for line in source:
            row = json.loads(line)
            solutions[row["id"]] = row["solution"]

    verdicts = {}
    batch = []

    def flush():
        if not batch:
            return
        samples = [entry[1] for entry in batch]
        generations = [[solutions[entry[0]]] for entry in batch]
        _, results, _ = codegen_metrics(samples, generations, k_list=[1], num_process_evaluate=processes, timeout=timeout)
        for index, (question_id, _) in enumerate(batch):
            outcome = results[index][0]
            verdicts[question_id] = bool(len(outcome) > 0 and np.all(np.array(outcome) > 0))
        batch.clear()

    # One pass over the release file, a few problems in memory at a time: some hidden test sets are tens of megabytes.
    with open(release) as source:
        for line in source:
            row = json.loads(line)
            question_id = row["question_id"]
            if question_id not in solutions:
                continue
            tests = json.loads(row["public_test_cases"]) + decode_private(row["private_test_cases"])
            metadata = json.loads(row["metadata"]) if row.get("metadata") else {}
            batch.append((question_id, {"input_output": json.dumps({
                "inputs": [test["input"] for test in tests],
                "outputs": [test["output"] for test in tests],
                "fn_name": metadata.get("func_name"),
            })}))
            if len(batch) >= 12:
                flush()
    flush()
    with open(out, "w") as target:
        json.dump(verdicts, target, indent=1)


if __name__ == "__main__":
    command = sys.argv[1]
    if command == "export":
        export(sys.argv[2], sys.argv[3])
    elif command == "score":
        score(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], int(sys.argv[6]) if len(sys.argv) > 6 else 6, int(sys.argv[7]) if len(sys.argv) > 7 else 6)
    else:
        raise SystemExit("usage: lcb_tool.py export|score ...")
