// Renders the evaluation page from the summaries bench/report.mjs wrote into bench-data.js.
(() => {
  const DATA = window.DSHRSI_BENCH ?? {}
  const zh = () => document.documentElement.dataset.lang !== 'en'
  const t = (inChinese, inEnglish) => (zh() ? inChinese : inEnglish)
  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value
      else if (key === 'text') node.textContent = value
      else node.setAttribute(key, value)
    }
    for (const child of [].concat(children)) if (child != null) node.append(child)
    return node
  }

  // Each benchmark and the measures it is scored on. `compare` is the name the report gives the paired test.
  const BENCHES = [
    { key: 'polyglot', name: 'Aider Polyglot', total: 225, measures: [
      { field: 'passed1', compare: 'first try', strict: true, zh: 'Aider Polyglot · 一次通过', en: 'Aider Polyglot · first try' },
      { field: 'passed2', compare: 'within two tries', zh: 'Aider Polyglot · 两次以内', en: 'Aider Polyglot · within two tries' },
    ] },
    { key: 'humaneval', name: 'HumanEval', total: 164, measures: [
      { field: 'base', compare: 'HumanEval', zh: 'HumanEval', en: 'HumanEval' },
      { field: 'plus', compare: 'HumanEval+', strict: true, zh: 'HumanEval+', en: 'HumanEval+' },
    ] },
    { key: 'mbpp', name: 'MBPP', total: 378, measures: [
      { field: 'base', compare: 'MBPP', zh: 'MBPP', en: 'MBPP' },
      { field: 'plus', compare: 'MBPP+', strict: true, zh: 'MBPP+', en: 'MBPP+' },
    ] },
    { key: 'livecodebench', name: 'LiveCodeBench v6', total: 175, measures: [
      { field: 'base', compare: 'pass@1', zh: 'LiveCodeBench v6', en: 'LiveCodeBench v6' },
    ] },
  ]
  const ARMS = [
    { arm: 'dsh', cls: 'base', zh: '原版 DSH', en: 'Stock DSH' },
    { arm: 'rsi', cls: 'rsi', zh: 'DSH + DSHRSI', en: 'DSH + DSHRSI' },
  ]

  const passOf = run => Number(/p(\d+)$/.exec(run.run)?.[1] ?? 1)
  const allRuns = BENCHES.flatMap(bench => (DATA[bench.key]?.runs ?? []))
  const models = [...new Set(allRuns.map(run => run.model))].sort((a, b) => (a.includes('pro') ? 0 : 1) - (b.includes('pro') ? 0 : 1) || a.localeCompare(b))
  const state = { model: models[0], pass: 1 }
  const passesOf = model => [...new Set(allRuns.filter(run => run.model === model).map(passOf))].sort()
  const find = (bench, arm) => (DATA[bench.key]?.runs ?? []).find(run => run.model === state.model && run.arm === arm && passOf(run) === state.pass)
  const percent = (part, whole) => (whole > 0 ? (100 * part) / whole : 0)
  const fixed = (value, digits = 1) => value.toLocaleString(zh() ? 'zh-CN' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const whole = value => Math.round(value).toLocaleString(zh() ? 'zh-CN' : 'en-US')

  // ---------- filters ----------
  function segment(host, options, current, choose) {
    host.replaceChildren(...options.map(([value, label, disabled]) => {
      const button = el('button', { type: 'button', 'aria-pressed': String(value === current), text: label })
      if (disabled) button.disabled = true
      button.addEventListener('click', () => choose(value))
      return button
    }))
  }
  function filters() {
    // With one model, or one pass, there is nothing to choose.
    document.getElementById('f-model').closest('.group').hidden = models.length < 2
    document.querySelector('.filters').hidden = models.length < 2 && !models.some(model => passesOf(model).length > 1)
    segment(document.getElementById('f-model'), models.map(model => [model, model]), state.model, (model) => {
      state.model = model
      if (!passesOf(model).includes(state.pass)) state.pass = 1
      render()
    })
    const available = passesOf(state.model)
    document.getElementById('f-pass').closest('.group').hidden = !models.some(model => passesOf(model).length > 1)
    segment(document.getElementById('f-pass'), [1, 2].map(pass => [pass, pass === 1 ? t('第 1 轮（从空的适配库开始）', 'Pass 1 (empty library)') : t('第 2 轮（带着第 1 轮学到的）', 'Pass 2 (with what pass 1 learned)'), !available.includes(pass)]), state.pass, (pass) => { state.pass = pass; render() })
  }

  // ---------- tooltip: the value first, then what it is ----------
  const tip = document.getElementById('tip')
  function showTip(target, x, y) {
    tip.replaceChildren(el('b', { text: target.dataset.value }), document.createTextNode(target.dataset.what))
    tip.hidden = false
    const box = tip.getBoundingClientRect()
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, x + 14))}px`
    tip.style.top = `${Math.max(8, y - box.height - 12)}px`
  }
  document.addEventListener('pointermove', (event) => {
    const bar = event.target.closest?.('.bar')
    if (bar) showTip(bar, event.clientX, event.clientY)
    else if (!document.activeElement?.classList?.contains('bar')) tip.hidden = true
  })
  document.addEventListener('focusin', (event) => {
    if (!event.target.classList?.contains('bar')) return
    const box = event.target.getBoundingClientRect()
    showTip(event.target, box.right, box.top)
  })
  document.addEventListener('focusout', () => { tip.hidden = true })

  // ---------- bar chart ----------
  /** rows: [{ name, note, bars: [{ cls, value, label, tipValue, tipWhat }] }]; max: the value at the right end of the axis. */
  function bars(host, rows, max, tick) {
    if (rows.length === 0) return host.replaceChildren(el('p', { class: 'empty', text: t('这个模型和轮次还没有数据。', 'No data for this model and pass yet.') }))
    const scale = el('div', { class: 'scale', 'aria-hidden': 'true' }, [el('div'), el('div', { class: 'ticks' }, [0, 1, 2, 3, 4].map((step) => {
      const mark = el('span', { text: tick((max * step) / 4) })
      mark.style.left = `${step * 25}%`
      return mark
    }))])
    host.replaceChildren(...rows.map(row => el('div', { class: 'row' }, [
      el('div', { class: 'name' }, [document.createTextNode(row.name), row.note ? el('small', { text: row.note }) : null]),
      el('div', { class: 'track' }, row.bars.map((bar) => {
        const node = el('div', { class: `bar ${bar.cls}`, tabindex: '0', role: 'img', 'aria-label': `${bar.tipWhat}: ${bar.tipValue}`, 'data-value': bar.tipValue, 'data-what': bar.tipWhat }, [el('span', { class: 'val', text: bar.label })])
        node.style.width = `${Math.max(0, Math.min(100, (100 * bar.value) / max))}%`
        return node
      })),
    ])), scale)
  }
  const niceMax = (value) => {
    if (value <= 0) return 4
    const step = 10 ** Math.floor(Math.log10(value / 4))
    const unit = [1, 2, 2.5, 5, 10].find(candidate => candidate * step * 4 >= value) * step
    return unit * 4
  }

  // ---------- sections ----------
  function scoreboard() {
    const head = el('thead', {}, el('tr', {}, [
      el('th', { text: t('基准', 'Benchmark') }), el('th', { class: 'n', text: t('题数', 'Tasks') }),
      el('th', { class: 'n', text: t('原版 DSH', 'Stock DSH') }), el('th', { class: 'n', text: 'DSH + DSHRSI' }),
      el('th', { class: 'n', text: t('差值', 'Difference') }), el('th', { class: 'n', text: 'p' }),
    ]))
    const chartRows = []
    const partial = []
    const body = el('tbody')
    for (const bench of BENCHES) {
      const runs = ARMS.map(({ arm }) => find(bench, arm))
      for (const measure of bench.measures) {
        const name = t(measure.zh, measure.en)
        let cells = runs.map(run => (run && run.scored !== false ? { solved: run[measure.field], tasks: run.tasks } : undefined))
        // A benchmark that was cut short is compared on the tasks both sides finished, and nothing else.
        const pair = runs[0] && runs[1] ? (DATA[bench.key].comparisons ?? []).find(entry => entry.metric === measure.compare && entry.a === runs[0].run && entry.b === runs[1].run) : undefined
        if (pair && cells[0] && cells[1] && (cells[0].tasks !== bench.total || cells[1].tasks !== bench.total)) {
          const tasks = pair.both + pair.onlyA + pair.onlyB + pair.neither
          cells = [{ solved: pair.both + pair.onlyA, tasks }, { solved: pair.both + pair.onlyB, tasks }]
          if (!partial.some(entry => entry.bench === bench)) partial.push({ bench, tasks })
        }
        const solvedCell = cell => (cell ? el('td', { class: 'n' }, [document.createTextNode(`${cell.solved} `), el('span', { class: 'of', text: `/ ${cell.tasks} · ${fixed(percent(cell.solved, cell.tasks))}%` })]) : el('td', { class: 'n', text: '—' }))
        const test = runs[0] && runs[1] ? (DATA[bench.key].comparisons ?? []).find(entry => entry.metric === measure.compare && entry.a === runs[0].run && entry.b === runs[1].run) : undefined
        const difference = cells[0] && cells[1] && cells[0].tasks === cells[1].tasks ? cells[1].solved - cells[0].solved : undefined
        const differenceCell = el('td', { class: 'n' })
        if (difference === undefined) differenceCell.textContent = '—'
        else if (difference === 0) differenceCell.append(el('span', { class: 'same', text: '0' }))
        else differenceCell.append(el('b', { class: difference > 0 ? 'up' : 'down', text: `${difference > 0 ? '+' : '−'}${Math.abs(difference)}` }))
        body.append(el('tr', {}, [
          el('td', { text: name }), el('td', { class: 'n', text: String(cells[0]?.tasks ?? cells[1]?.tasks ?? '—') }),
          solvedCell(cells[0]), solvedCell(cells[1]), differenceCell,
          el('td', { class: 'n', text: test && difference !== undefined ? fixed(test.p, 2) : '—' }),
        ]))
        if (difference !== undefined) chartRows.push({ name, difference, stock: cells[0].solved, plugin: cells[1].solved, tasks: cells[0].tasks, partial: cells[0].tasks !== bench.total, p: test?.p, pair, strict: measure.strict === true })
      }
    }
    document.getElementById('scoreboard').replaceChildren(head, body)
    document.getElementById('partial').textContent = partial.map(({ bench, tasks }) => t(
      `${bench.name} 没有跑完：模型账户的余额在中途用尽，之后的会话全部被接口拒绝。这里只统计两边都在那之前完成的 ${tasks} 道题（共 ${bench.total} 道），按固定的随机顺序取到哪算哪。`,
      `${bench.name} was cut short: the model account ran out of balance part-way, and every session after that was refused by the API. Only the ${tasks} tasks (of ${bench.total}) that both sides had finished before then are counted, in the fixed shuffled order they came in.`)).join(' ')
    deltas(document.getElementById('chart-delta'), chartRows)
    highlights(chartRows)
  }

  /** One row per score: how many more (or fewer) tasks the plugin's arm solved, from a zero line. */
  function deltas(host, rows) {
    if (rows.length === 0) return host.replaceChildren(el('p', { class: 'empty', text: t('这个模型和轮次还没有数据。', 'No data for this model and pass yet.') }))
    const low = Math.min(0, ...rows.map(row => row.difference))
    const high = Math.max(1, ...rows.map(row => row.difference))
    const span = high - low
    const zero = (100 * -low) / span
    host.style.setProperty('--zero', `${zero}%`)
    host.replaceChildren(...rows.map((row) => {
      const sign = row.difference > 0 ? '+' : row.difference < 0 ? '−' : ''
      const value = `${sign}${Math.abs(row.difference)}`
      const what = t(`${row.name}：原版 ${row.stock}，DSHRSI ${row.plugin}，共 ${row.tasks} 题`, `${row.name}: stock ${row.stock}, DSHRSI ${row.plugin}, of ${row.tasks} tasks`)
      const bar = el('div', { class: `bar ${row.difference < 0 ? 'base' : 'rsi'}${row.difference === 0 ? ' none' : ''}`, tabindex: '0', role: 'img', 'aria-label': `${what}: ${value}`, 'data-value': t(`${value} 题`, `${value} task${Math.abs(row.difference) === 1 ? '' : 's'}`), 'data-what': what })
      const width = (100 * Math.abs(row.difference)) / span
      bar.style.width = `${width}%`
      bar.style.left = `${row.difference < 0 ? zero - width : zero}%`
      const label = el('span', { class: 'val' }, [el('b', { text: value }), document.createTextNode(` ${row.stock} → ${row.plugin}`)])
      label.style.left = `${row.difference < 0 ? zero : zero + width}%`
      return el('div', { class: 'row' }, [
        el('div', { class: 'name' }, [document.createTextNode(row.name), el('small', { text: row.partial ? t(`${row.tasks} 题，未跑完`, `${row.tasks} tasks, cut short`) : t(`${row.tasks} 题`, `${row.tasks} tasks`) })]),
        el('div', { class: 'track' }, [bar, label]),
      ])
    }))
  }

  /** The tiles above the table. Each number is computed here from the same rows the table shows. */
  function highlights(rows) {
    const host = document.getElementById('highlights')
    const complete = rows.filter(row => !row.partial)
    const strict = complete.filter(row => row.strict)
    if (strict.length === 0) return host.replaceChildren()
    const sum = field => strict.reduce((total, row) => total + row[field], 0)
    const onlyStock = strict.reduce((total, row) => total + row.pair.onlyA, 0)
    const onlyPlugin = strict.reduce((total, row) => total + row.pair.onlyB, 0)
    // Exact McNemar test on the pooled discordant pairs.
    const discordant = onlyStock + onlyPlugin
    let tail = 0
    for (let k = 0, term = 1; k <= Math.min(onlyStock, onlyPlugin); k += 1) { tail += term; term = (term * (discordant - k)) / (k + 1) }
    const p = Math.min(1, (2 * tail) / 2 ** discordant)
    const gained = sum('plugin') - sum('stock')
    const behind = complete.filter(row => row.difference < 0).length
    const ahead = complete.filter(row => row.difference > 0).length
    const cost = (field) => {
      const total = arm => BENCHES.reduce((value, bench) => value + (bench.total === find(bench, arm)?.tasks ? find(bench, arm)[field] : 0), 0)
      return (100 * (total('rsi') / total('dsh') - 1))
    }
    const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`
    const stat = (value, label, note) => el('div', { class: 'stat' }, [el('div', { class: 'value', text: value }), el('div', { class: 'label', text: label }), el('div', { class: 'note', text: note })])
    host.replaceChildren(
      stat(signed(gained), t('最严的三项成绩上多解出的题', 'more tasks solved on the three strictest scores'), t(`${strict.map(row => row.name.replace(/^Aider /, '')).join('、')}：${sum('stock')} → ${sum('plugin')}，共 ${sum('tasks')} 题`, `${strict.map(row => row.name.replace(/^Aider /, '')).join(', ')}: ${sum('stock')} → ${sum('plugin')} of ${sum('tasks')}`)),
      stat(`${onlyPlugin} : ${onlyStock}`, t('只有一边解出的题', 'tasks only one side solved'), t(`DSHRSI 独自解出 ${onlyPlugin} 道，原版独自解出 ${onlyStock} 道；合并后的精确 McNemar 检验 p = ${fixed(p, 2)}`, `${onlyPlugin} only with DSHRSI, ${onlyStock} only on stock; exact McNemar test on the pooled pairs, p = ${fixed(p, 2)}`)),
      stat(`${behind} / ${complete.length}`, t('项成绩低于原版', 'scores below stock'), t(`跑完的 ${complete.length} 项成绩里，${ahead} 项更高，${complete.length - ahead - behind} 项持平`, `of the ${complete.length} scores that ran to the end, ${ahead} are higher and ${complete.length - ahead - behind} are level`)),
      stat(`${cost('agentSeconds') >= 0 ? '+' : '−'}${fixed(Math.abs(cost('agentSeconds')), 0)}%`, t('用时，这是代价', 'agent time, the price of it'), t(`输入 token ${cost('inputTokens') >= 0 ? '+' : '−'}${fixed(Math.abs(cost('inputTokens')), 0)}%，三个跑完的基准合计`, `input tokens ${cost('inputTokens') >= 0 ? '+' : '−'}${fixed(Math.abs(cost('inputTokens')), 0)}%, over the three suites that ran to the end`)),
    )
  }

  // A failed call is the work not being right yet (tests, compiler), a cause the classifier names (a missing command,
  // a path that is not there, an edit that did not apply ...), or anything else that exited with an error.
  const groupsOf = (run) => {
    const kinds = run.failedByKind ?? {}
    const work = (kinds['test-failure'] ?? 0) + (kinds['syntax-error'] ?? 0)
    const unnamed = kinds.other ?? 0
    return { work, unnamed, named: run.failed - work - unnamed }
  }

  function friction() {
    const rows = []
    for (const bench of BENCHES) {
      const present = ARMS.map(arm => ({ arm, run: find(bench, arm.arm) })).filter(entry => entry.run)
      if (present.length === 0) continue
      rows.push({ name: bench.name, note: t(`${present[0].run.tasks} 题`, `${present[0].run.tasks} tasks`), bars: present.map(({ arm, run }) => {
        const value = (100 * run.failed) / run.tasks
        return { cls: arm.cls, value, label: fixed(value), tipValue: t(`每 100 题 ${fixed(value)} 次`, `${fixed(value)} per 100 tasks`), tipWhat: t(`${bench.name} · ${arm.zh} · ${run.calls} 次工具调用里失败 ${run.failed} 次`, `${bench.name} · ${arm.en} · ${run.failed} of ${run.calls} tool calls failed`) }
      }) })
    }
    const max = niceMax(Math.max(0, ...rows.flatMap(row => row.bars.map(bar => bar.value))))
    bars(document.getElementById('chart-friction'), rows, max, value => (Number.isInteger(value) ? String(value) : fixed(value)))

    const head = el('thead', {}, el('tr', {}, [
      el('th', { text: t('基准', 'Benchmark') }), el('th', { text: '' }),
      el('th', { class: 'n', text: t('工具调用', 'Tool calls') }), el('th', { class: 'n', text: t('失败：测试和编译', 'Failed: tests, compiler') }),
      el('th', { class: 'n', text: t('失败：环境', 'Failed: surroundings') }), el('th', { class: 'n', text: t('失败：其他', 'Failed: other') }),
      el('th', { class: 'n', text: t('模型步数', 'Model steps') }), el('th', { class: 'n', text: t('用时（分钟）', 'Agent time (min)') }),
      el('th', { class: 'n', text: t('输入 token（千）', 'Tokens in (k)') }), el('th', { class: 'n', text: t('输出 token（千）', 'Tokens out (k)') }),
    ]))
    const body = el('tbody')
    for (const bench of BENCHES) {
      for (const arm of ARMS) {
        const run = find(bench, arm.arm)
        if (!run) continue
        const per = value => value / run.tasks
        const groups = groupsOf(run)
        body.append(el('tr', {}, [
          el('td', { text: bench.name }), el('td', { text: t(arm.zh, arm.en) }),
          el('td', { class: 'n', text: fixed(per(run.calls)) }), el('td', { class: 'n', text: fixed(100 * per(groups.work)) }),
          el('td', { class: 'n', text: fixed(100 * per(groups.named)) }), el('td', { class: 'n', text: fixed(100 * per(groups.unnamed)) }),
          el('td', { class: 'n', text: fixed(per(run.steps)) }), el('td', { class: 'n', text: fixed(per(run.agentSeconds) / 60) }),
          el('td', { class: 'n', text: whole(per(run.inputTokens) / 1000) }), el('td', { class: 'n', text: fixed(per(run.outputTokens) / 1000) }),
        ]))
      }
    }
    if (body.children.length === 0) body.append(el('tr', {}, el('td', { colspan: '10', class: 'empty', text: t('这个模型和轮次还没有数据。', 'No data for this model and pass yet.') })))
    document.getElementById('cost').replaceChildren(head, body)
  }

  const STATUS = { active: ['已转正', 'promoted'], candidate: ['试用中', 'on trial'], proposed: ['等待批准', 'waiting for approval'], quarantined: ['已隔离', 'quarantined'], retired: ['已停用', 'retired'], disabled: ['已关闭', 'disabled'] }
  function adaptations() {
    const host = document.getElementById('adaptations')
    const blocks = []
    for (const bench of BENCHES) {
      const run = find(bench, 'rsi')
      const list = run?.library?.adaptations ?? []
      if (!run) continue
      const audit = run.library?.audit ?? {}
      const summary = t(
        `${bench.name}：写出 ${list.length} 个适配（触发 ${audit.trigger ?? 0} 次，改写 ${audit.revise ?? 0} 次，转正 ${audit.promote ?? 0} 次），拦下 ${run.refused} 次调用。`,
        `${bench.name}: ${list.length} adaptation(s) written (${audit.trigger ?? 0} triggers, ${audit.revise ?? 0} revisions, ${audit.promote ?? 0} promotions), ${run.refused} call(s) refused.`)
      blocks.push(el('h3', { style: 'margin:var(--space-6) 0 var(--space-3);font-size:18px;font-weight:500', text: summary }))
      const card = entry => el('div', { class: 'item' }, [
          el('h4', { text: entry.title }),
          el('p', { text: entry.summary ?? '' }),
          el('div', { class: 'meta' }, [
            el('span', { class: 'tag brand', text: t(`起作用 ${entry.fires ?? 0} 次`, `acted ${entry.fires ?? 0}×`) }),
            el('span', { class: 'tag', text: t(...(STATUS[entry.status] ?? [entry.status, entry.status])) }),
            el('span', { class: 'tag', text: entry.scope === 'global' ? t('整台机器', 'whole machine') : t('单个工作目录', 'one workspace') }),
            ...(entry.capabilities ?? []).map(capability => el('span', { class: 'tag', text: capability })),
            el('span', { class: 'tag', text: entry.signature ?? '' }),
          ]),
        ])
      // The ones that did something come first; the rest are one click away.
      const acted = list.filter(entry => (entry.fires ?? 0) > 0).sort((a, b) => b.fires - a.fires)
      const idle = list.filter(entry => !((entry.fires ?? 0) > 0))
      if (acted.length > 0) blocks.push(el('div', { class: 'adapt' }, acted.map(card)))
      if (idle.length > 0) {
        blocks.push(el('details', { style: 'margin-top:var(--space-3)' }, [
          el('summary', { style: 'cursor:pointer;color:var(--text-3);font-size:14px;padding:6px 0', text: t(`另外 ${idle.length} 个写出来了但还没起过作用`, `${idle.length} more that were written and have not acted yet`) }),
          el('div', { class: 'adapt', style: 'margin-top:var(--space-3)' }, idle.map(card)),
        ]))
      }
    }
    host.replaceChildren(...(blocks.length > 0 ? blocks : [el('p', { class: 'empty', text: t('这个模型和轮次还没有数据。', 'No data for this model and pass yet.') })]))

    // Per adaptation: the failure it answers, on the tasks that started after it was mounted, against the same tasks in the stock arm.
    const effects = BENCHES.flatMap(bench => (find(bench, 'rsi')?.effects ?? []).map(effect => ({ bench, effect })))
    const target = document.getElementById('effects')
    if (effects.length === 0) return target.replaceChildren()
    const share = side => (side.tasks > 0 ? `${side.hit} / ${side.tasks}` : '—')
    target.replaceChildren(
      el('h3', { style: 'margin:var(--space-7) 0 var(--space-3)', text: t('这些适配有没有用', 'Did those adaptations work') }),
      el('p', { style: 'color:var(--text-3);margin:0 0 var(--space-4)', text: t('只看扩大到整台机器、并且起过作用的适配。每一格是“出现过它针对的那种失败的题数 / 题数”。“之前”是它生效前开始的题，两边都还没有它；“之后”是它生效后才开始的题，原版 DSH 在同样这些题上作对照。p 是“之后”这些题上的精确 McNemar 检验。', 'Only adaptations that reached the whole machine and acted at least once. Each cell is “tasks in which the failure it answers occurred / tasks”. “Before” are the tasks that started before it took effect, when neither side had it; “after” are the tasks that started once it was in effect, with stock DSH on the very same tasks as the control. p is an exact McNemar test on the “after” tasks.') }),
      el('div', { class: 'table' }, el('table', {}, [
        el('thead', {}, el('tr', {}, [el('th', { text: t('适配', 'Adaptation') }), el('th', { class: 'n', text: t('之前：原版', 'Before: stock') }), el('th', { class: 'n', text: t('之前：DSHRSI', 'Before: DSHRSI') }), el('th', { class: 'n', text: t('之后：原版', 'After: stock') }), el('th', { class: 'n', text: t('之后：DSHRSI', 'After: DSHRSI') }), el('th', { class: 'n', text: 'p' })])),
        el('tbody', {}, effects.map(({ bench, effect }) => el('tr', {}, [
          el('td', {}, [document.createTextNode(effect.title), el('div', { class: 'of', style: 'font-size:13px;margin-top:4px', text: `${bench.name} · ${effect.signature.length > 64 ? `${effect.signature.slice(0, 64)}…` : effect.signature}` })]),
          el('td', { class: 'n', text: share(effect.before.dsh) }), el('td', { class: 'n', text: share(effect.before.rsi) }),
          el('td', { class: 'n', text: share(effect.after.dsh) }), el('td', { class: 'n', text: share(effect.after.rsi) }),
          el('td', { class: 'n', text: effect.after.rsi.tasks > 0 && effect.after.p !== undefined ? (effect.after.p < 0.01 ? '< 0.01' : fixed(effect.after.p, 2)) : '—' }),
        ]))),
      ])),
    )
  }

  function render() {
    filters()
    scoreboard()
    friction()
    adaptations()
    const stamps = BENCHES.map(bench => DATA[bench.key]?.generatedAt).filter(Boolean).sort()
    const day = stamps.length > 0 ? stamps[stamps.length - 1].slice(0, 10) : ''
    document.getElementById('generated').textContent = day ? `数据生成于 ${day}。` : ''
    document.getElementById('generated-en').textContent = day ? `Data generated on ${day}.` : ''
  }
  document.addEventListener('dshrsi:lang', render)
  if (models.length > 0) render()
})()
