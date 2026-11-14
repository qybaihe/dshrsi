// Shared chrome and small behaviours of the DSHRSI site. No dependencies.
(() => {
  const REPO = 'https://github.com/qybaihe/dshrsi'
  const root = document.documentElement
  const store = {
    get(key) { try { return localStorage.getItem(key) } catch { return null } },
    set(key, value) { try { localStorage.setItem(key, value) } catch { /* private window: the choice lasts for this page only */ } },
  }

  // Language: the stored choice, else the browser's, else Chinese.
  const preferred = store.get('dshrsi-lang') ?? (/^zh\b/i.test(navigator.language ?? '') ? 'zh' : 'en')
  const setLang = (lang) => {
    root.dataset.lang = lang
    root.lang = lang === 'zh' ? 'zh-CN' : 'en'
    for (const button of document.querySelectorAll('.lang button')) button.setAttribute('aria-pressed', String(button.dataset.lang === lang))
    const title = document.querySelector(`meta[name="title-${lang}"]`)
    if (title) document.title = title.content
    document.dispatchEvent(new CustomEvent('dshrsi:lang', { detail: lang }))
  }
  root.dataset.lang = preferred

  const PAGES = [
    ['index.html', '首页', 'Home'],
    ['rsi.html', '递归自我改进', 'Recursive self-improvement'],
    ['tech.html', '技术路线', 'How it works'],
    ['guide.html', '怎么写', 'Writing adaptations'],
    ['trace.html', '实录', 'A real trace'],
    ['bench.html', '评测', 'Evaluation'],
  ]
  const both = (zh, en) => `<span lang="zh">${zh}</span><span lang="en">${en}</span>`
  const page = document.body.dataset.page ?? 'index'

  const header = document.createElement('header')
  header.className = 'top'
  header.innerHTML = `<div class="wrap">
    <a class="brand" href="index.html"><img src="assets/logo.svg" alt="" width="28" height="28">DSHRSI</a>
    <nav class="nav" id="nav" aria-label="Main">${PAGES.slice(1).map(([href, zh, en]) => `<a href="${href}"${href === `${page}.html` ? ' aria-current="page"' : ''}>${both(zh, en)}</a>`).join('')}</nav>
    <span class="grow"></span>
    <div class="lang" role="group" aria-label="Language"><button type="button" data-lang="zh">中文</button><button type="button" data-lang="en">EN</button></div>
    <a class="btn small" href="${REPO}">GitHub</a>
    <button class="menu" type="button" aria-controls="nav" aria-expanded="false" aria-label="Menu">≡</button>
  </div>`
  document.body.prepend(header)

  const footer = document.createElement('footer')
  footer.innerHTML = `<div class="wrap">
    <div class="cols">
      <div>
        <a class="brand" href="index.html"><img src="assets/logo.svg" alt="" width="28" height="28">DSHRSI</a>
        <p>${both('DeepSeek Harness 上的递归自我改进。Harness 从自己的运行里改进自己，一次比一次好。', 'Recursive self-improvement for DeepSeek Harness. The harness improves itself from its own runs, one round on top of the last.')}</p>
      </div>
      <div><h4>${both('了解', 'Learn')}</h4><ul>${PAGES.slice(1).map(([href, zh, en]) => `<li><a href="${href}">${both(zh, en)}</a></li>`).join('')}</ul></div>
      <div><h4>${both('使用', 'Use')}</h4><ul>
        <li><a href="index.html#install">${both('安装', 'Install')}</a></li>
        <li><a href="${REPO}/blob/main/packages/dsh-rsi/README.zh.md" lang="zh">插件参考文档</a><a href="${REPO}/blob/main/packages/dsh-rsi/README.md" lang="en">Plugin reference</a></li>
        <li><a href="${REPO}/releases">${both('发布包', 'Releases')}</a></li>
      </ul></div>
      <div><h4>${both('项目', 'Project')}</h4><ul>
        <li><a href="${REPO}">GitHub</a></li>
        <li><a href="${REPO}/issues">${both('问题反馈', 'Issues')}</a></li>
        <li><a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a></li>
      </ul></div>
    </div>
    <div class="fine">
      <span>${both('DSHRSI 是独立的开源社区插件，采用 MIT 许可证，不是 DeepSeek 的官方产品。DeepSeek 及其标识归其所有者所有。', 'DSHRSI is an independent open-source community plugin under the MIT license, not an official DeepSeek product. DeepSeek and its marks belong to their owner.')}</span>
      <span>© 2026 qybaihe</span>
    </div>
  </div>`
  document.body.append(footer)

  for (const button of document.querySelectorAll('.lang button')) {
    button.addEventListener('click', () => { store.set('dshrsi-lang', button.dataset.lang); setLang(button.dataset.lang) })
  }
  setLang(preferred)

  const menu = header.querySelector('.menu')
  const nav = header.querySelector('.nav')
  menu.addEventListener('click', () => { menu.setAttribute('aria-expanded', String(nav.classList.toggle('open'))) })
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  for (const block of document.querySelectorAll('pre')) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy'
    button.textContent = 'Copy'
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(block.querySelector('code')?.innerText ?? '') } catch { return }
      button.textContent = 'Copied'
      setTimeout(() => { button.textContent = 'Copy' }, 1400)
    })
    block.append(button)
  }
})()
