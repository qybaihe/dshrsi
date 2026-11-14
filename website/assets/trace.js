// Renders the trace page, and the track on the evaluation page, from what bench/trace.mjs wrote into trace-data.js.
(() => {
  const T = window.DSHRSI_TRACE
  if (!T) return
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
  const hm = clock => clock.slice(0, 5)
  const made = T.adaptation
  const ARMS = [
    { key: 'dsh', cls: 'base', zh: '原版 DSH', en: 'Stock DSH' },
    { key: 'rsi', cls: 'rsi', zh: 'DSH + DSHRSI', en: 'DSH + DSHRSI' },
  ]
  const afterTasks = new Set(T.arms.rsi.sessions.filter(session => session.startedMs > made.widenedAtMs).map(session => session.task))

  // ---------- the track: every session of the language, in the order it started ----------
  function track(host) {
    if (!host) return
    const lanes = ARMS.map((arm) => {
      const data = T.arms[arm.key]
      const cells = data.sessions.map((session) => {
        const failed = session.failed > 0
        const label = `${hm(session.startedAt)} · ${T.language}/${session.task} · ${failed ? t('读 lib.rs 失败', 'the read of lib.rs failed') : t('没有撞上', 'did not hit it')}`
        const cell = el('i', { class: `${failed ? 'hit' : 'clean'}${arm.key === 'rsi' && session.task === made.writtenIn.task ? ' wrote' : ''}`, title: label, role: 'img', 'aria-label': label, text: failed ? '✕' : '' })
        return cell
      })
      return el('div', { class: `lane ${arm.cls}` }, [
        el('div', { class: 'who', text: t(arm.zh, arm.en) }),
        el('div', { class: 'cells', style: `--n:${data.sessions.length}` }, cells),
        el('div', { class: 'n' }, [el('b', { text: String(data.hit) }), document.createTextNode(` / ${data.sessions.length}`)]),
      ])
    })
    // Two marks under the plugin's lane: where the adaptation was written, and from where it applied to every workspace.
    const order = T.arms.rsi.sessions
    const wroteAt = order.findIndex(session => session.task === made.writtenIn.task) + 1
    const wideAt = order.findIndex(session => session.startedMs > made.widenedAtMs) + 1
    const marks = el('div', { class: 'lane marks', 'aria-hidden': 'true' }, [
      el('div', { class: 'who' }),
      el('div', { class: 'cells', style: `--n:${order.length}` }, [
        el('span', { class: 'mark', style: `grid-column:${wroteAt} / ${wideAt}`, text: `✎ ${hm(made.mountedAt)}` }),
        el('span', { class: 'mark wide', style: `grid-column:${wideAt} / -1`, text: t(`${hm(made.widenedAt)} 起全机生效 →`, `machine-wide from ${hm(made.widenedAt)} →`) }),
      ]),
      el('div', { class: 'n' }),
    ])
    host.replaceChildren(
      el('div', { class: 'legend' }, [
        el('span', {}, [el('i', { class: 'hit' }), document.createTextNode(t('这个会话又去读了不存在的 lib.rs', 'the session read the missing lib.rs again'))]),
        el('span', {}, [el('i', { class: 'clean' }), document.createTextNode(t('没有撞上', 'did not hit it'))]),
        el('span', {}, [el('i', { class: 'wrote' }), document.createTextNode(t('✎ 适配在这个会话里写出并挂载', '✎ the adaptation was written and mounted in this session'))]),
      ]),
      ...lanes, marks,
    )
  }

  function stats(host) {
    if (!host) return
    const stat = (value, label, note) => el('div', { class: 'stat' }, [el('div', { class: 'value', text: value }), el('div', { class: 'label', text: label }), el('div', { class: 'note', text: note })])
    host.replaceChildren(
      stat(`${T.arms.dsh.hit} → ${T.arms.rsi.hit}`, t('撞上同一个失败调用的会话', 'Sessions that hit the same failed call'), t(`${T.arms.dsh.sessions.length} 道 Rust 题，原版 → 装上 DSHRSI`, `${T.arms.dsh.sessions.length} Rust tasks, stock → with DSHRSI`)),
      stat(`${T.arms.dsh.afterWidening.hit} → ${T.arms.rsi.afterWidening.hit}`, t('全机生效之后', 'Once it was machine-wide'), t(`两边是同样的 ${afterTasks.size} 道题`, `the same ${afterTasks.size} tasks on both sides`)),
      stat(`${made.secondsToMount} s`, t('从失败的调用到修好挂载', 'From the failed call to the mounted fix'), t('这一轮还没结束，模型的下一步已经用上了', 'the turn was not over; the model\'s next step already had it')),
      stat(String(made.drafts), t('稿', 'drafts'), t('第 1 稿在加载阶段被校验打回，模型带着原因重写', 'the gate rejected the first at the load stage; the model rewrote it from the reason')),
    )
  }

  // ---------- the session, event by event ----------
  const STAGE = {
    static: ['静态检查', 'static'], load: ['加载', 'load'], rehearsal: ['重演', 'rehearsal'], regression: ['回归', 'regression'], policy: ['权限', 'policy'],
  }
  function timeline(host) {
    if (!host) return
    const when = event => el('div', { class: 'when' }, event.time ? [el('b', { text: event.time }), el('span', { text: `+${event.at.toFixed(1)} s` })] : [])
    const item = (event, cls, children) => el('li', { class: `ev ${cls}` }, [when(event), el('div', { class: 'what' }, children)])
    const tag = (text, cls = '') => el('span', { class: `tag ${cls}`.trim(), text })
    const rows = T.session.events.map((event) => {
      if (event.kind === 'task') {
        const tail = el('blockquote')
        // The instruction names the file; that name is the whole story.
        for (const line of event.tail.split('\n')) {
          const at = line.indexOf('lib.rs')
          tail.append(el('div', {}, at < 0 ? [document.createTextNode(line)] : [document.createTextNode(line.slice(0, at)), el('mark', { text: 'lib.rs' }), document.createTextNode(line.slice(at + 6))]))
        }
        return item(event, 'task', [
          el('div', { class: 'line' }, [tag(t('任务', 'task')), el('strong', { text: T.session.task }), el('span', { class: 'dim', text: t(`提示词共 ${event.characters} 个字符，结尾是：`, `a prompt of ${event.characters} characters that ends with:`) })]),
          tail,
        ])
      }
      if (event.kind === 'model') {
        return item(event, 'model', [
          el('div', { class: 'line' }, [tag(t(`模型 · 第 ${event.step} 步`, `model · step ${event.step}`))]),
          event.thought ? el('p', { class: 'thought', text: event.thought }) : null,
          event.said ? el('p', { class: 'said', text: event.said }) : null,
        ])
      }
      if (event.kind === 'call') {
        return item(event, `call ${event.ok ? 'ok' : 'failed'}`, [
          el('div', { class: 'line' }, [tag(event.tool), el('code', { text: event.what }), tag(event.ok ? '✓' : t('✕ 失败', '✕ failed'), event.ok ? 'good' : 'bad')]),
          el('div', { class: 'result', text: event.result ?? '' }),
        ])
      }
      if (event.kind === 'trigger') {
        return item(event, 'rsi', [
          el('div', { class: 'line' }, [tag('dsh-rsi', 'brand'), el('strong', { text: t('判断点命中，决定动手', 'A detector fires, and the plugin decides to act') })]),
          el('p', { text: t(
            `失败的调用返回 ${event.afterMs} 毫秒之后。判断点 ${event.detector}：这个失败单看一次不够分量，但前面已经有 ${made.earlier.length} 个会话撞上过同一个签名（${made.earlier.map(session => session.task).join('、')}），严重度升到 ${event.severity}，过了门槛。`,
            `${event.afterMs} ms after the failed call returned. Detector ${event.detector}: one occurrence would not have been enough, but ${made.earlier.length} earlier sessions had hit the same signature (${made.earlier.map(session => session.task).join(', ')}), which raised the severity to ${event.severity}, over the threshold.`) }),
          el('div', { class: 'result', text: T.signature }),
        ])
      }
      if (event.kind === 'draft') {
        return item(event, 'rsi', [
          el('div', { class: 'line' }, [tag('dsh-rsi', 'brand'), el('strong', { text: t(`会话里的模型写出第 ${event.number} 稿`, `The session's model writes draft ${event.number}`) }), tag(event.ok ? t('✓ 通过', '✓ passed') : t(`✕ 在${STAGE[event.failedAt]?.[0] ?? event.failedAt}阶段被打回`, `✕ rejected at the ${event.failedAt} stage`), event.ok ? 'good' : 'bad')]),
          event.problems.length > 0 ? el('div', { class: 'result', text: event.problems.join('\n') }) : null,
          event.ok ? null : el('p', { text: t('打回的原因原样交还给模型，它据此重写。', 'The reason goes back to the model as it is, and the model rewrites from it.') }),
        ])
      }
      if (event.kind === 'gate') {
        const detail = (stage) => {
          if (stage.stage === 'load') return t(`注册了 ${stage.registrations.join('、')}`, `registered ${stage.registrations.join(', ')}`)
          if (stage.stage === 'rehearsal') return t(`对触发它的 ${stage.observations} 次调用重演：产生 ${stage.effects.join('、')}`, `replayed on the ${stage.observations} call that triggered it: it produced ${stage.effects.join(', ')}`)
          if (stage.stage === 'regression') return t(`对本来成功的调用重演：误伤 ${stage.collateral} 次`, `replayed on calls that had worked: ${stage.collateral} touched`)
          if (stage.stage === 'policy') return t('只用到收紧类能力，不需要批准', 'tighten-only capabilities, no approval needed')
          return t('源码检查无问题', 'the source checks out')
        }
        return item(event, 'rsi', [
          el('div', { class: 'line' }, [tag('dsh-rsi', 'brand'), el('strong', { text: t('五道校验', 'The 5-stage gate') })]),
          el('ul', { class: 'gate' }, event.stages.map(stage => el('li', {}, [tag('✓', 'good'), el('b', { text: t(...(STAGE[stage.stage] ?? [stage.stage, stage.stage])) }), el('span', { text: detail(stage) })]))),
        ])
      }
      if (event.kind === 'mounted') {
        return item(event, 'rsi', [
          el('div', { class: 'line' }, [tag('dsh-rsi', 'brand'), el('strong', { text: t(`挂载：从触发到生效 ${event.seconds} 秒`, `Mounted: ${event.seconds} s from trigger to in effect`) }), ...event.capabilities.map(capability => tag(capability))]),
          el('p', { text: t('适配装进独立的运行环境，在模型的下一次请求之前生效。这一轮还在继续。', 'The adaptation goes into its own runtime context and is in effect before the model\'s next request. The turn goes on.') }),
        ])
      }
      if (event.kind === 'notice') {
        return item(event, 'rsi', [
          el('div', { class: 'line' }, [tag('dsh-rsi', 'brand'), el('strong', { text: t('Harness 把刚写的适配告诉模型', 'The harness tells the model what it just wrote') })]),
          el('div', { class: 'result', text: event.text }),
        ])
      }
      if (event.kind === 'end') {
        return item(event, 'end', [el('div', { class: 'line' }, [tag(t('这一轮结束', 'turn over')), el('strong', { text: T.session.passed1 ? t('题目自带的测试一次通过', 'The exercise\'s own tests pass on the first try') : t('第一次没有通过', 'Not solved on the first try') }), el('span', { class: 'dim', text: t(`共 ${T.session.steps} 步、${T.session.calls} 次工具调用`, `${T.session.steps} steps, ${T.session.calls} tool calls`) })])])
      }
      return null
    })
    host.replaceChildren(...rows.filter(Boolean))
  }

  function later(host) {
    if (!host) return
    const line = (clock, title, text) => el('li', { class: 'ev rsi' }, [el('div', { class: 'when' }, [el('b', { text: clock })]), el('div', { class: 'what' }, [el('div', { class: 'line' }, [el('span', { class: 'tag brand', text: 'dsh-rsi' }), el('strong', { text: title })]), el('p', { text })])])
    const miss = T.arms.rsi.sessions.find(session => session.failed > 0 && session.startedMs > made.widenedAtMs)
    host.replaceChildren(
      line(made.widenedAt, t('扩大到整台机器', 'Widened to the whole machine'), t(
        `适配刚写出来时只对写出它的那个工作目录生效。${hm(made.widenedAt)}，第 ${made.widenedAfter.length} 个工作目录（${made.widenedAfter.join('、')}）也撞上了同一个签名，它升级为对这台机器上的所有工作目录生效。`,
        `A new adaptation applies only to the workspace it was written in. At ${hm(made.widenedAt)} a ${made.widenedAfter.length}th workspace (${made.widenedAfter.join(', ')}) had hit the same signature, and it was widened to every workspace on the machine.`)),
      line(made.promotedAt, t('转正', 'Promoted'), t(
        `账本显示这个麻烦的“第二次撞上”比例在下降（${made.promoteReason.replace(/^.*rate /, '')}），适配从试用转为正式。`,
        `The ledger showed the rate of second hits going down (${made.promoteReason.replace(/^.*rate /, '')}), and the adaptation went from on trial to active.`)),
      ...(miss ? [line(miss.startedAt, t(`漏掉的那一次：${T.language}/${miss.task}`, `The one that got through: ${T.language}/${miss.task}`), t(
        '提示词里已经有这条规矩，模型还是先去读了 lib.rs。适配的另一半在这时起作用：失败的结果上附带了去哪里找文件的说明，模型下一步就读对了。写进提示词的规矩拦不住每一次，所以适配不只是一段提示词。',
        'The rule was already in the prompt, and the model read lib.rs first anyway. This is where the other half of the adaptation acted: the failed result came back with where to look, and the next step read the right file. A rule in the prompt does not hold every time, which is why an adaptation is more than a piece of prompt.'))] : []),
    )
  }

  function render() {
    track(document.getElementById('track'))
    stats(document.getElementById('trace-stats'))
    timeline(document.getElementById('timeline'))
    later(document.getElementById('later'))
    const source = document.getElementById('source')
    if (source && !source.textContent) source.textContent = made.source.trim()
    const section = document.getElementById('prompt-section')
    if (section) section.textContent = made.promptSection ?? ''
  }
  document.addEventListener('dshrsi:lang', render)
  render()
})()
