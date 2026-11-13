// The project harness against the real harness: a rule one person taught it
// is written into the repository, and runs on another person's machine once
// they accept it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { PLUGIN_DIR, makeSandbox, runDsh } from '../support/harness.mjs'
import { systemText, toolResults } from '../support/sim-llm.mjs'

const FILES = { 'package.json': '{"name":"demo","type":"module"}\n' }
const said = (body, pattern) => pattern.test(JSON.stringify(body.messages))
const bash = (command, description = 'run') => ({ toolCalls: [{ name: 'bash', input: { description, command } }] })
const rsiCli = (home, ...args) => execFileSync(process.execPath, [path.join(PLUGIN_DIR, 'bin/rsi.js'), '--home', path.join(home, 'rsi'), ...args], { encoding: 'utf8' })
const rsi = { generator: 'synth' }

/** Installs with npm until corrected; in a later session, follows whatever the harness prompt says. */
const learner = (body) => {
  if (said(body, /一律用 pnpm/)) return { text: '好的，之后都用 pnpm。' }
  return toolResults(body).length === 0 ? bash('echo "npm install left-pad"', 'install with npm') : { text: 'Installed with npm.' }
}
const follower = body => ({ text: systemText(body).includes('一律用 pnpm') ? 'I will use pnpm.' : 'I will use npm.' })

test('a rule taught in one checkout travels with the repository and runs elsewhere once accepted', async (t) => {
  const author = makeSandbox('proj-author')
  const teammate = makeSandbox('proj-mate')
  t.after(author.cleanup)
  t.after(teammate.cleanup)
  const repo = author.workspace('repo', FILES)
  const adaptations = path.join(repo, '.dsh-rsi', 'adaptations')

  assert.match(rsiCli(author.home, 'project', 'init', repo), /project harness at .*\.dsh-rsi/)
  assert.match(rsiCli(author.home, 'project', repo), /No adaptations yet\./)

  await t.test('the author corrects the agent; the rule is learned, then proves itself and is written into the repository', async () => {
    const first = await runDsh({ home: author.home, cwd: repo, task: 'add left-pad', policy: learner, rsi })
    await runDsh({ home: author.home, cwd: repo, task: '不要用 npm，这个仓库一律用 pnpm', policy: learner, rsi, args: ['--session-id', first.final.sessionId] })
    assert.equal(author.library().list()[0].status, 'candidate')
    assert.deepEqual(fs.readdirSync(adaptations), [])

    const next = await runDsh({ home: author.home, cwd: repo, task: 'add lodash', policy: follower, rsi })
    assert.equal(next.final.text, 'I will use pnpm.')
    const [record] = author.library().list()
    assert.equal(record.status, 'active')
    assert.equal(record.layer, 'project')
    assert.deepEqual(fs.readdirSync(adaptations), [`${record.project.entry}.js`])
    const text = fs.readFileSync(path.join(adaptations, `${record.project.entry}.js`), 'utf8')
    assert.match(text, /^\/\/ @dsh-rsi \{"signature":"[^"]+","kind":"user-correction"/)
    assert.match(text, /一律用 pnpm/)
    assert.ok(!text.includes(author.dir), 'nothing about the author\'s machine is in the file')
    assert.match(rsiCli(author.home, 'project', repo), /\.js\s+runs \(active\)\s+prompt\s+Remember the user's instruction/)
    assert.match(rsiCli(author.home, 'status'), /active\s+1\s+project\s+repo \(repo\)/)
  })

  await t.test('on a teammate\'s machine the same repository changes nothing until they accept the file', async () => {
    const before = await runDsh({ home: teammate.home, cwd: repo, task: 'add lodash', policy: follower, rsi })
    assert.equal(before.final.text, 'I will use npm.')
    assert.equal(teammate.library().list().length, 0)
    const view = rsiCli(teammate.home, 'project', repo)
    assert.match(view, /\.js\s+not accepted\s+prompt\s+Remember the user's instruction/)
    assert.match(view, /Files that are not accepted do not run here/)

    assert.match(rsiCli(teammate.home, 'trust', repo), /accepted {2}\S+\.js {2}\[prompt\] {2}Remember the user's instruction[^\n]*\n1 file\(s\) accepted/)
    const after = await runDsh({ home: teammate.home, cwd: repo, task: 'add lodash', policy: follower, rsi })
    assert.equal(after.final.text, 'I will use pnpm.')
    const [imported] = teammate.library().list()
    assert.equal(imported.origin.imported, 'project')
    assert.equal(imported.status, 'active')
    assert.match(systemText(after.agentRequests[0]), /\[harness adaptation: Remember the user's instruction/)
  })

  await t.test('a file changed in the repository does not run in its new form until it is accepted again', async () => {
    const [file] = fs.readdirSync(adaptations)
    const full = path.join(adaptations, file)
    fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replace('一律用 pnpm', '一律用 pnpm（也不要用 yarn）'))
    const stale = await runDsh({ home: teammate.home, cwd: repo, task: 'add lodash', policy: follower, rsi })
    assert.doesNotMatch(systemText(stale.agentRequests[0]), /也不要用 yarn/)
    assert.match(systemText(stale.agentRequests[0]), /一律用 pnpm/)
    assert.match(rsiCli(teammate.home, 'project', repo), /changed, old runs/)

    rsiCli(teammate.home, 'trust', repo)
    const current = await runDsh({ home: teammate.home, cwd: repo, task: 'add lodash', policy: follower, rsi })
    assert.match(systemText(current.agentRequests[0]), /也不要用 yarn/)
    assert.equal(teammate.library().list()[0].version, 2)
  })

  await t.test('deleting the file unplugs the rule everywhere the repository goes', async () => {
    const [file] = fs.readdirSync(adaptations)
    assert.match(rsiCli(teammate.home, 'project', 'remove', path.basename(file, '.js'), repo), /removed/)
    const gone = await runDsh({ home: teammate.home, cwd: repo, task: 'add lodash', policy: follower, rsi })
    assert.equal(gone.final.text, 'I will use npm.')
    assert.equal(teammate.library().list()[0].status, 'disabled')
    const authorToo = await runDsh({ home: author.home, cwd: repo, task: 'add lodash', policy: follower, rsi })
    assert.equal(authorToo.final.text, 'I will use npm.')
    assert.deepEqual(fs.readdirSync(adaptations), [], 'an unplugged rule is not written back')
  })
})

test('a hand-written project rule is enforced at the tool boundary; a pack carries a machine fact to another home', async (t) => {
  const box = makeSandbox('proj-rule')
  const other = makeSandbox('proj-pack')
  t.after(box.cleanup)
  t.after(other.cleanup)
  const repo = box.workspace('repo', FILES)
  rsiCli(box.home, 'project', 'init', repo)
  fs.writeFileSync(path.join(repo, '.dsh-rsi', 'adaptations', 'no-force-push.js'), `define({
  title: 'Never force-push',
  description: 'This repository forbids force pushes.',
  capabilities: ['deny'],
  setup(h) {
    h.beforeTool({ tool: 'bash', command: /git\\s+push\\s+.*--force/ }, () => h.deny('Force pushes are not allowed in this repository. Push normally.'))
  },
})
`)
  const pusher = (body) => {
    const results = toolResults(body)
    if (results.some(result => /Force pushes are not allowed/.test(result.text))) return { text: 'I was stopped from force-pushing.' }
    return results.length === 0 ? bash('git push origin main --force', 'push') : { text: 'Force-pushed.' }
  }
  const unaccepted = await runDsh({ home: box.home, cwd: repo, task: 'publish it', policy: pusher, rsi })
  assert.equal(unaccepted.final.text, 'Force-pushed.')
  assert.match(rsiCli(box.home, 'trust', repo), /accepted {2}no-force-push\.js {2}\[deny\] {2}Never force-push/)
  const accepted = await runDsh({ home: box.home, cwd: repo, task: 'publish it', policy: pusher, rsi })
  assert.equal(accepted.final.text, 'I was stopped from force-pushing.')

  // The same adaptation, taken out as a pack and brought into another harness home.
  const file = path.join(box.dir, 'rules.rsi.json')
  assert.match(rsiCli(box.home, 'export', '-o', file), /1 adaptation\(s\) written/)
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(pack.format, 'dsh-rsi-pack/1')
  assert.ok(!JSON.stringify(pack).includes(box.dir))
  const elsewhere = other.workspace('elsewhere', FILES)
  assert.match(rsiCli(other.home, 'import', file, '--scope', elsewhere), /proposed {2}Never force-push\n\s+dsh-rsi approve a-/)
  const waiting = await runDsh({ home: other.home, cwd: elsewhere, task: 'publish it', policy: pusher, rsi })
  assert.equal(waiting.final.text, 'Force-pushed.')
  rsiCli(other.home, 'approve', other.library().list()[0].id)
  const enforced = await runDsh({ home: other.home, cwd: elsewhere, task: 'publish it', policy: pusher, rsi })
  assert.equal(enforced.final.text, 'I was stopped from force-pushing.')
})
