<img src="icon.svg" width="56" height="56" alt="">

# dsh-rsi

[English](README.md) · **简体中文**

`dsh-rsi` 把 **RSI**（Recursive Self-Improvement，**递归自我改进**）带到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）上：一个插件包，Harness 通过它从自己的运行里改进自己，每一次改进又是下一次改进的起点。

装上之后，Harness 会盯着每一次运行：哪里反复出错、哪里被用户纠正、哪里没验证就收工。发现之后，它让会话里的模型**当场写一段 Harness 代码**（我们叫它“适配”），过一道校验关，然后在**同一轮任务还没结束时**挂进运行中的会话。有效的适配沉淀到本机的适配库里，下一次会话一开始就带着。

递归就在这里：改进过的 Harness 去跑下一个会话，带着已经学到的东西继续观察，然后再改进。没管住的适配会被改写得更严，管用的转正，同一个麻烦在第二个工作目录里又出现的，扩大到整台机器。用得越久，这份 Harness 越贴合这台机器、这个人和这个项目：机器上缺什么命令、项目里的规矩是什么、你纠正过它什么，都变成 Harness 自身的一部分，而不是一段每次都要重新读的提示词。项目里学到的规矩还可以写进仓库，跟着代码走到每个人的机器上。

它本身就是一个普通插件，不改 DSH 一行源码。

<a id="one-full-pass"></a>

## 一次完整的过程

```
会话事件 ──▶ 观察（16 个判断点）──▶ 发现“摩擦”
                                      │
                    适配库、历史会话 ──▶ 决策：值不值得改、现在改还是收工时改
                                      │
              模型写适配代码 ──▶ 校验关（静态/加载/重演/回归/权限）──▶ 不过就带着原因打回重写
                                      │                                └─ 写不出来则用内置模板
                                      ▼
                    挂载到运行中的会话（下一次模型请求之前生效）
                                      │
              沉淀：有效的转正，出错的隔离，没拦住的改写成更严格的版本
```

实测里的一个例子（模型 `mimo-v2.6-pro`，本机没有 `python` 只有 `python3`，README 写的是 `python stats.py`）：

- 第 1、2 次会话：模型各踩一次坑（`python: command not found`），自己绕过去了。Harness 记下了，没有动。
- 第 3 次会话：又踩。这已经是第三次，Harness 让模型写了一个适配 “Route python invocations to python3”：在提示词里写明本机没有 `python`，并在工具入口处拒绝执行 `python ...`。校验一次通过，当轮挂载。
- 第 4、5、6 次会话：一次都没再踩。其中一次模型还是想跑 `python`，被 Harness 在执行前拦下。

没装插件的对照组，5 次会话 5 次都踩。

同一个场景一共跑了三轮（每轮一个全新的适配库）：适配写出之前的 9 次会话 9 次都踩；之后的 7 次会话没有一次失败调用，其中 3 次是模型仍然想跑 `python`、被 Harness 在执行前拦下。样本很小，只有一个模型、一个场景，只能说明这条链路是通的，不能当作成功率的统计结论。

<a id="install"></a>

## 安装

**在桌面 App 或 Web 界面里**：侧边栏 **Plugins → Add plugin → Install a third-party plugin**，填下面任意一种来源，点 **Install**，装好后点 **Enable now**。

| 来源 | 填什么 |
|---|---|
| 发布包 | `https://github.com/qybaihe/dshrsi/releases/download/v0.1.0/dsh-rsi-0.1.0.tgz` |
| 本地 tarball | 在 `packages/dsh-rsi` 里运行 `npm pack`，填生成的 `.tgz` 的绝对路径 |
| 本地目录 | `packages/dsh-rsi` 的绝对路径 |

也可以把本仓库加成一个插件源：打开 Experimental plugins 里的 **Custom plugin indexes**，在 **Discover → Add index source** 填 `https://raw.githubusercontent.com/qybaihe/dshrsi/main/market/index.json`。

**命令行**。每个 profile 有自己的一套插件，要分别装。`dsh plugin add` 会调用 `pnpm`，它需要在 `PATH` 上。

```sh
dsh plugin --profile web add <来源>        # Web 界面：dsh web
dsh plugin --profile headless add <来源>   # 无界面：dsh headless "任务"
# 桌面 App：先完全退出 App，用 App 菜单 "Manage dsh Command…" 装出来的 dsh 执行
dsh plugin --profile desktop add <来源>
```

不安装、单次运行时用补丁加载也行（这种方式只有宿主部分，没有界面部分）：

```sh
dsh --profile headless --patch rsi.yml "run the tests"
```

```yaml
# rsi.yml
- insert:
    - id: dsh-rsi
      name: /path/to/packages/dsh-rsi/index.js
      config: {}
```

适配库默认放在 `$DSH_HOME/rsi`（未设置 `DSH_HOME` 时是 `~/.dsh/rsi`）。

<a id="user-interface"></a>

## 界面

Web 界面（桌面 App 用的是同一套页面）里有三处：

- 会话标题栏右侧的 **RSI** 徽标：本会话里有几个适配在生效。
- 输入框下方的 **Harness adapted to you** 状态条：几个在生效、几个是本会话学到的、拦下了几次调用。点开是列表，每个适配写着它做了什么。Harness 改进自己的那一刻，徽标和状态条会亮起来，显示 “The harness just improved itself · <适配标题>”。
- 斜杠命令 **/rsi**：本会话挂载了哪些适配、各属于哪一层、适配库里有什么在等批准。

没有适配在生效时，这三处在页面上都不出现。界面只读会话日志里已有的东西（Harness 的通知、被拦下的工具结果、系统提示词里的适配段），不额外写日志。

![Harness 改进自己的那一刻](../../assets/ui-evolving.png)

<a id="detectors"></a>

## 判断点

每个判断点读的是归一化后的会话事件，所以同一套判断既能跑在实时会话上，也能跑在磁盘上存着的历史会话上（`dsh-rsi mine`）。

| 判断点 | 发现什么 |
|---|---|
| `repeat-failing-call` | 同一个调用用同样的参数再次失败 |
| `failure-signature` | 同一个失败原因反复出现（缺命令、缺依赖、网络、权限、端口占用、路径不存在、编辑不匹配、参数非法、内存不足等） |
| `command-flailing` | 同一类命令换着参数连续失败 |
| `read-thrash` | 同一个文件没改过却被反复读 |
| `edit-churn` | 一轮里对同一个文件改了很多次 |
| `error-storm` | 最近的工具调用大部分在失败 |
| `stall` | 连续失败，中间没有一次成功 |
| `timeout-recurrence` | 同一类命令反复超时被转入后台 |
| `output-flood` | 同一类命令反复吐出超大输出 |
| `approval-denied` / `denied-repeat` | 同类操作反复被用户拒绝；被拒后原样重试 |
| `user-correction` | 用户纠正了模型，或打断后改了方向 |
| `user-interrupt` | 用户中途打断（只记录） |
| `premature-completion` | 改了代码，没跑任何检查就要结束这一轮 |
| `negative-feedback` | 用户给某条回复点了差评并写了原因 |
| `model-instability` | 模型请求反复失败、重试、撞输出上限（只记录） |
| `context-pressure` | 任务中途发生了上下文压缩（只记录） |

“摩擦”用一个跨会话稳定的签名标识，比如 `bash:command-not-found:python`。同一个签名在以前的会话里见过，就会降低这次动手的门槛：默认情况下一轮内出现两次就改；前两次会话各见过一次的，第三次会话第一次出现就改。

<a id="what-an-adaptation-is"></a>

## 适配是什么

一段 JavaScript，只能通过 `h` 这个对象接触 Harness：

```js
define({
  title: 'Route python invocations to python3',
  description: '...',
  capabilities: ['deny', 'prompt'],
  setup(h) {
    h.promptSection('On this machine there is no `python` executable; use `python3`.')
    h.beforeTool({ tool: 'bash', command: /(^|[;&|(]\s*)python(\s|$)/ },
      () => h.deny('`python` is not installed on this machine. Use `python3` instead.'))
  },
})
```

| 能力 | 做什么 | 级别 |
|---|---|---|
| `annotate` | 工具结果后面追加一条说明 | 自动 |
| `steer` | 下一次模型请求前追加一条说明 | 自动 |
| `deny` | 拒绝一次工具调用并给出原因 | 自动 |
| `ask` | 要求这次调用先经用户批准 | 自动 |
| `block` | 把一次工具结果改成带纠正意见的错误 | 自动 |
| `verify` | 条件不满足时不让这一轮结束 | 自动 |
| `prompt` | 给系统提示词加一段常驻内容 | 自动 |
| `rewrite` | 替换工具结果的文本 | 需批准 |
| `tool` | 给模型注册一个新工具 | 需批准 |
| `exec` | 通过 Harness 的 shell 工具执行命令（受同样的沙箱和审批约束） | 需批准 |

“自动”这一级只能加信息、拒绝、或要求多做事。**没有任何一种能力可以放行 Harness 本来会拒绝的操作**：适配的 `deny`/`ask` 只会让链路上其它策略的结论变得更严。“需批准”的适配会以 `proposed` 状态存下来，等 `dsh-rsi approve <id>`；把 `autonomy` 设成 `full` 则不等。

<a id="layers-and-the-project-harness"></a>

## 三层，以及项目专属的 Harness

每个适配属于三层之一，由它回应的问题决定：

| 层 | 是什么 | 例子 | 初始作用范围 |
|---|---|---|---|
| `machine` | 这台机器的事实，和 Harness 自己的工具在这台机器上的表现 | 没有 `python`、端口被占、内网域名解析不了 | 学到它的工作区；在第二个工作区再遇到就扩大到全机 |
| `user` | 这个人希望怎样被对待 | 给回复点了差评并说“太长了” | 全机 |
| `project` | 一个仓库的规矩和习惯 | “这个仓库一律用 pnpm”、改完要跑哪条检查 | 学到它的工作区 |

`layers` 配置项可以整层关掉：关掉的层既不挂载，也不再学。

**项目层可以跟着仓库走。** 在仓库里运行一次：

```sh
dsh-rsi project init     # 建立 <仓库>/.dsh-rsi/
```

之后，在这个仓库里学到的项目层适配，只要在后续会话里起过作用、没出过错（转为 `active`），就会被写成 `.dsh-rsi/adaptations/<名字>.js`。一个文件就是一个适配：提交它，同事拉下来就有；删掉它，就拔掉了。也可以自己手写一个文件放进去，格式就是上面的 `define({...})`。

```
.dsh-rsi/
  harness.json           格式标记，和项目级设置
  adaptations/
    remember-the-user-s-instruction-3f2a1c.js
    no-force-push.js     手写的也一样
```

仓库里的代码不会因为被克隆下来就在你的机器上运行。每台机器要先看过、再接受：

```sh
dsh-rsi project          # 这个仓库的项目 Harness 里有什么，本机接受了哪些
dsh-rsi trust            # 接受当前磁盘上的这些文件
```

接受的是文件的确切内容。文件被改了（比如同事更新了规矩），在你重新 `trust` 之前，本机继续运行你接受过的旧版本；`untrust` 之后一个都不运行。用到“需批准”能力的文件，`trust` 就是批准。自己机器上学出来并写进仓库的，本机自动接受。

写进仓库的只有适配源码和它回应的问题的一行说明，不含会话 ID、工作目录和工具输出。

`harness.json` 里的 `settings` 是项目级设置，只对在这个仓库里开的会话生效：

```json
{ "format": 1, "settings": { "mode": "propose", "disabledDetectors": ["read-thrash"], "signals": { "editChurn": 9 } } }
```

项目只能让 Harness 更保守，不能更激进：`mode` 只能往 `observe` 方向调，`autonomy` 这类设置项目不能碰，写了会被整体忽略并给出警告。

配置项 `projectHarness`：`auto`（默认，如上）、`manual`（只有 `dsh-rsi project add <id>` 才写仓库）、`off`（完全不理会 `.dsh-rsi/`）。`projectTrust`：`ask`（默认，如上）、`always`（仓库里有什么就运行什么，但“需批准”的能力仍然要你明确接受）。

**打包带走。** 机器层和用户层不进仓库，但可以导出成一个文件带到另一台机器：

```sh
dsh-rsi export -o my-harness.rsi.json            # 所有正在生效的；--layer machine 只导某一层
dsh-rsi import my-harness.rsi.json               # 作为待批准的提议导入，逐个 dsh-rsi approve
dsh-rsi import my-harness.rsi.json --trust       # 直接启用
```

导入时每段源码都重新过静态和加载两道检查，包里自称的能力不算数。

<a id="the-validation-gate"></a>

## 校验关

一段适配要依次通过：

1. **静态**：长度上限；不许出现 `require`、`import`、`process`、`eval`、网络访问等。
2. **加载**：能编译、调用了 `define()`、确实注册了东西、声明的能力都用到了。
3. **重演**：把触发它的那几次调用回放给它，它必须有所动作。
4. **回归**：把本次会话里成功的调用回放给它，它不许拒绝、拦截或改写其中任何一个；也不许拒绝 `command -v X` / `which X` 这类只是查看环境的命令。
5. **权限**：用到“需批准”能力的，按 `autonomy` 决定是否搁置。

没通过就把原因发回给模型重写（默认最多两次），再不行就用内置模板。

适配代码运行在独立的 `node:vm` 上下文里，和宿主之间只隔着一个传 JSON 字符串的桥，拿不到宿主对象；每次调用有同步和异步两重超时；任何一次处理函数抛错都不会影响它所挂的那次工具调用，累计三次就被隔离。库里存的源码如果被改得比当初通过校验时权限更大，挂载时会被拒绝并隔离。

这层隔离防的是写错和随手滥用，**不是对抗恶意代码的安全边界**。

<a id="lifecycle"></a>

## 沉淀与修订

- 新适配是 `candidate`；在后续会话里起过作用且没出过错，转为 `active`。
- 同一个摩擦在适配装上之后又出现了两次，就触发**修订**：把现有源码和“它没拦住”这件事交给模型，要求写一个真正拦得住的版本；旧版本留在 `versions/` 里，可以 `rollback`。
- 在第二个工作区碰到同一个摩擦，适配的作用范围从工作区扩大到全机，而不是再学一遍。
- 用户 `disable` 或 `retire` 过的，不会被重新学出来。
- 每个决定都记在 `audit.jsonl` 里；每次摩擦、挂载、生效、出错记在 `ledger.jsonl` 里。

<a id="command-line"></a>

## 命令行

```
dsh-rsi status                  学到了什么、有没有用
dsh-rsi show <id>               一个适配的记录、源码、校验报告、计数
dsh-rsi approve <id>            批准一个等待中的适配
dsh-rsi disable|enable <id>     关掉 / 重新打开
dsh-rsi retire <id>             永久移除（这个原因不再重新学）
dsh-rsi rollback <id>           回到修订前的版本
dsh-rsi scope <id> global|<dir> 修改作用范围
dsh-rsi log [-n 20]             系统做过的决定
dsh-rsi mine <session.jsonl>    对历史会话跑一遍判断点；加 --adapt 生成待批准的适配

dsh-rsi project [目录]          仓库的项目 Harness 里有什么，本机接受了哪些
dsh-rsi project init [目录]     建立 <仓库>/.dsh-rsi
dsh-rsi project add <id>        把一个学到的适配写进项目 Harness
dsh-rsi project remove <名字>   从项目 Harness 里删掉一个文件
dsh-rsi trust | untrust [目录]  接受 / 不再接受项目 Harness 的文件
dsh-rsi export [id...] [-o 文件] [--layer 层]
dsh-rsi import <文件> [--scope global|<目录>] [--trust]
```

这个命令随插件一起装在 profile 自己的 `node_modules` 里：`$DSH_HOME/profiles/<profile>/node_modules/.bin/dsh-rsi`，未设置 `DSH_HOME` 时，Web 界面对应的是 `~/.dsh/profiles/web/node_modules/.bin/dsh-rsi`。在本仓库的检出目录里，`npm run rsi -- <命令>` 运行的是同一个文件。

在会话里输入 `/rsi` 可以看到同样的信息里和当前会话有关的部分。

`status` 里的 SECOND-HIT 是核心指标：装上适配之前和之后，有多大比例的会话里这个摩擦还会出现。

<a id="configuration"></a>

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `mode` | `adapt` | `observe` 只记录；`propose` 生成但等批准；`adapt` 直接挂载 |
| `autonomy` | `tighten` | `tighten`：改写结果、加工具、执行命令的适配要批准；`full`：都不用 |
| `generator` | `model-then-synth` | 谁来写适配：`model`、`synth`（内置模板）、或模型优先模板兜底 |
| `maxRepairs` | `2` | 被校验关打回后最多重写几次 |
| `generatorTimeoutMs` | `120000` | 一次生成请求的时限 |
| `provider` / `model` | 会话当前模型 | 用另一个模型来写适配（两个要一起设） |
| `scope` | `workspace` | 新适配先作用于当前工作区还是全机（`user` 层始终全机） |
| `layers` | 三层全开 | 启用哪些层：`machine`、`user`、`project` |
| `projectHarness` | `auto` | 项目层适配是否自动写进 `<仓库>/.dsh-rsi`：`auto`、`manual`、`off` |
| `projectTrust` | `ask` | 仓库里的适配文件要先 `dsh-rsi trust` 才运行（`ask`），还是直接运行（`always`） |
| `announce` | `true` | Harness 改了自己之后是否告诉模型 |
| `signals` | 见 `src/signals.js` | 各判断点的阈值 |
| `disabledDetectors` | `[]` | 关掉哪些判断点 |
| `policy` | 见 `src/trigger.js` | 触发阈值、每会话上限、修订条件等 |
| `home` | `$DSH_HOME/rsi` | 适配库位置 |

配置写错（未知的阈值名、不存在的判断点、非法的 `mode`）时插件拒绝加载并在启动时报出原因，Harness 本身照常运行。

<a id="what-the-model-sees"></a>

## 对模型可见的东西

没有摩擦、没有已挂载适配时，插件对模型完全不可见：系统提示词、工具列表、消息逐字节不变（有端到端用例守着）。

有适配时，模型可能看到：以 `[harness adaptation: <标题>]` 开头的说明（作为带 `dsh-rsi` 来源标记的消息写进会话日志）、被拒绝的工具调用的原因、系统提示词里多出的常驻段、新增的工具。写适配的那次模型请求不进入会话日志，记在适配库的审计记录里。

<a id="known-limits"></a>

## 已知限制

- 新增的**工具**要到下一次模型请求才可见（DSH 在步骤边界之前就组装好了本次请求的工具列表），对应的通知也推迟到那时。说明、拒绝、拦截、常驻提示词段的通知是当步生效的。
- 写一个适配要等模型一次完整应答。实测 `mimo-v2.6-pro` 上是 30–60 秒，期间这一步是停住的；并发压力下出现过一次超时，由内置模板接手。
- 判断点是启发式的。“有没有验证”靠的是“改完之后有没有运行过程序”，`npm install` 这种也会被算作验证过。
- `negative-feedback`、`approval-denied`、`context-pressure`、`model-instability` 只用构造的事件测过，没有在真实会话里触发过。
- 端到端自动化用例跑在 `headless` profile 上，另有一条用例把打好的包装进 `web` profile 并确认页面加载了界面部分。界面本身是在真实的 `dsh web` 页面里用无头浏览器手工走查的（亮色和暗色），没有自动化的浏览器用例。
- 开发用的机器上没有安装桌面 App，**没有在真实的桌面 App 里验证过**。它包的是同一套 Web 页面和同一套安装机制，按文档应当一致；ACP 和 SDK profile 没有界面，也没有验证。
- 项目 Harness 的“信任”认的是文件内容的哈希，防的是“克隆下来就自动执行”。它不审查代码好坏：`dsh-rsi trust` 之前请自己读一遍那些文件。
- 界面文字目前只有英文和中文。
- 钉在 DSH `0.2.2-rc.3`（开发者预览版）上，它的扩展点还在变。

<a id="license"></a>

## 许可证

[MIT](LICENSE)
