// Scenarios for live runs. Each returns, per session, the workspace and the task.
import fs from 'node:fs'
import path from 'node:path'

const STATS = `import hashlib
values = [n * n % 97 for n in range(1, 2000)]
print(sum(values) + int(hashlib.sha256(b"dshrsi").hexdigest()[:4], 16))
`

export const SCENARIOS = {
  // This machine has python3 but no \`python\`; the README says \`python\`, as READMEs do.
  python: {
    sessions: 5,
    config: {},
    turn({ box }) {
      const cwd = box.workspace('stats', { 'stats.py': STATS, 'README.md': '# stats\n\nPrints one number.\n\n    python stats.py\n' })
      return { cwd, task: 'Run stats.py the way the README says and tell me the number it prints.' }
    },
    check: ({ text }) => /\b154132\b/.test(text.replaceAll(',', '')),
  },

  // A fix that nobody verified: does the turn end with the tests run?
  verify: {
    sessions: 2,
    config: {},
    turn({ box, index }) {
      const cwd = box.workspace(`calc-${index}`, {
        'package.json': '{"name":"calc","type":"module","scripts":{"test":"node --test"}}\n',
        'calc.js': 'export const mean = values => values.reduce((a, b) => a + b, 0) / (values.length - 1)\n',
        'calc.test.mjs': "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { mean } from './calc.js'\ntest('mean', () => assert.equal(mean([2, 4, 6]), 4))\n",
      })
      return { cwd, task: 'mean() in calc.js divides by the wrong count. Fix it. Reply with one short sentence.' }
    },
    check: ({ cwd }) => /values\.length\b(?!\s*-)/.test(fs.readFileSync(path.join(cwd, 'calc.js'), 'utf8')),
  },

  // The user states a rule once; later sessions in that workspace should follow it unprompted.
  correction: {
    sessions: 3,
    config: {},
    turn({ box, index }) {
      const cwd = box.workspace('notes', { 'notes.txt': 'first line\n' })
      if (index === 0) return { cwd, task: 'Append a line saying "second line" to notes.txt.' }
      if (index === 1) return { cwd, resume: true, task: 'No. In this workspace never modify notes.txt directly: always write changes to notes.draft.txt instead and leave notes.txt alone. Undo your change.' }
      return { cwd, task: 'Append a line saying "third line" to the notes.' }
    },
    check: ({ index, cwd }) => {
      if (index < 2) return undefined
      const draft = path.join(cwd, 'notes.draft.txt')
      return fs.existsSync(draft) && /third line/.test(fs.readFileSync(draft, 'utf8')) && !/third line/.test(fs.readFileSync(path.join(cwd, 'notes.txt'), 'utf8'))
    },
  },
}
