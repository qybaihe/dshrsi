// Browser half of dsh-rsi, for the DeepSeek Harness web UI.
//
// It shows what the harness has done to itself in the open session:
//   - a badge in the session header, and
//   - a pill in the row under the composer that opens the list of adaptations at work.
// Both stay out of the page until there is something to show, and both light up
// at the moment the harness improves itself.
//
// Everything displayed comes from the "dshRsi" session projection, which the
// host half folds from the session log (src/surface.js). This file folds nothing
// and calls nothing; it only renders. It is a classic script in the format the
// harness's client module loader expects, written by hand so the package needs
// no build step.
window.__ModuleLoader__.load({
  id: 'dsh-rsi',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState } = React

    const NS = 'dsh-rsi'
    const KEY = 'dshRsi'
    /** How long the "just improved itself" state stays lit. */
    const FRESH_MS = 9000

    const DICT = {
      en: {
        'badge.title': 'Harness adaptations at work in this session: {count}',
        'strip.summary': 'Harness adapted to you',
        'strip.evolved': 'The harness just improved itself',
        'strip.count': '{count} at work',
        'strip.learned': '{count} learned here',
        'strip.refused': '{count} stopped',
        'strip.show': 'Show adaptations',
        'strip.hide': 'Hide adaptations',
        'panel.title': 'How the harness adapted itself',
        'panel.lead': 'Code the harness wrote for itself after watching this machine, this project and you. It runs inside this session.',
        'chip.standing': 'in the prompt',
        'chip.evolved': 'learned in this session',
        'chip.refused': 'stopped {count}×',
        'chip.notes': 'spoke up {count}×',
        'list.hint': 'Full record and controls: run /rsi, or dsh-rsi status in a terminal.',
      },
      zh: {
        'badge.title': '本会话中有 {count} 个 Harness 自己写的适配在生效',
        'strip.summary': 'Harness 已为你适配',
        'strip.evolved': 'Harness 刚刚改进了自己',
        'strip.count': '{count} 个在生效',
        'strip.learned': '本会话学到 {count} 个',
        'strip.refused': '拦下 {count} 次调用',
        'strip.show': '展开适配列表',
        'strip.hide': '收起适配列表',
        'panel.title': 'Harness 是怎样改进自己的',
        'panel.lead': '这些是 Harness 观察这台机器、这个项目和你之后，给自己写的代码，正在本会话中运行。',
        'chip.standing': '已写入提示词',
        'chip.evolved': '本会话中学到',
        'chip.refused': '拦下 {count} 次调用',
        'chip.notes': '提醒 {count} 次',
        'list.hint': '完整记录与开关：输入 /rsi，或在终端运行 dsh-rsi status。',
      },
    }

    // Colors come from the host theme tokens only, so both color schemes work without a selector of our own.
    const CSS = `
.dshrsi-badge{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:default;transition:box-shadow .3s ease,border-color .3s ease}
.dshrsi-badge b{font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-primary)}
.dshrsi-bolt{flex:none}
.dshrsi-pill{all:unset;box-sizing:border-box;position:relative;display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:min(460px,100%);height:28px;padding:0 9px;border-radius:999px;border:0.5px solid transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1;white-space:nowrap;cursor:pointer;overflow:hidden;transition:border-color .3s ease,background-color .15s ease}
.dshrsi-pill:focus-visible{outline:2px solid var(--dsw-alias-link);outline-offset:1px}
.dshrsi-open.dshrsi-pill{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.dshrsi-title{position:relative;color:var(--dsw-alias-label-primary);font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis}
.dshrsi-title em{font-style:normal;color:var(--dsw-alias-label-secondary);font-weight:400}
.dshrsi-facts{position:relative;display:inline-flex;gap:8px;flex:none;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dshrsi-chevron{position:relative;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .18s ease}
.dshrsi-open .dshrsi-chevron{transform:rotate(180deg)}
.dshrsi-panel{position:fixed;z-index:1000;box-sizing:border-box;width:min(440px,calc(100vw - 16px));max-height:min(60vh,440px);overflow:auto;padding:12px 14px 10px;border-radius:14px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel,0 10px 32px rgb(0 0 0 / .18));color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.5}
.dshrsi-panel h2{display:flex;align-items:center;gap:6px;margin:0;font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dshrsi-lead{margin:4px 0 6px;color:var(--dsw-alias-label-tertiary)}
.dshrsi-list{list-style:none;margin:0;padding:0}
.dshrsi-item{padding:9px 0;border-top:0.5px solid var(--dsw-alias-border-l1)}
.dshrsi-name{display:flex;flex-wrap:wrap;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-weight:500}
.dshrsi-chip{padding:1px 7px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400;white-space:nowrap}
.dshrsi-chip-new{border-color:var(--dsw-alias-link);color:var(--dsw-alias-link)}
.dshrsi-text{margin:3px 0 0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dshrsi-hint{padding:8px 0 0;border-top:0.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.dshrsi-fresh.dshrsi-pill{border-color:var(--dsw-alias-link);background:color-mix(in srgb,var(--dsw-alias-link) 7%,transparent)}
.dshrsi-fresh.dshrsi-pill::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 0%,color-mix(in srgb,var(--dsw-alias-link) 30%,transparent) 46%,color-mix(in srgb,var(--dsw-alias-link) 10%,transparent) 56%,transparent 100%);background-size:220% 100%;animation:dshrsi-sweep 1.8s ease-in-out 4;pointer-events:none}
.dshrsi-fresh .dshrsi-bolt{animation:dshrsi-pulse .9s ease-in-out 8}
.dshrsi-fresh.dshrsi-badge{border-color:var(--dsw-alias-link);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-link) 22%,transparent)}
@keyframes dshrsi-sweep{from{background-position:120% 0}to{background-position:-120% 0}}
@keyframes dshrsi-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.7}}
@media (hover:hover){.dshrsi-pill:hover{background:var(--dsw-alias-bg-layer-2)}}
@media (prefers-reduced-motion:reduce){.dshrsi-fresh.dshrsi-pill::before,.dshrsi-fresh .dshrsi-bolt{animation:none}.dshrsi-chevron,.dshrsi-badge,.dshrsi-pill{transition:none}}
@media (max-width:640px){.dshrsi-facts span:nth-child(n+2){display:none}}
`

    /** The plugin's own mark. Artwork: it keeps its two colours in both color schemes. */
    function Bolt(props) {
      return h('svg', { className: 'dshrsi-bolt', viewBox: '0 0 16 16', width: props.size ?? 13, height: props.size ?? 13, 'aria-hidden': true },
        h('defs', null, h('linearGradient', { id: 'dshrsi-bolt-ink', x1: '0', y1: '0', x2: '1', y2: '1' },
          h('stop', { offset: '0', stopColor: '#7c5cff' }), h('stop', { offset: '1', stopColor: '#12b5e5' }))),
        h('path', { d: 'M9.2 1.2 3.4 9h3.9l-.9 5.8L12.6 7H8.5l.7-5.8Z', fill: 'url(#dshrsi-bolt-ink)' }))
    }

    function Chevron() {
      return h('svg', { className: 'dshrsi-chevron', viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true },
        h('path', { d: 'm4 6 4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    /** The projection value, or nothing when it is absent, empty, or not the shape this file was written for. */
    function readView(value) {
      if (!value || typeof value !== 'object' || value.v !== 1 || !Array.isArray(value.adaptations) || value.adaptations.length === 0) return undefined
      return value
    }

    /**
     * The title of the adaptation the harness created while this component was on screen, for a few seconds.
     * Opening a session that adapted long ago lights nothing up.
     */
    function useFresh(view) {
      const evolved = view?.counts?.evolved ?? 0
      const seen = useRef(undefined)
      const [fresh, setFresh] = useState(undefined)
      useEffect(() => {
        const before = seen.current
        seen.current = evolved
        if (before === undefined || evolved <= before) return undefined
        setFresh(view?.last?.type === 'evolved' ? view.last.title : '')
        const timer = setTimeout(() => setFresh(undefined), FRESH_MS)
        return () => clearTimeout(timer)
      }, [evolved])
      return fresh
    }

    function HeaderBadge(props) {
      const view = readView(props.useProjection(KEY))
      const fresh = useFresh(view)
      if (!view) return null
      const count = view.adaptations.length
      return h('span', {
        className: `dshrsi-badge${fresh !== undefined ? ' dshrsi-fresh' : ''}`,
        role: 'status',
        title: props.t('badge.title', { count }),
        'aria-label': props.t('badge.title', { count }),
      }, h(Bolt, null), h('b', null, 'RSI'), h('span', null, String(count)))
    }

    function Item(props) {
      const { entry, t } = props
      const chips = []
      if (entry.evolved) chips.push(h('span', { key: 'e', className: 'dshrsi-chip dshrsi-chip-new' }, t('chip.evolved')))
      if (entry.standing) chips.push(h('span', { key: 's', className: 'dshrsi-chip' }, t('chip.standing')))
      if (entry.refused > 0) chips.push(h('span', { key: 'r', className: 'dshrsi-chip' }, t('chip.refused', { count: entry.refused })))
      if (entry.notes > 0) chips.push(h('span', { key: 'n', className: 'dshrsi-chip' }, t('chip.notes', { count: entry.notes })))
      return h('li', { className: 'dshrsi-item' },
        h('div', { className: 'dshrsi-name' }, h('span', null, entry.title), chips),
        entry.text ? h('p', { className: 'dshrsi-text' }, entry.text) : null)
    }

    /** Where the panel goes: above the pill, right edges aligned, kept inside the window. */
    function placeAbove(element) {
      const box = element.getBoundingClientRect()
      return { right: Math.max(8, window.innerWidth - box.right), bottom: Math.max(8, window.innerHeight - box.top + 8) }
    }

    function Strip(props) {
      const { t } = props
      const view = readView(props.useProjection(KEY))
      const fresh = useFresh(view)
      const [open, setOpen] = useState(false)
      const [place, setPlace] = useState(undefined)
      const pill = useRef(null)
      const panel = useRef(null)
      const facts = useMemo(() => {
        if (!view) return []
        const learned = view.adaptations.filter(entry => entry.evolved).length
        const out = [t('strip.count', { count: view.adaptations.length })]
        if (learned > 0) out.push(t('strip.learned', { count: learned }))
        if (view.counts.refused > 0) out.push(t('strip.refused', { count: view.counts.refused }))
        return out
      }, [view, t])
      useEffect(() => {
        if (!open) return undefined
        const update = () => { if (pill.current) setPlace(placeAbove(pill.current)) }
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        const onDown = (event) => {
          if (pill.current?.contains(event.target) || panel.current?.contains(event.target)) return
          setOpen(false)
        }
        update()
        window.addEventListener('resize', update)
        window.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onDown)
        return () => {
          window.removeEventListener('resize', update)
          window.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onDown)
        }
      }, [open])
      if (!view) return null
      const lit = fresh !== undefined
      return h(React.Fragment, null,
        h('button', {
          ref: pill, type: 'button',
          className: `dshrsi-pill${lit ? ' dshrsi-fresh' : ''}${open ? ' dshrsi-open' : ''}`,
          'aria-expanded': open, 'aria-haspopup': 'dialog',
          title: open ? t('strip.hide') : t('strip.show'),
          onClick: () => setOpen(value => !value),
        },
        h(Bolt, { size: 14 }),
        h('span', { className: 'dshrsi-title' }, lit ? [t('strip.evolved'), fresh ? h('em', { key: 't' }, ` · ${fresh}`) : null] : t('strip.summary')),
        h('span', { className: 'dshrsi-facts' }, facts.map((fact, index) => h('span', { key: index }, fact))),
        h(Chevron, null)),
        // The docked composer clips what it contains, so the panel is rendered at the document body.
        open && place ? createPortal(h('div', { ref: panel, className: 'dshrsi-panel', role: 'dialog', 'aria-label': t('panel.title'), style: place },
          h('h2', null, h(Bolt, { size: 15 }), t('panel.title')),
          h('p', { className: 'dshrsi-lead' }, t('panel.lead')),
          h('ul', { className: 'dshrsi-list' }, view.adaptations.map(entry => h(Item, { key: entry.title, entry, t }))),
          h('div', { className: 'dshrsi-hint' }, t('list.hint'))), document.body) : null)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-rsi: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-rsi', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-rsi: styles')
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities', id: 'dsh-rsi', order: 40, locale: NS,
        }, HeaderBadge))
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'dsh-rsi', order: 20, locale: NS,
        }, Strip))
      },
    }
  },
})
