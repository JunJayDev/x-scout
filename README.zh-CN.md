[English](README.md) · **中文**

# x-scout

让 AI Agent 免登录读取 X（Twitter）帖子、搜索话题、访问个人主页。

[![CI](https://github.com/JunJayDev/x-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/JunJayDev/x-scout/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

x-scout 提供 CLI、MCP 工具和可独立使用的 Agent skill。打开帖子、用一条查询搜索，或者查看账号资料和最近发帖即可，不要求先评分或审查作者。读取免费且不需要 key；搜索使用 xAI 的 Grok，需要 API key。

```bash
x-scout read https://x.com/jack/status/20
x-scout search "bun 1.3 production"
x-scout read @jack --posts 10
```

支持本地 CLI、stdio MCP、Claude Code 插件，也可部署到自己的 Cloudflare Worker 供远程客户端使用。没有运行时依赖。用户需要深入分析账号时，可选用 `x_audit` 获取账号统计。

## 安装

你可以直接交给 Agent 自动安装：对它说「按 https://github.com/JunJayDev/x-scout/blob/main/INSTALL.md 安装 x-scout」。

按客户端选择安装路径：
- **Claude Code**：安装插件，包含工具与 skill，自动管理可选的 xAI key。
- **Codex**：添加 MCP 服务器运行工具，通过插件市场安装 skill。
- **Cursor、VS Code、Claude Desktop 及其他 MCP 客户端**：配置 stdio MCP 服务器。
- **claude.ai、ChatGPT 与手机端**：一条命令部署远程 Cloudflare Worker。
- **仅支持 skill 的 Agent**：直接复制独立的 skill 目录。

<details>
<summary>Claude Code</summary>

安装插件（打包 skill 与 MCP 服务器，提示输入可选的 xAI key 并存入系统钥匙串）：

```bash
/plugin install x-scout --marketplace JunJayDev/x-scout
```

Claude Code 2.1.275 之前的版本：

```bash
/plugin marketplace add JunJayDev/x-scout
/plugin install x-scout@x-scout
```

或者不装插件，仅添加 MCP 服务器：

```bash
claude mcp add x-scout -- npx -y github:JunJayDev/x-scout mcp
```

</details>

<details>
<summary>Codex</summary>

添加 MCP 工具服务器：

```bash
codex mcp add x-scout -- npx -y github:JunJayDev/x-scout mcp
```

通过插件市场添加 skill：

```bash
codex plugin marketplace add JunJayDev/x-scout
```

然后在插件列表中安装 `x-scout`。

</details>

<details>
<summary>Cursor</summary>

添加到 `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "x-scout": {
      "command": "npx",
      "args": ["-y", "github:JunJayDev/x-scout", "mcp"]
    }
  }
}
```

开启搜索时，在 `x-scout` 配置内加入 `"env": {"XAI_API_KEY": "xai-..."}`。

</details>

<details>
<summary>VS Code</summary>

添加到 `.vscode/mcp.json`：

```json
{
  "servers": {
    "x-scout": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:JunJayDev/x-scout", "mcp"]
    }
  }
}
```

</details>

<details>
<summary>Claude Desktop 及其他 MCP 客户端</summary>

支持 stdio MCP 的客户端通用配置（命令 `npx`，参数 `["-y", "github:JunJayDev/x-scout", "mcp"]`）：

```json
{
  "mcpServers": {
    "x-scout": {
      "command": "npx",
      "args": ["-y", "github:JunJayDev/x-scout", "mcp"]
    }
  }
}
```

开启搜索时，在配置内加入 `"env": {"XAI_API_KEY": "xai-..."}`。需要 Node 18 或更新版本。

</details>

<details>
<summary>claude.ai、ChatGPT 与手机端（远程部署）</summary>

部署远程 MCP 服务器到你自己的 Cloudflare 账号（免费套餐即可）：

```bash
npx -y github:JunJayDev/x-scout deploy
```

首次运行会自动打开浏览器登录 Cloudflare。命令完成 Worker 部署，通过 stdin 写入密钥，完成公网可用性检查，并输出连接器地址：
`https://x-scout.<your-subdomain>.workers.dev/mcp/<token>`

在 claude.ai 中添加为自定义连接器，或在 ChatGPT 的开发者模式中添加为连接器，客户端无需登录。在网页端配置后会自动同步到手机 App。

加 `--rotate` 参数可生成新地址，加 `--check` 可重新测试连通性。更新密钥后重新运行 `deploy` 即可。

</details>

<details>
<summary>仅安装 skill</summary>

将 [`skills/x-scout/`](skills/x-scout/) 复制到 Agent 的 skills 目录（`~/.claude/skills/`、`~/.codex/skills/` 或 `.agents/skills/`）。该目录完全自包含：Agent 依靠 Node 18 或更高版本直接运行 `node scripts/x-scout.mjs <命令>`，无需安装依赖。

</details>

### 开启搜索

读取和审查账号开箱即用。如需开启语义搜索：

1. 在 [console.x.ai](https://console.x.ai) 申请 API key。
2. 保存 key 并检查：

```bash
npx -y github:JunJayDev/x-scout setup      # 保存到 ~/.config/x-scout/config.env（权限 600）
npx -y github:JunJayDev/x-scout doctor     # 检查 key 与各读取数据源
```

也可以在环境中设置 `XAI_API_KEY`。重新运行 `deploy` 会将密钥同步至远程 Worker。

未配置 key 时，读取与账号审查功能依然可用，skill 会自动回退到网络搜索（`site:x.com ...`）配合 `x_read`。

高级选项：`setup --base-url <url>`（或 `XAI_API_BASE`）支持对接兼容 xAI Responses API 的端点；`XAI_MODEL` 指定模型（默认 `grok-4.7`）。`SEARCH_TIMEOUT_S` 设置单条查询最长等待秒数（默认 120）；3 条查询实测用了 3.5 分钟，查询显示 `FAILED, not searched` 时调大它。`deploy` 会把这些设置同步给远程服务器。

## 快速上手

全局安装 CLI：

```bash
npm install -g https://github.com/JunJayDev/x-scout/archive/refs/heads/main.tar.gz
```

或直接执行 `npx -y github:JunJayDev/x-scout <命令>`。

```bash
x-scout read https://x.com/karpathy/status/2039805659525644595
x-scout read <帖子链接> --replies --max-replies 30      # 纠错与补充讨论通常在回复中
x-scout read @handle --posts 30
x-scout audit @handle
x-scout search "bun 1.3 production" "migrated from node to bun" --from 2026-09-01
x-scout search "remotion agent" "AI 视频 剪辑 agent" --handle remotion --json      # 每种语言各写一条查询
```

`x-scout read` 实际输出：

```text
[1] @karpathy · Andrej Karpathy · 2026-04-02 20:42Z
https://x.com/karpathy/status/2039805659525644595
22M views · 61k likes · 2.9k replies · 7.4k reposts · 2.2k quotes · 108k bookmarks

LLM Knowledge Bases
...
```

## 工具列表

| 工具 | 作用 | Key |
|---|---|---|
| `x_read` | 1 到 10 个帖子链接、帖子 ID、主页链接或 @handle。`mode` 可选 `post`、`thread`、`replies`。主页最多带 100 条最近的帖子。可选翻译。 | 不需要 |
| `x_search` | 1 到 5 条查询，默认返回链接、作者、日期和搜索摘要。支持日期范围（含当天）、最多 20 个限定或排除账号、图片和视频理解，单条查询最多 20 条结果。`verify: true` 可额外加载最多 20 条帖子全文。 | `XAI_API_KEY` |
| `x_audit` | 一个账号最近 10 到 100 条帖子：发帖频率、构成、原创浏览的中位数和 p90、每千粉丝点赞数、save 和 talk 比值、外链占比、爆款倍数、按浏览和按收藏排序的帖子、X 的「关于此账号」信息和提示。 | 不需要 |

三个工具均支持 `format: "json"` 参数以获取结构化数据。

默认文本保留帖子内容和互动计数，省去分析比率及正常情况下的数据源说明；降级读取、截断和不完整内容仍会提示。线程中的目标帖只显示一次。完整元数据可通过 `--json` 获取。

需要分析时，可通过库导出的 `postSignals(post)` 计算：
- `save`：收藏 / 点赞（反映留存价值与实用性）
- `talk`：回复 / 点赞（回复多但收藏少通常提示争议或钓互动）
- `spread`：（转发 + 引用）/ 点赞（扩散速率）
- `eng`：互动总量 / 浏览量（互动密度）

## Agent 使用流程

[Skill](skills/x-scout/SKILL.md) 从用户的实际请求出发：

1. 有链接就用 `x_read` 打开，需要搜索就先执行一条 `x_search` 查询。
2. 返回有用的内容和原帖链接。浏览结果时，搜索摘要即可；需要全文、准确引用、线程或回复时，再读取选中的帖子。
3. 请求已回答就结束。只有任务需要时，才增加查询、分析账号或记录来源。

查看主页默认返回简介、统计数据和最近 20 条帖子。只看资料可设 `profile_posts: 0`（CLI 为 `--posts 0`），也可以指定最多 100 条帖子。

搜索默认不再逐条抓取结果。如需一次取得全文和互动数据，可设 `verify: true`（CLI 为 `--verify`），额外读取最多 20 条帖子。原有 `--no-verify` 参数仍可用。这里的读取只用于取得内容，不判断帖子中的说法是否属实。

账号和草稿分析仍有可选参考：[判断方法](skills/x-scout/references/judging.md)、[指标说明](skills/x-scout/references/signals.md)、[推荐代码说明](skills/x-scout/references/x-algorithm.md)。普通浏览不需要执行这些步骤。

**只读操作：** x-scout 不登录 X，不点赞、关注、回复或发帖。它提供链接，由用户决定后续操作。见[平台规则](skills/x-scout/references/x-rules.md)。

## 费用说明

| 项目 | 费用 |
|---|---|
| 读取与审查 | 免费。使用公开服务；FxTwitter 允许每个 IP 每分钟 1,000 次请求。 |
| 搜索 | xAI 按模型抓取的帖子收费，约每 1,000 条 5 美元，另加 token 费用。每条查询最多 2 轮搜索，通常抓取 10 到 60 条帖子（耗时约 30 秒至 2.5 分钟）。输出会注明抓取帖数。 |
| 远程服务器 | Cloudflare Workers 免费套餐：每天 100,000 次请求。 |
| Token 消耗 | 短帖低于 100 token；账号审查约 600 至 1,000 token。 |

## 能力边界

- 读取依赖第三方公开服务（FxTwitter、vxTwitter）及 X 官方嵌入接口。回退数据源缺少浏览量和收藏量，X 嵌入接口会截断长帖。
- 回复获取受限：被隐藏、受保护及已删除的回复无法获取。
- 搜索摘要来自 Grok，可能不完整或经过转述。需要准确措辞时再读取选中的原帖；全文加载是可选操作。
- 不读 For You 推荐流、通知和私信，也不在 X 上做任何操作。这是有意的设计。
- 评估体系是面向 Agent 的方法论，并非绝对分类器。如遇误判可通过 [判断问题模板](.github/ISSUE_TEMPLATE/judging.md) 反馈。

## 作为库使用

安装：

```bash
npm install github:JunJayDev/x-scout
```

```javascript
import { makeContext, runRead, runAudit } from "x-scout";

const ctx = makeContext(process.env);
const { items } = await runRead({ targets: ["https://x.com/jack/status/20"] }, ctx);
```

`x-scout/worker` 导出 Cloudflare Worker 处理函数，方便自行托管。

## 相关项目

- [FxEmbed](https://github.com/FxEmbed/FxEmbed)（FxTwitter）：主要读取源，大用量建议自建。
- [x-reader](https://github.com/runesleo/x-reader) 与 [x-md](https://github.com/pc-style/x-md)：Agent 阅读工具与 skill；x-md 通过自建账号池提供免 key 搜索；x-reader 启发了 [INSTALL.md](INSTALL.md)。
- [Agent-Reach](https://github.com/Panniantong/Agent-Reach)：多平台阅读工具。其 X 搜索依赖用户账号 cookie；x-scout 不触碰用户账号。
- [twitterapi.io MCP](https://github.com/kaitoInfra/twitterapi-io-mcp-server)：商业 X 数据 API，适合大批量读取。
- [bangermeter](https://github.com/itsryanlenk/bangermeter)：对照 X 开源权重计算传播潜力。x-scout 仅记录传播指标，对实质价值打分。
- [twag](https://github.com/clifton/twag)：LLM 分诊推文，对观点复述封顶，维护账号滚动平均。
- [bullshit-detector](https://github.com/SerhiiKorniienko/bullshit-detector)：逐项核对主张，本项目的评分表参考了其两项核心提问。
- [Bouncer](https://github.com/imbue-ai/bouncer)：以自然语言规则过滤信息流。作用于时间线；x-scout 用于回答具体问题。

属于「Agent 媒介素养」系列。[github-scout](https://github.com/JunJayDev/github-scout) 在 GitHub 上运用相同思路：在 Agent 动手写代码前，先检索开源领域已有方案。

## 参与贡献

欢迎提交 issue 和 pull request，见 [CONTRIBUTING.md](CONTRIBUTING.md)。测试支持离线运行：`node --test`。

## 开源协议

MIT，见 [LICENSE](LICENSE)。
