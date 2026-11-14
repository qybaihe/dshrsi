// Written by bench/report.mjs --write. Do not edit by hand.
window.DSHRSI_BENCH = {
 "polyglot": {
  "generatedAt": "2026-11-14T01:24:42.553Z",
  "runs": [
   {
    "run": "flash-dsh-p1",
    "scored": true,
    "arm": "dsh",
    "libraryFrom": null,
    "model": "mimo-v2.6-flash",
    "startedAt": "2026-11-13T18:52:57.972Z",
    "concurrency": 12,
    "tasks": 225,
    "calls": 2799,
    "failed": 97,
    "friction": 72,
    "refused": 0,
    "steps": 2268,
    "agentSeconds": 60215,
    "inputTokens": 42813420,
    "outputTokens": 1970225,
    "failedByKind": {
     "fs_not_found": 34,
     "test-failure": 25,
     "other": 24,
     "module-not-found": 2,
     "no-such-file": 5,
     "command-not-found": 3,
     "fs_not_regular_file": 1,
     "edit-mismatch": 2,
     "tool_outcome_unknown": 1
    },
    "tasksWithFriction": 60,
    "agentTimeouts": 5,
    "testTimeouts": 0,
    "frictionByFifth": [
     {
      "tasks": 45,
      "friction": 5,
      "refused": 0
     },
     {
      "tasks": 45,
      "friction": 15,
      "refused": 0
     },
     {
      "tasks": 45,
      "friction": 20,
      "refused": 0
     },
     {
      "tasks": 45,
      "friction": 15,
      "refused": 0
     },
     {
      "tasks": 45,
      "friction": 17,
      "refused": 0
     }
    ],
    "topFriction": [
     {
      "signature": "read:fs_not_found:Error: cannot read \"<path>/lib.rs\": not found",
      "sessions": 12
     },
     {
      "signature": "bash:command-not-found:timeout",
      "sessions": 2
     },
     {
      "signature": "bash:other:Traceback (most recent call last):",
      "sessions": 2
     },
     {
      "signature": "edit:edit-mismatch:old_string was not found",
      "sessions": 2
     },
     {
      "signature": "read:fs_not_found:Error: cannot read \"<path>/pig_latin_test.go\": not found",
      "sessions": 1
     },
     {
      "signature": "read:fs_not_found:Error: cannot read \"<path>/VariableLengthQuantity.ja",
      "sessions": 1
     },
     {
      "signature": "read:fs_not_found:Error: cannot read \"<path>/Series.java\": not found",
      "sessions": 1
     },
     {
      "signature": "read:fs_not_found:Error: cannot read \"<path>/CustomSet.java\": not found",
      "sessions": 1
     },
     {
      "signature": "bash:other:tests=\"40\" skipped=\"0\" failures=\"0\" errors=\"0\"",
      "sessions": 1
     },
     {
      "signature": "read:fs_not_found:Error: cannot read \"<path>/Transpose.java\": not found",
      "sessions": 1
     },
     {
      "signature": "bash:other:src<path>/React.java:<n>: error: value has private access in Cell",
      "sessions": 1
     },
     {
      "signature": "bash:other:total 32",
      "sessions": 1
     }
    ],
    "passed1": 220,
    "passed2": 225,
    "byLanguage": {
     "cpp": {
      "tasks": 26,
      "passed1": 26,
      "passed2": 26
     },
     "go": {
      "tasks": 39,
      "passed1": 39,
      "passed2": 39
     },
     "java": {
      "tasks": 47,
      "passed1": 46,
      "passed2": 47
     },
     "javascript": {
      "tasks": 49,
      "passed1": 48,
      "passed2": 49
     },
     "python": {
      "tasks": 34,
      "passed1": 34,
      "passed2": 34
     },
     "rust": {
      "tasks": 30,
      "passed1": 27,
      "passed2": 30
     }
    }
   },
   {
    "run": "flash-rsi-p1",
    "scored": true,
    "arm": "rsi",
    "libraryFrom": null,
    "model": "mimo-v2.6-flash",
    "startedAt": "2026-11-13T18:52:57.972Z",
    "concurrency": 12,
    "tasks": 225,
    "calls": 2822,
    "failed": 78,
    "friction": 62,
    "refused": 3,
    "steps": 2293,
    "agentSeconds": 62918,
    "inputTokens": 44222388,
    "outputTokens": 2000350,
    "failedByKind": {
     "no-such-file": 6,
     "fs_not_found": 14,
     "other": 33,
     "module-not-found": 2,
     "test-failure": 16,
     "command-not-found": 1,
     "web_redirect_blocked": 1,
     "edit-mismatch": 5
    },
    "tasksWithFriction": 43,
    "agentTimeouts": 4,
    "testTimeouts": 0,
    "frictionByFifth": [
     {
      "tasks": 45,
      "friction": 13,
      "refused": 0
     },
     {
      "tasks": 45,
      "friction": 12,
      "refused": 0
     },
     {
      "tasks": 45,
      "friction": 9,
      "refused": 0
     },
     {
      "tasks": 45,
      "friction": 13,
      "refused": 0
     },
     {
      "tasks": 45,
      "friction": 15,
      "refused": 3
     }
    ],
    "topFriction": [
     {
      "signature": "read:fs_not_found:Error: cannot read \"<path>/lib.rs\": not found",
      "sessions": 5
     },
     {
      "signature": "bash:other:Traceback (most recent call last):",
      "sessions": 3
     },
     {
      "signature": "edit:edit-mismatch:old_string was not found",
      "sessions": 3
     },
     {
      "signature": "bash:other:---",
      "sessions": 2
     },
     {
      "signature": "bash:other:openjdk version \"21.0.13.0.3\" <n>-10-24",
      "sessions": 2
     },
     {
      "signature": "bash:other:fatal: not a git repository (or any of the parent directories): .git",
      "sessions": 2
     },
     {
      "signature": "bash:no-such-file:beer-song.all.spec.js",
      "sessions": 1
     },
     {
      "signature": "read:fs_not_found:Error: cannot read \"<path>/WordSearcher.java\": not found",
      "sessions": 1
     },
     {
      "signature": "bash:other:25 PASSED",
      "sessions": 1
     },
     {
      "signature": "read:fs_not_found:Error: cannot read \"<path>/WordProblemSolver.java\": not found",
      "sessions": 1
     },
     {
      "signature": "bash:module-not-found:<path>/zebra-puzzle.js",
      "sessions": 1
     },
     {
      "signature": "read:fs_not_found:Error: cannot read \"<path>/Tree.java\": not found",
      "sessions": 1
     }
    ],
    "passed1": 223,
    "passed2": 225,
    "byLanguage": {
     "cpp": {
      "tasks": 26,
      "passed1": 26,
      "passed2": 26
     },
     "go": {
      "tasks": 39,
      "passed1": 39,
      "passed2": 39
     },
     "java": {
      "tasks": 47,
      "passed1": 47,
      "passed2": 47
     },
     "javascript": {
      "tasks": 49,
      "passed1": 48,
      "passed2": 49
     },
     "python": {
      "tasks": 34,
      "passed1": 34,
      "passed2": 34
     },
     "rust": {
      "tasks": 30,
      "passed1": 29,
      "passed2": 30
     }
    },
    "library": {
     "adaptations": [
      {
       "id": "a-mwfcf56p-295f1e",
       "title": "Stop edit churn: verify between edits",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "block",
        "annotate",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "edit:churn:BaseConverter.java",
       "kind": "edit-churn",
       "summary": "<bench>/runs/polyglot/flash-rsi-p1/work/java/exercises/practice/all-your-base/src/main/java/BaseConverter.java edited 5 times in one turn",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 5
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfcilry-65c30f",
       "title": "Force a test run between edits to go-counting.js",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "deny",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "edit:churn:go-counting.js",
       "kind": "edit-churn",
       "summary": "go-counting.js edited 6 times in one turn",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 6
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfck31z-5c8ad2",
       "title": "Redirect missing lib.rs reads to a glob lookup",
       "status": "active",
       "version": 1,
       "layer": "project",
       "scope": "global",
       "capabilities": [
        "annotate",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "read:fs_not_found:Error: cannot read \"<path>/lib.rs\": not found",
       "kind": "repeated-failure",
       "summary": "read hit the same failure 1 time(s): fs_not_found (Error: cannot read \"<path>/lib.rs\": not found)",
       "fires": 1,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 52,
         "hit": 3,
         "rate": 0.058,
         "occurrences": 3
        },
        "after": {
         "sessions": 173,
         "hit": 2,
         "rate": 0.012,
         "occurrences": 2
        }
       }
      },
      {
       "id": "a-mwfco8ci-81296b",
       "title": "Stop rerunning an unchanged failing test command",
       "status": "retired",
       "version": 1,
       "layer": "project",
       "scope": "global",
       "capabilities": [
        "annotate",
        "block"
       ],
       "writtenBy": "model",
       "signature": "bash:test-failure:FAIL",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 1 time(s): test failure (FAIL)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 61,
         "hit": 3,
         "rate": 0.049,
         "occurrences": 3
        },
        "after": {
         "sessions": 164,
         "hit": 7,
         "rate": 0.043,
         "occurrences": 7
        }
       }
      },
      {
       "id": "a-mwfcr0ms-ffe6ee",
       "title": "Stop edit churn on the same file",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "block",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "edit:churn:proverb.py",
       "kind": "edit-churn",
       "summary": "proverb.py edited 5 times in one turn",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 5
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfcz5z7-7db4a7",
       "title": "Verify between ledger.go edit bursts",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "deny",
        "verify",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "edit:churn:ledger.go",
       "kind": "edit-churn",
       "summary": "<bench>/runs/polyglot/flash-rsi-p1/work/go/exercises/practice/ledger/ledger.go edited 5 times in one turn",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 6
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfddoiv-acd0ea",
       "title": "Re-read before retrying a failed edit",
       "status": "active",
       "version": 1,
       "layer": "machine",
       "scope": "global",
       "capabilities": [
        "annotate",
        "deny"
       ],
       "writtenBy": "synth",
       "signature": "edit:edit-mismatch:old_string was not found",
       "kind": "edit-mismatch",
       "summary": "edit hit the same failure 2 time(s): edit mismatch (old_string was not found)",
       "fires": 1,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 106,
         "hit": 1,
         "rate": 0.009,
         "occurrences": 3
        },
        "after": {
         "sessions": 119,
         "hit": 2,
         "rate": 0.017,
         "occurrences": 2
        }
       }
      },
      {
       "id": "a-mwfdfsd0-6f641e",
       "title": "Re-read a file after write before editing",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "annotate",
        "block",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "edit:churn:VerifyChange.java",
       "kind": "edit-churn",
       "summary": "VerifyChange.java edited 5 times in one turn",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 5
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfei0ia-a090f1",
       "title": "Block unverified re-edits of the same file",
       "status": "candidate",
       "version": 2,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "deny",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "edit:churn:Dominoes.java",
       "kind": "edit-churn",
       "summary": "<bench>/runs/polyglot/flash-rsi-p1/work/java/exercises/practice/dominoes/src/main/java/Dominoes.java edited 5 times in one turn",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 7
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfer308-6435fc",
       "title": "Stop unverified edit churn on one file",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "annotate",
        "block",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "edit:churn:ledger.js",
       "kind": "edit-churn",
       "summary": "ledger.js edited 5 times in one turn",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 21
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfeuzj9-d547b1",
       "title": "Run tests between repeated test-file edits",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "block",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "edit:churn:counter_test.go",
       "kind": "edit-churn",
       "summary": "<bench>/runs/polyglot/flash-rsi-p1/work/go/exercises/practice/counter/counter_test.go edited 5 times in one turn",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 5
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfev9f9-cc4747",
       "title": "Re-read a file between batches of edits",
       "status": "active",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "annotate",
        "deny",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "edit:churn:Ledger.java",
       "kind": "edit-churn",
       "summary": "<bench>/runs/polyglot/flash-rsi-p1/work/java/exercises/practice/ledger/src/main/java/Ledger.java edited 6 times in one turn",
       "fires": 3,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 19
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwff4zmf-02960b",
       "title": "Recover from git outside a repository",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "prompt",
        "block",
        "annotate"
       ],
       "writtenBy": "model",
       "signature": "bash:other:fatal: not a git repository (or any of the parent directories): .git",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 2 time(s): other (fatal: not a git repository (or any of the parent directories): .git)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 2
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwff6nli-5aec83",
       "title": "Truncate oversized python3 output",
       "status": "proposed",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "rewrite",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "bash:flood:python3",
       "kind": "output-flood",
       "summary": "`python3` returned more than 20000 characters 2 times",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 2
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwff9mwg-be1f72",
       "title": "Diagnose and block the read-only MeteredFile rerun",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "annotate",
        "deny",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "bash:other:Traceback (most recent call last):",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 1 time(s): other (Traceback (most recent call last):)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 2
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      }
     ],
     "audit": {
      "trigger": 21,
      "generation": 18,
      "create": 15,
      "generalize": 3,
      "promote": 3,
      "retire": 1,
      "revise": 1
     }
    },
    "effects": [
     {
      "id": "a-mwfck31z-5c8ad2",
      "title": "Redirect missing lib.rs reads to a glob lookup",
      "signature": "read:fs_not_found:Error: cannot read \"<path>/lib.rs\": not found",
      "capabilities": [
       "annotate",
       "prompt"
      ],
      "fires": 1,
      "before": {
       "rsi": {
        "tasks": 74,
        "hit": 4,
        "twice": 0
       },
       "dsh": {
        "tasks": 74,
        "hit": 5,
        "twice": 0
       },
       "onlyStock": 2,
       "onlyPlugin": 1,
       "p": 1
      },
      "after": {
       "rsi": {
        "tasks": 151,
        "hit": 1,
        "twice": 0
       },
       "dsh": {
        "tasks": 151,
        "hit": 7,
        "twice": 0
       },
       "onlyStock": 7,
       "onlyPlugin": 1,
       "p": 0.0703
      }
     },
     {
      "id": "a-mwfddoiv-acd0ea",
      "title": "Re-read before retrying a failed edit",
      "signature": "edit:edit-mismatch:old_string was not found",
      "capabilities": [
       "annotate",
       "deny"
      ],
      "fires": 1,
      "before": {
       "rsi": {
        "tasks": 225,
        "hit": 3,
        "twice": 1
       },
       "dsh": {
        "tasks": 225,
        "hit": 2,
        "twice": 0
       },
       "onlyStock": 2,
       "onlyPlugin": 3,
       "p": 1
      },
      "after": {
       "rsi": {
        "tasks": 0,
        "hit": 0,
        "twice": 0
       },
       "dsh": {
        "tasks": 0,
        "hit": 0,
        "twice": 0
       },
       "onlyStock": 0,
       "onlyPlugin": 0,
       "p": 1
      }
     }
    ]
   }
  ],
  "comparisons": [
   {
    "model": "mimo-v2.6-flash",
    "metric": "first try",
    "a": "flash-dsh-p1",
    "b": "flash-rsi-p1",
    "both": 219,
    "onlyA": 1,
    "onlyB": 4,
    "neither": 1,
    "p": 0.375
   },
   {
    "model": "mimo-v2.6-flash",
    "metric": "within two tries",
    "a": "flash-dsh-p1",
    "b": "flash-rsi-p1",
    "both": 225,
    "onlyA": 0,
    "onlyB": 0,
    "neither": 0,
    "p": 1
   }
  ]
 },
 "humaneval": {
  "generatedAt": "2026-11-14T01:24:45.123Z",
  "runs": [
   {
    "run": "flash-dsh-p1",
    "scored": true,
    "arm": "dsh",
    "libraryFrom": null,
    "model": "mimo-v2.6-flash",
    "startedAt": "2026-11-13T18:33:56.054Z",
    "concurrency": 8,
    "tasks": 164,
    "calls": 623,
    "failed": 34,
    "friction": 23,
    "refused": 0,
    "steps": 767,
    "agentSeconds": 6933,
    "inputTokens": 5562780,
    "outputTokens": 205901,
    "failedByKind": {
     "invalid-arguments": 3,
     "test-failure": 11,
     "other": 7,
     "edit-mismatch": 12,
     "web_unsupported_content_type": 1
    },
    "tasksWithFriction": 17,
    "agentTimeouts": 0,
    "testTimeouts": 0,
    "frictionByFifth": [
     {
      "tasks": 32,
      "friction": 4,
      "refused": 0
     },
     {
      "tasks": 33,
      "friction": 3,
      "refused": 0
     },
     {
      "tasks": 33,
      "friction": 4,
      "refused": 0
     },
     {
      "tasks": 33,
      "friction": 4,
      "refused": 0
     },
     {
      "tasks": 33,
      "friction": 8,
      "refused": 0
     }
    ],
    "topFriction": [
     {
      "signature": "edit:edit-mismatch:old_string was not found",
      "sessions": 8
     },
     {
      "signature": "bash:invalid-arguments:missing required property \"description\"",
      "sessions": 3
     },
     {
      "signature": "bash:other:Failed example:",
      "sessions": 2
     },
     {
      "signature": "bash:other:Traceback (most recent call last):",
      "sessions": 2
     },
     {
      "signature": "edit:edit-mismatch:matched 2 times",
      "sessions": 2
     },
     {
      "signature": "bash:other:cat: illegal option -- A",
      "sessions": 1
     },
     {
      "signature": "web_fetch:web_unsupported_content_type:Error: unsupported content type \"application/octet-stream\"",
      "sessions": 1
     }
    ],
    "base": 162,
    "plus": 153
   },
   {
    "run": "flash-rsi-p1",
    "scored": true,
    "arm": "rsi",
    "libraryFrom": null,
    "model": "mimo-v2.6-flash",
    "startedAt": "2026-11-13T18:33:56.054Z",
    "concurrency": 8,
    "tasks": 164,
    "calls": 618,
    "failed": 30,
    "friction": 14,
    "refused": 0,
    "steps": 765,
    "agentSeconds": 8712,
    "inputTokens": 6079610,
    "outputTokens": 229329,
    "failedByKind": {
     "edit-mismatch": 7,
     "invalid-arguments": 1,
     "test-failure": 13,
     "other": 4,
     "syntax-error": 3,
     "web_redirect_blocked": 1,
     "timeout": 1
    },
    "tasksWithFriction": 12,
    "agentTimeouts": 0,
    "testTimeouts": 0,
    "frictionByFifth": [
     {
      "tasks": 32,
      "friction": 3,
      "refused": 0
     },
     {
      "tasks": 33,
      "friction": 1,
      "refused": 0
     },
     {
      "tasks": 33,
      "friction": 3,
      "refused": 0
     },
     {
      "tasks": 33,
      "friction": 1,
      "refused": 0
     },
     {
      "tasks": 33,
      "friction": 6,
      "refused": 0
     }
    ],
    "topFriction": [
     {
      "signature": "edit:edit-mismatch:old_string was not found",
      "sessions": 6
     },
     {
      "signature": "edit:edit-mismatch:matched 2 times",
      "sessions": 1
     },
     {
      "signature": "bash:invalid-arguments:missing required property \"description\"",
      "sessions": 1
     },
     {
      "signature": "bash:other:Traceback (most recent call last):",
      "sessions": 1
     },
     {
      "signature": "bash:other:Failed example:",
      "sessions": 1
     },
     {
      "signature": "web_fetch:web_redirect_blocked:Error: cross-origin redirect to https://html.duckduckgo.com is not followed auto",
      "sessions": 1
     },
     {
      "signature": "web_fetch:timeout:timed out",
      "sessions": 1
     },
     {
      "signature": "bash:other:<n>: Not Found",
      "sessions": 1
     },
     {
      "signature": "bash:other:<path>/js:",
      "sessions": 1
     }
    ],
    "base": 162,
    "plus": 153,
    "library": {
     "adaptations": [
      {
       "id": "a-mwfbn4sz-7fff2c",
       "title": "Refuse doctest/assert reruns until solution.py is edited",
       "status": "candidate",
       "version": 3,
       "layer": "project",
       "scope": "global",
       "capabilities": [
        "annotate",
        "block",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "bash:test-failure:AssertionError",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 1 time(s): test failure (AssertionError)",
       "fires": 2,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 164,
         "hit": 9,
         "rate": 0.055,
         "occurrences": 11
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfbn5m7-2440d3",
       "title": "Block verbatim re-runs of a failing assertion",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "annotate",
        "block",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "bash:test-failure:AssertionError",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 1 time(s): test failure (AssertionError)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 1
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfbnktu-f1cf09",
       "title": "Diagnose failing python -c asserts",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "annotate",
        "block"
       ],
       "writtenBy": "model",
       "signature": "bash:test-failure:AssertionError",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 3 time(s): test failure (AssertionError)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 3
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfbqqyz-8c09c5",
       "title": "Force a re-read after edit mismatch",
       "status": "proposed",
       "version": 1,
       "layer": "machine",
       "scope": "workspace",
       "capabilities": [
        "rewrite",
        "deny"
       ],
       "writtenBy": "model",
       "signature": "edit:edit-mismatch:old_string was not found",
       "kind": "edit-mismatch",
       "summary": "edit hit the same failure 1 time(s): edit mismatch (old_string was not found)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 1
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfbtd01-2a5d25",
       "title": "Re-read the region before retrying a mismatched edit",
       "status": "active",
       "version": 1,
       "layer": "machine",
       "scope": "global",
       "capabilities": [
        "annotate",
        "deny",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "edit:edit-mismatch:old_string was not found",
       "kind": "edit-mismatch",
       "summary": "edit hit the same failure 1 time(s): edit mismatch (old_string was not found)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 132,
         "hit": 5,
         "rate": 0.038,
         "occurrences": 5
        },
        "after": {
         "sessions": 32,
         "hit": 1,
         "rate": 0.031,
         "occurrences": 1
        }
       }
      },
      {
       "id": "a-mwfbx36y-405132",
       "title": "Check inline python -c syntax before running",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "deny",
        "annotate",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "bash:syntax-error:SyntaxError",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 1 time(s): syntax error (SyntaxError)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 1
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfc0zsg-9a464d",
       "title": "Truncate oversized web_fetch results",
       "status": "proposed",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "rewrite",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "web_fetch:flood:web_fetch",
       "kind": "output-flood",
       "summary": "`web_fetch` returned more than 20000 characters 2 times",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 2
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      }
     ],
     "audit": {
      "trigger": 13,
      "generation": 10,
      "create": 7,
      "generalize": 2,
      "promote": 4,
      "revise": 2
     }
    },
    "effects": [
     {
      "id": "a-mwfbn4sz-7fff2c",
      "title": "Refuse doctest/assert reruns until solution.py is edited",
      "signature": "bash:test-failure:AssertionError",
      "capabilities": [
       "annotate",
       "block",
       "prompt"
      ],
      "fires": 2,
      "before": {
       "rsi": {
        "tasks": 99,
        "hit": 6,
        "twice": 1
       },
       "dsh": {
        "tasks": 99,
        "hit": 4,
        "twice": 2
       },
       "onlyStock": 4,
       "onlyPlugin": 6,
       "p": 0.7539
      },
      "after": {
       "rsi": {
        "tasks": 65,
        "hit": 3,
        "twice": 0
       },
       "dsh": {
        "tasks": 65,
        "hit": 1,
        "twice": 0
       },
       "onlyStock": 1,
       "onlyPlugin": 3,
       "p": 0.625
      }
     }
    ]
   }
  ],
  "comparisons": [
   {
    "model": "mimo-v2.6-flash",
    "metric": "HumanEval",
    "a": "flash-dsh-p1",
    "b": "flash-rsi-p1",
    "both": 161,
    "onlyA": 1,
    "onlyB": 1,
    "neither": 1,
    "p": 1
   },
   {
    "model": "mimo-v2.6-flash",
    "metric": "HumanEval+",
    "a": "flash-dsh-p1",
    "b": "flash-rsi-p1",
    "both": 151,
    "onlyA": 2,
    "onlyB": 2,
    "neither": 9,
    "p": 1
   }
  ]
 },
 "mbpp": {
  "generatedAt": "2026-11-14T01:24:55.504Z",
  "runs": [
   {
    "run": "flash-dsh-p1",
    "scored": true,
    "arm": "dsh",
    "libraryFrom": null,
    "model": "mimo-v2.6-flash",
    "startedAt": "2026-11-13T20:01:19.855Z",
    "concurrency": 8,
    "tasks": 378,
    "calls": 1383,
    "failed": 54,
    "friction": 10,
    "refused": 0,
    "steps": 1738,
    "agentSeconds": 18239,
    "inputTokens": 12565560,
    "outputTokens": 425768,
    "failedByKind": {
     "test-failure": 34,
     "syntax-error": 10,
     "other": 4,
     "edit-mismatch": 3,
     "no-such-file": 3
    },
    "tasksWithFriction": 7,
    "agentTimeouts": 0,
    "testTimeouts": 0,
    "frictionByFifth": [
     {
      "tasks": 75,
      "friction": 0,
      "refused": 0
     },
     {
      "tasks": 76,
      "friction": 2,
      "refused": 0
     },
     {
      "tasks": 75,
      "friction": 3,
      "refused": 0
     },
     {
      "tasks": 76,
      "friction": 1,
      "refused": 0
     },
     {
      "tasks": 76,
      "friction": 4,
      "refused": 0
     }
    ],
    "topFriction": [
     {
      "signature": "bash:other:Traceback (most recent call last):",
      "sessions": 3
     },
     {
      "signature": "edit:edit-mismatch:old_string was not found",
      "sessions": 2
     },
     {
      "signature": "bash:no-such-file:Mbpp_100/*",
      "sessions": 1
     },
     {
      "signature": "bash:no-such-file:/mbpp.jsonl",
      "sessions": 1
     }
    ],
    "base": 368,
    "plus": 308
   },
   {
    "run": "flash-rsi-p1",
    "scored": true,
    "arm": "rsi",
    "libraryFrom": null,
    "model": "mimo-v2.6-flash",
    "startedAt": "2026-11-13T20:01:19.855Z",
    "concurrency": 8,
    "tasks": 378,
    "calls": 1503,
    "failed": 69,
    "friction": 28,
    "refused": 0,
    "steps": 1825,
    "agentSeconds": 20389,
    "inputTokens": 15989214,
    "outputTokens": 498579,
    "failedByKind": {
     "syntax-error": 4,
     "test-failure": 37,
     "other": 12,
     "timeout": 5,
     "module-not-found": 3,
     "no-such-file": 1,
     "invalid-arguments": 1,
     "edit-mismatch": 4,
     "web_redirect_blocked": 2
    },
    "tasksWithFriction": 17,
    "agentTimeouts": 0,
    "testTimeouts": 0,
    "frictionByFifth": [
     {
      "tasks": 75,
      "friction": 2,
      "refused": 0
     },
     {
      "tasks": 76,
      "friction": 2,
      "refused": 0
     },
     {
      "tasks": 75,
      "friction": 8,
      "refused": 0
     },
     {
      "tasks": 76,
      "friction": 9,
      "refused": 0
     },
     {
      "tasks": 76,
      "friction": 7,
      "refused": 0
     }
    ],
    "topFriction": [
     {
      "signature": "bash:other:Traceback (most recent call last):",
      "sessions": 9
     },
     {
      "signature": "web_fetch:timeout:timed out",
      "sessions": 3
     },
     {
      "signature": "bash:module-not-found:pyarrow",
      "sessions": 2
     },
     {
      "signature": "edit:edit-mismatch:old_string was not found",
      "sessions": 2
     },
     {
      "signature": "web_fetch:web_redirect_blocked:Error: cross-origin redirect to https://html.duckduckgo.com is not followed auto",
      "sessions": 2
     },
     {
      "signature": "bash:no-such-file:<path>/out.json",
      "sessions": 1
     },
     {
      "signature": "edit:invalid-arguments:missing required property \"new_string\"",
      "sessions": 1
     },
     {
      "signature": "edit:edit-mismatch:matched 2 times",
      "sessions": 1
     },
     {
      "signature": "bash:other:<n> <path>/3e7e8352f118-web_fetch.txt",
      "sessions": 1
     },
     {
      "signature": "bash:other:===",
      "sessions": 1
     },
     {
      "signature": "bash:other:11:CACHE_DIR = user_cache_dir(\"evalplus\")",
      "sessions": 1
     }
    ],
    "base": 369,
    "plus": 315,
    "library": {
     "adaptations": [
      {
       "id": "a-mwfeoi3k-a71407",
       "title": "Pinpoint the failing assertion in python -c tests",
       "status": "retired",
       "version": 1,
       "layer": "project",
       "scope": "global",
       "capabilities": [
        "annotate",
        "block"
       ],
       "writtenBy": "model",
       "signature": "bash:test-failure:AssertionError",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 1 time(s): test failure (AssertionError)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 62,
         "hit": 3,
         "rate": 0.048,
         "occurrences": 3
        },
        "after": {
         "sessions": 316,
         "hit": 25,
         "rate": 0.079,
         "occurrences": 34
        }
       }
      },
      {
       "id": "a-mwfepwvz-8eba8e",
       "title": "Block exec() of solution.py docstring",
       "status": "active",
       "version": 1,
       "layer": "project",
       "scope": "global",
       "capabilities": [
        "prompt",
        "deny"
       ],
       "writtenBy": "model",
       "signature": "bash:syntax-error:SyntaxError",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 1 time(s): syntax error (SyntaxError)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 82,
         "hit": 3,
         "rate": 0.037,
         "occurrences": 3
        },
        "after": {
         "sessions": 296,
         "hit": 1,
         "rate": 0.003,
         "occurrences": 1
        }
       }
      },
      {
       "id": "a-mwfeq8ae-17e0c9",
       "title": "Deny python runs after a solution.py traceback until solution.py is edited",
       "status": "active",
       "version": 3,
       "layer": "project",
       "scope": "global",
       "capabilities": [
        "deny",
        "annotate",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "bash:other:Traceback (most recent call last):",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 1 time(s): other (Traceback (most recent call last):)",
       "fires": 2,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 361,
         "hit": 8,
         "rate": 0.022,
         "occurrences": 8
        },
        "after": {
         "sessions": 17,
         "hit": 1,
         "rate": 0.059,
         "occurrences": 1
        }
       }
      },
      {
       "id": "a-mwff28r0-8d6930",
       "title": "Re-read before retrying a failed edit",
       "status": "candidate",
       "version": 1,
       "layer": "machine",
       "scope": "workspace",
       "capabilities": [
        "annotate",
        "deny"
       ],
       "writtenBy": "synth",
       "signature": "edit:edit-mismatch:matched 2 times",
       "kind": "edit-mismatch",
       "summary": "edit failed 2 times with identical arguments",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 2
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwff6i2d-7fac70",
       "title": "Compute ground truth before rerunning assertions",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "annotate",
        "block",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "bash:flailing:python3",
       "kind": "flailing",
       "summary": "3 different attempts at `python3` all failed",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 3
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwffjdlm-3ef7c8",
       "title": "Short-circuit repeated web_fetch timeouts",
       "status": "active",
       "version": 1,
       "layer": "project",
       "scope": "global",
       "capabilities": [
        "annotate"
       ],
       "writtenBy": "model",
       "signature": "web_fetch:timeout:timed out",
       "kind": "timeout",
       "summary": "web_fetch hit the same failure 3 time(s): timeout (timed out)",
       "fires": 3,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 274,
         "hit": 3,
         "rate": 0.011,
         "occurrences": 5
        },
        "after": {
         "sessions": 104,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwffqhwn-ff70ff",
       "title": "Stop retrying python3 -m pip in this venv",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "annotate",
        "prompt",
        "deny"
       ],
       "writtenBy": "model",
       "signature": "bash:module-not-found:pyarrow",
       "kind": "missing-dependency",
       "summary": "bash hit the same failure 2 time(s): module not found (pyarrow)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 2
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      }
     ],
     "audit": {
      "trigger": 14,
      "generation": 10,
      "create": 7,
      "generalize": 4,
      "retire": 1,
      "promote": 6,
      "revise": 2
     }
    },
    "effects": [
     {
      "id": "a-mwfeq8ae-17e0c9",
      "title": "Deny python runs after a solution.py traceback until solution.py is edited",
      "signature": "bash:other:Traceback (most recent call last):",
      "capabilities": [
       "deny",
       "annotate",
       "prompt"
      ],
      "fires": 2,
      "before": {
       "rsi": {
        "tasks": 105,
        "hit": 4,
        "twice": 0
       },
       "dsh": {
        "tasks": 105,
        "hit": 0,
        "twice": 0
       },
       "onlyStock": 0,
       "onlyPlugin": 4,
       "p": 0.125
      },
      "after": {
       "rsi": {
        "tasks": 273,
        "hit": 5,
        "twice": 0
       },
       "dsh": {
        "tasks": 273,
        "hit": 3,
        "twice": 1
       },
       "onlyStock": 3,
       "onlyPlugin": 5,
       "p": 0.7266
      }
     },
     {
      "id": "a-mwffjdlm-3ef7c8",
      "title": "Short-circuit repeated web_fetch timeouts",
      "signature": "web_fetch:timeout:timed out",
      "capabilities": [
       "annotate"
      ],
      "fires": 3,
      "before": {
       "rsi": {
        "tasks": 283,
        "hit": 3,
        "twice": 1
       },
       "dsh": {
        "tasks": 283,
        "hit": 0,
        "twice": 0
       },
       "onlyStock": 0,
       "onlyPlugin": 3,
       "p": 0.25
      },
      "after": {
       "rsi": {
        "tasks": 95,
        "hit": 0,
        "twice": 0
       },
       "dsh": {
        "tasks": 95,
        "hit": 0,
        "twice": 0
       },
       "onlyStock": 0,
       "onlyPlugin": 0,
       "p": 1
      }
     }
    ]
   }
  ],
  "comparisons": [
   {
    "model": "mimo-v2.6-flash",
    "metric": "MBPP",
    "a": "flash-dsh-p1",
    "b": "flash-rsi-p1",
    "both": 365,
    "onlyA": 3,
    "onlyB": 4,
    "neither": 6,
    "p": 1
   },
   {
    "model": "mimo-v2.6-flash",
    "metric": "MBPP+",
    "a": "flash-dsh-p1",
    "b": "flash-rsi-p1",
    "both": 302,
    "onlyA": 6,
    "onlyB": 13,
    "neither": 57,
    "p": 0.1671
   }
  ]
 },
 "livecodebench": {
  "generatedAt": "2026-11-14T01:24:56.997Z",
  "runs": [
   {
    "run": "flash-dsh-p1",
    "scored": true,
    "arm": "dsh",
    "libraryFrom": null,
    "model": "mimo-v2.6-flash",
    "startedAt": "2026-11-13T20:47:11.175Z",
    "concurrency": 8,
    "tasks": 54,
    "calls": 365,
    "failed": 14,
    "friction": 9,
    "refused": 0,
    "steps": 361,
    "agentSeconds": 23731,
    "inputTokens": 6040042,
    "outputTokens": 494561,
    "failedByKind": {
     "other": 5,
     "test-failure": 3,
     "module-not-found": 2,
     "command-not-found": 2,
     "syntax-error": 2
    },
    "tasksWithFriction": 5,
    "agentTimeouts": 6,
    "testTimeouts": 0,
    "frictionByFifth": [
     {
      "tasks": 10,
      "friction": 0,
      "refused": 0
     },
     {
      "tasks": 11,
      "friction": 3,
      "refused": 0
     },
     {
      "tasks": 11,
      "friction": 4,
      "refused": 0
     },
     {
      "tasks": 11,
      "friction": 1,
      "refused": 0
     },
     {
      "tasks": 11,
      "friction": 1,
      "refused": 0
     }
    ],
    "topFriction": [
     {
      "signature": "bash:other:Traceback (most recent call last):",
      "sessions": 3
     },
     {
      "signature": "bash:command-not-found:timeout",
      "sessions": 2
     },
     {
      "signature": "bash:module-not-found:solution",
      "sessions": 1
     },
     {
      "signature": "bash:other:MISMATCH",
      "sessions": 1
     }
    ],
    "base": 45,
    "plus": 45,
    "byGroup": {
     "easy": {
      "tasks": 14,
      "passed": 14
     },
     "hard": {
      "tasks": 22,
      "passed": 14
     },
     "medium": {
      "tasks": 18,
      "passed": 17
     }
    }
   },
   {
    "run": "flash-rsi-p1",
    "scored": true,
    "arm": "rsi",
    "libraryFrom": null,
    "model": "mimo-v2.6-flash",
    "startedAt": "2026-11-13T20:47:11.175Z",
    "concurrency": 8,
    "tasks": 52,
    "calls": 354,
    "failed": 18,
    "friction": 7,
    "refused": 0,
    "steps": 345,
    "agentSeconds": 24016,
    "inputTokens": 6117554,
    "outputTokens": 419834,
    "failedByKind": {
     "test-failure": 9,
     "module-not-found": 3,
     "other": 3,
     "syntax-error": 2,
     "edit-mismatch": 1
    },
    "tasksWithFriction": 6,
    "agentTimeouts": 6,
    "testTimeouts": 0,
    "frictionByFifth": [
     {
      "tasks": 10,
      "friction": 3,
      "refused": 0
     },
     {
      "tasks": 10,
      "friction": 1,
      "refused": 0
     },
     {
      "tasks": 11,
      "friction": 2,
      "refused": 0
     },
     {
      "tasks": 10,
      "friction": 0,
      "refused": 0
     },
     {
      "tasks": 11,
      "friction": 1,
      "refused": 0
     }
    ],
    "topFriction": [
     {
      "signature": "bash:module-not-found:solution",
      "sessions": 2
     },
     {
      "signature": "bash:other:Traceback (most recent call last):",
      "sessions": 2
     },
     {
      "signature": "bash:other:mkdir: <path>/bench: File exists",
      "sessions": 1
     },
     {
      "signature": "edit:edit-mismatch:old_string was not found",
      "sessions": 1
     }
    ],
    "base": 43,
    "plus": 43,
    "byGroup": {
     "easy": {
      "tasks": 14,
      "passed": 14
     },
     "hard": {
      "tasks": 21,
      "passed": 14
     },
     "medium": {
      "tasks": 17,
      "passed": 15
     }
    },
    "library": {
     "adaptations": [
      {
       "id": "a-mwfgcxmq-874ddb",
       "title": "Add PYTHONPATH when running workspace tests from /tmp",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "prompt",
        "deny",
        "annotate"
       ],
       "writtenBy": "model",
       "signature": "bash:module-not-found:solution",
       "kind": "missing-dependency",
       "summary": "bash hit the same failure 2 time(s): module not found (solution)",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 2
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfgtkyo-8276f5",
       "title": "Verify edits before ending the turn",
       "status": "active",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "verify",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "turn:unverified-edits",
       "kind": "premature-completion",
       "summary": "the turn is ending after 4 edit(s) with no check run afterwards",
       "fires": 1,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 4
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      },
      {
       "id": "a-mwfgybiu-0dc603",
       "title": "Verify expected values before trusting test assertions",
       "status": "active",
       "version": 1,
       "layer": "project",
       "scope": "global",
       "capabilities": [
        "annotate",
        "prompt"
       ],
       "writtenBy": "model",
       "signature": "bash:test-failure:AssertionError",
       "kind": "repeated-failure",
       "summary": "bash hit the same failure 2 time(s): test failure (AssertionError)",
       "fires": 2,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 31,
         "hit": 3,
         "rate": 0.097,
         "occurrences": 5
        },
        "after": {
         "sessions": 144,
         "hit": 3,
         "rate": 0.021,
         "occurrences": 4
        }
       }
      },
      {
       "id": "a-mwfhoacu-2f2013",
       "title": "Stop patching test_random.py; rewrite it once",
       "status": "candidate",
       "version": 1,
       "layer": "project",
       "scope": "workspace",
       "capabilities": [
        "annotate",
        "deny"
       ],
       "writtenBy": "model",
       "signature": "edit:churn:test_random.py",
       "kind": "edit-churn",
       "summary": "<bench>/runs/livecodebench/flash-rsi-p1/work/arc190_d/test_random.py edited 5 times in one turn",
       "fires": 0,
       "faults": 0,
       "recurrence": {
        "before": {
         "sessions": 1,
         "hit": 1,
         "rate": 1,
         "occurrences": 6
        },
        "after": {
         "sessions": 0,
         "hit": 0,
         "rate": 0,
         "occurrences": 0
        }
       }
      }
     ],
     "audit": {
      "trigger": 8,
      "generation": 7,
      "create": 4,
      "promote": 3,
      "generalize": 1
     }
    },
    "effects": [
     {
      "id": "a-mwfgybiu-0dc603",
      "title": "Verify expected values before trusting test assertions",
      "signature": "bash:test-failure:AssertionError",
      "capabilities": [
       "annotate",
       "prompt"
      ],
      "fires": 2,
      "before": {
       "rsi": {
        "tasks": 44,
        "hit": 4,
        "twice": 3
       },
       "dsh": {
        "tasks": 44,
        "hit": 2,
        "twice": 1
       },
       "onlyStock": 1,
       "onlyPlugin": 3,
       "p": 0.625
      },
      "after": {
       "rsi": {
        "tasks": 7,
        "hit": 1,
        "twice": 0
       },
       "dsh": {
        "tasks": 7,
        "hit": 0,
        "twice": 0
       },
       "onlyStock": 0,
       "onlyPlugin": 1,
       "p": 1
      }
     }
    ]
   }
  ],
  "comparisons": [
   {
    "model": "mimo-v2.6-flash",
    "metric": "pass@1",
    "a": "flash-dsh-p1",
    "b": "flash-rsi-p1",
    "both": 40,
    "onlyA": 2,
    "onlyB": 2,
    "neither": 7,
    "p": 1
   },
   {
    "model": "mimo-v2.6-flash",
    "metric": "pass@1",
    "a": "flash-dsh-p1",
    "b": "flash-rsi-p1",
    "both": 40,
    "onlyA": 2,
    "onlyB": 2,
    "neither": 7,
    "p": 1
   }
  ]
 }
}
