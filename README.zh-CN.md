# signal-first

**agent 打不开 x.com；在 X 上搜东西，搜到的是声音最大的那几条。signal-first 让 agent 能读任何 X 链接，按意思搜 X 并逐条回 X 核对，再按「有没有用」而不是「传得多远」判断帖子和账号。**

signal-first 是一个 agent skill，带三个工具：`x_read`、`x_search` 和 `x_audit`。它可以作为 Claude Code 插件安装，可以作为本地 MCP 服务器接入任何客户端，可以当命令行用，也可以一条命令部署到你自己的 Cloudflare 账号，在 claude.ai、ChatGPT 和手机上用。读取不需要 key，也不需要 X 账号；搜索需要一个 xAI API key。

[English](README.md)

## 为什么做

在 X 上，做东西的人常常最先发声：维护者解释 bug，创始人公开真实数字，研究者在论文之前先发图。同一条信息流里，也挤满了靠钩子、互关圈、搬运串推和 AI 垃圾内容换来的流量。

agent 在这两头都吃亏。x.com 要登录、要运行 JavaScript，agent 根本读不了。即使通过网页搜索或搜索模型找到了帖子，agent 也会把传得最远的当成最重要的，把搜索模型的概括当成原帖来引用。

X 开源的推荐代码说明了传播和价值为什么会分开。回复的权重是 5，复制链接是 20，点赞是 0.66。收藏最能说明一条帖子值得留下，它的权重是 0（[详情](skills/signal-first/references/x-algorithm.md)）。传得远的，是让人有反应的内容；有用的，是让人存下来的内容。

放到一个账号上，差别是这样的：

```text
$ signal-first audit @karpathy
@karpathy · Andrej Karpathy · verified
4.4M followers · following 1.1k · 10k posts · joined 2009-04-21
originals: 51 (2026-02-24 → 2026-10-11) · median views 1.4M (p90 7.8M) · save 0.61 · talk 0.05 · 31 long posts

top by views:
- 67M views · 28k likes · 47.7x median · 2026-03-24
  Software horror: litellm PyPI supply chain attack. Simple `pip install litellm` was enough to ...
top by saves (bookmarks/likes):
- 22M views · 61k likes · save 1.78 · 2026-04-02
  LLM Knowledge Bases Something I'm finding very useful recently: using LLMs to build personal ...
```

传得最远的一条是新闻。被存下来最多的一条是方法，收藏比赞还多。按浏览量排序的 agent 会读第一条；想学东西的 agent 应该读第二条。

## 和同类有什么不同

- **不登录就能读 X。** 帖子全文和各项计数（浏览、点赞、回复、转发、引用、收藏），串推、回复、被引用的帖子、投票、社区笔记和 X Article 全文；账号资料和最近的帖子。三个公开数据源依次回退，每条结果都写明来自哪个数据源、回退后缺了什么。
- **搜索结果只是线索，不当原文引用。** `x_search` 调用 Grok 的 `x_search` 工具，再把每一条结果回 X 重读一遍。正文、作者、时间和计数都取自帖子本身。X 上核对不到的结果保留在答案里，标为「未核实」，搜索模型的原话单独标出。
- **两个分数，不合成一个。** skill 分开判断价值（是否亲历、是否具体、能否核对、是否新、是否有用）和传播（浏览、扩散），并点出问题：钓互动、搬运清单、借流量、AI 垃圾内容。每条帖子带三个比值：`save`（收藏 / 赞）、`talk`（回复 / 赞）和 `spread`（每个赞对应的转发加引用）。
- **账号和它自己比。** `x_audit` 分别读取一个账号的原创和回复，把每条帖子和这个账号自己的中位数比较，而不是和大号比较。爆过一条，不等于一直值得看。
- **只建议，不动手。** X 禁止自动点赞、批量关注，以及未经批准的 AI 回复机器人。signal-first 不登录、不碰你的账号，只给出链接，由你自己点。
- **为 agent 阅读而写。** 工具输出是紧凑文本：不输出空字段，数字缩写，帖子正文原样保留。需要 JSON 时加一个参数即可。

## 安装

任选一种。这些步骤都可以交给 agent 完成，对它说：「按 https://github.com/<owner>/signal-first/blob/main/INSTALL.md 安装 signal-first」。需要人做的只有两件事：粘贴 xAI key（可选）；部署远程服务器时，在 Cloudflare 页面点一次「Allow」。

**Claude Code 插件**（skill 和工具一起装）

```
/plugin install signal-first --marketplace <owner>/signal-first
```

Claude Code 低于 2.1.275 时：先运行 `/plugin marketplace add <owner>/signal-first`，再运行 `/plugin install signal-first@signal-first`。插件会询问一个可选的 xAI key，并把它存进系统钥匙串。

**Codex 插件**（skill）：运行 `codex plugin marketplace add <owner>/signal-first`，再从插件列表安装 signal-first。工具部分按下面的方式添加 MCP 服务器。

**任意 MCP 客户端**（Codex、Cursor、Claude Desktop、不装插件的 Claude Code 等）

```bash
claude mcp add signal-first -- npx -y signal-first mcp      # Claude Code
codex mcp add signal-first -- npx -y signal-first mcp       # Codex
```

其他客户端：命令填 `npx`，参数填 `-y signal-first mcp`。需要 Node 18 或更新版本。

**只装 skill。** 把 [`skills/signal-first/`](skills/signal-first/) 复制到 agent 的 skills 目录（`~/.claude/skills/`、`.agents/skills/` 等）。这个目录是自包含的：agent 在其中运行 `node scripts/signal-first.mjs <命令>`，不需要安装任何东西。

**claude.ai、ChatGPT、手机**（部署在你自己 Cloudflare 账号上的远程 MCP 服务器，免费套餐即可）

```bash
npx -y signal-first deploy
```

这条命令会登录 Cloudflare（只在第一次打开浏览器），部署 Worker，通过 stdin 上传密钥，从公网地址测试服务器，最后打印连接器地址。在 claude.ai 中把它添加为自定义连接器，或在 ChatGPT 的开发者模式中添加为连接器，不需要登录。在网页端添加的连接器，手机 App 里也能用。`--rotate` 生成新地址；`--check` 重新测试。

**开启搜索**（可选）：在 [console.x.ai](https://console.x.ai) 申请 API key，然后运行：

```bash
npx -y signal-first setup      # 保存到 ~/.config/signal-first/config.env（权限 600）
npx -y signal-first doctor     # 检查 key 和每个读取数据源
```

也可以在环境变量中设置 `XAI_API_KEY`。要让远程服务器也能搜索，再运行一次 `deploy`。

## 快速上手

```bash
signal-first read https://x.com/karpathy/status/2039805659525644595
signal-first read <帖子链接> --replies --max-replies 30      # 纠错常常在回复里
signal-first read @handle --posts 30
signal-first audit @handle
signal-first search "bun 1.3 production" "migrated from node to bun" --from 2026-09-01
signal-first search "remotion agent" "AI 视频 剪辑 agent" --handle remotion --json
```

读一条帖子的输出：

```text
[1] @karpathy · Andrej Karpathy · 4.4M followers · 2026-04-02 20:42Z
https://x.com/karpathy/status/2039805659525644595
22M views · 61k likes · 2.9k replies · 7.4k reposts · 2.2k quotes · 108k bookmarks
signals: save 1.78 · talk 0.05 · spread 0.16 · eng 0.83%

LLM Knowledge Bases
...
```

## 工具

| 工具 | 作用 | key |
|---|---|---|
| `x_read` | 1 到 10 个帖子链接、帖子 id、主页链接或 @handle。`mode` 可选 `post`、`thread`、`replies`。主页最多带 100 条最近的帖子。可选翻译。 | 不需要 |
| `x_search` | 2 到 5 条查询；`from_date` 和 `to_date`（含当天）；最多 20 个限定或排除的账号；图片和视频理解。每条结果都回 X 重读。 | `XAI_API_KEY` |
| `x_audit` | 一个账号最近 10 到 100 条帖子：发帖频率、构成、原创浏览的中位数和 p90、每千粉丝点赞数、save 和 talk、外链占比、爆款倍数、按浏览和按收藏排序的帖子、X 的「关于此账号」信息和提示。 | 不需要 |

三个工具都接受 `format: "json"`，返回完整结构。skill（[`SKILL.md`](skills/signal-first/SKILL.md)）告诉 agent 什么时候用哪个工具、怎么写查询、怎么判断返回的内容。

## 怎么判断

skill 的流程：先想清楚谁会有第一手信息；按好帖子的写法去搜（产品名、版本、数字，每种语言都搜）；读原帖，包括回复；分开判断价值和传播；引用一个账号之前先查它；回答时写明链接、作者和日期；把结论记进一个来源文件。细节都不长：

- [judging.md](skills/signal-first/references/judging.md)：价值评分表、问题清单、账号结论。
- [signals.md](skills/signal-first/references/signals.md)：每个数字是什么意思，什么时候会误导。
- [x-algorithm.md](skills/signal-first/references/x-algorithm.md)：X 推荐代码奖励什么，按文件核对。
- [x-rules.md](skills/signal-first/references/x-rules.md)：X 禁止自动化工具做什么。

同一套判断也用于你自己的草稿：skill 先查价值，再对照 X 代码已知的偏好检查传播，草稿是在钓互动时会直接指出。

## 费用

| | 费用 |
|---|---|
| 读取和查账号 | 免费。使用公开服务；FxTwitter 允许每个 IP 每分钟 1,000 次请求。 |
| 搜索 | xAI 按其模型抓取的帖子收费，约每 1,000 条 5 美元，另加 token。每条查询最多 2 轮搜索，输出会报告抓取了多少条帖子。 |
| 远程服务器 | Cloudflare Workers 免费套餐：每天 100,000 次请求。 |
| token | 一条短帖不到 100 个 token；长帖和 X Article 大致等于正文长度；一次账号检查约 600 到 1,000 个 token。 |

## 限制

- 读取依赖别人运营的公开服务（FxTwitter、vxTwitter）和 X 的嵌入接口，任何一个都可能失效或关闭；回退对单条帖子最有效。FxTwitter 自己的搜索从 2026-10-09 起一直不可用，所以搜索走 xAI。
- 回退数据源没有浏览数和收藏数，X 的嵌入接口会截断长帖。输出会写明。
- 能拿到的回复比 X 显示的少：被隐藏、受保护和已删除的回复拿不到。
- 搜索质量取决于 Grok，每次结果会有差异，所以每条结果都要核对。
- 没有 For You 信息流、通知和私信，也不在 X 上执行任何操作，这是有意的设计。
- 判断是给 agent 的方法，不是分类器，可能出错。遇到这种情况请用 [判断问题模板](.github/ISSUE_TEMPLATE/judging.md) 提交。

## 作为库使用

```js
import { makeContext, runRead, runAudit } from "signal-first";
const ctx = makeContext(process.env);
const { items } = await runRead({ targets: ["https://x.com/jack/status/20"] }, ctx);
```

`signal-first/worker` 导出 Cloudflare Worker，方便自己托管。

## 相关项目

给 agent 读 X 的工具不少，判断读到的内容的工具很少。signal-first 把价值和传播分开，把每条搜索结果回 X 核对，把账号和它自己的基线比较，并用同一套判断检查你的草稿。星标数截至 2026-10-15。

- [FxEmbed](https://github.com/FxEmbed/FxEmbed)（FxTwitter）：本项目主要的读取数据源。用量大时，维护者建议自建。
- [x-reader](https://github.com/runesleo/x-reader) 和 [x-md](https://github.com/pc-style/x-md)：给 agent 读 X（以及其他平台），带 MCP 服务器和 skill。x-md 还通过自己运营的账号池提供免 key 搜索；x-reader 给 agent 写的安装说明启发了 [INSTALL.md](INSTALL.md)。
- [Agent-Reach](https://github.com/Panniantong/Agent-Reach)：一次安装读取多个平台。它的 X 搜索使用你自己的 X cookie；signal-first 不碰你的账号。
- [twitterapi.io MCP](https://github.com/kaitoInfra/twitterapi-io-mcp-server)：付费的 X 数据 API，带读取工具，适合大量读取。
- [bangermeter](https://github.com/itsryanlenk/bangermeter)：用 X 公开的权重给帖子的传播打分，并引用源码行。signal-first 只描述传播，给价值打分。
- [twag](https://github.com/clifton/twag)：用 LLM 给推文分诊，分数有上限（复述已知观点会被封顶），账号保留滚动平均。
- [bullshit-detector](https://github.com/SerhiiKorniienko/bullshit-detector)：逐条核查文本中的主张。评分表借用了它的两个问题：作者在卖什么；哪些主张撑起了这条帖子。
- [Bouncer](https://github.com/imbue-ai/bouncer)：用你自己用大白话写的类别过滤信息流。它作用于时间线；signal-first 用来回答问题。

signal-first 属于「agent 媒介素养」系列。[reuse-first](https://github.com/<owner>/reuse-first) 用同样的思路处理 GitHub：agent 动手做之前，先找开源世界已经解决了什么。

## 参与贡献

欢迎提交 issue 和 pull request，见 [CONTRIBUTING.md](CONTRIBUTING.md)。测试离线运行：`node --test`。

## 许可证

MIT，见 [LICENSE](LICENSE)。
