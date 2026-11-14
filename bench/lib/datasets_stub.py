"""Stand-in for the Hugging Face `datasets` package.

EvalPlus imports `load_dataset` at module load but only calls it for its EvalPerf data, which this
benchmark run does not use. The real package would add several hundred megabytes of dependencies.
"""


def load_dataset(*args, **kwargs):
    raise RuntimeError("the Hugging Face datasets package is not installed in this environment")
