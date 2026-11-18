# dsh-memory-harness

> **让 DeepSeek Harness 真正记住你：跨会话、能纠错、越用越准。**
>
> 不是再存一份聊天记录，而是把值得留下的偏好、决策、项目事实和踩过的坑，变成下次会主动想起的记忆。

[![CI](https://github.com/yeweimei/dsh-memory-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/yeweimei/dsh-memory-harness/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/yeweimei/dsh-memory-harness)](https://github.com/yeweimei/dsh-memory-harness/releases)

它解决的是一个很具体的问题：

- 你上周说过的偏好，这周还要再说一遍；
- 项目里已经踩过的坑，换个会话又踩一次；
- 旧决定早就变了，Agent 还在按旧版本执行；
- 记忆越存越多，但真正需要时召回不准。

`dsh-memory-harness` 把这些记忆保存在本机 SQLite 里，用向量 + 关键词 + 图混合检索，在会话开始和需要时主动带回；你可以评价、纠错、处理过时和冲突，让下一次召回更贴近当前对话。

## 一眼看懂

| 它会记住 | 它什么时候想起 | 你怎么控制 |
|---|---|---|
| 偏好、项目约定、决策、已知坑、任务状态 | 新会话注入；首轮主动召回；工具失败提示；`memory` 工具检索 | 评价召回结果；在面板里编辑/归档/复核；处理冲突和过期 |

## 前置条件

| 要求 | 说明 |
|---|---|
| **DeepSeek Harness 0.2.x** | 当前在 `0.2.2-rc.1` 上验证 |
| **Node.js ≥ 22.5** | 使用 Node 内置 `node:sqlite`；没有 native 依赖 |
| **pnpm** | 命令行 `dsh plugin add` 需要；用 Plugin Manager 安装可跳过 |
| **OpenAI 兼容的 Embedding 服务** | 需要 `/embeddings` 接口、模型名、维度；API Key 可选 |
| **LLM（可选）** | 自动抽取/准入/冲突判定用；留空时回退到 DSH 默认模型，不需要额外 Key |
| **本机可写目录** | 默认 `~/.dsh/memory`，备份在 `~/.dsh/memory/backups` |

> 插件本身没有 npm 运行时依赖；模型地址和 API Key 默认都为空，安装后在设置页填写。
>
> 桌面端使用同一套 Host/Web 架构，但需要桌面端内置 Node ≥ 22.5；目前尚未在桌面端实机验证。

## 快速上手（约 5 分钟）

### 1. 安装

从 GitHub 安装：

```bash
dsh plugin --profile web add github:yeweimei/dsh-memory-harness
```

或从 [Releases](https://github.com/yeweimei/dsh-memory-harness/releases) 下载 `dsh-memory-harness-0.19.2.tgz`：

```bash
dsh plugin --profile web add "file:/绝对路径/dsh-memory-harness-0.19.2.tgz"
```

也可以使用 DSH 的 Plugin Manager 安装 `dsh-memory-harness`。

### 2. 刷新或重启 DSH

让插件 Host/Client 重新加载，然后打开 **设置 → 记忆**。

### 3. 配置 Embedding

填你自己的：

- Base URL，例如 `https://embedding.example.com/v1`（输入框里只是示例）
- 模型名
- 维度
- API Key（如果服务需要）

保存后设置即时生效；面板会显示 embedding 健康状态。Embedding 没配好时，插件仍能保存记忆，只是暂时没有语义向量，检索会退回关键词。

### 4. 配置 LLM（可选）

自动抽取、自动准入、冲突判定需要 LLM：

- **不填**：使用 DSH 当前默认模型；
- **填 OpenAI 兼容 endpoint + model**：使用你指定的快速模型。

不想自动捕获可以只使用手动 `memory` 工具和 `/remember`。

### 5. 开始使用

- 侧栏打开「记忆」面板，浏览、搜索、编辑、归档记忆；
- 直接对 Agent 说“记住……”或使用 `/remember ...`；
- Agent 会通过 `memory` 工具主动保存和检索；
- 首轮对话默认会做一次上下文主动召回，出现评价浮层时可以给反馈。

### 6. 确认状态

在「诊断」标签确认：

- embedding 正常；
- `待补向量` 为 0（如果不是，见下面 FAQ）；
- 最近事件和召回质量有数据。

## 日常怎么用

- **记东西**：让 Agent 调用 `memory action=save`，或用户执行 `/remember`；不需要手动整理格式。
- **找东西**：Agent 自动检索；你也可以 `/memory search <关键词>` 或在侧栏面板搜索。
- **评价召回**：召回浮层分「本次相关」和「记忆本身」两轴；提交后 10 秒内可撤销。
- **处理问题记忆**：面板「复核」里可以处理过时、错误、重复和冲突；「矛盾」默认交给你决定，不会静默删除。
- **有效期**：保存时带 `validUntil` 的记忆到期后会进入复核，而不是直接消失。
- **备份/迁移**：面板/诊断支持备份和 JSON 导出；数据始终在本机。

## 常见问题

**“待补向量”很多，是不是记忆丢了？**  
不是。向量存在数据库里；这个数字表示内存索引暂时没加载或模型/维度不匹配。先确认 embedding 设置；模型没变时可以在诊断页点「重建向量索引」。

**没有配置 LLM 会怎样？**  
抽取、自动准入和冲突判定会回退到 DSH 默认模型；默认模型不可用时，规则捕获、手动保存、失败提示仍然可用。

**API Key 会写进数据库或仓库吗？**  
不会。Key 存在 Harness 凭证记录里；配置文件和数据库都不保存明文 Key。

**会给记忆库上传聊天记录吗？**  
不会整段上传。语义检索只发送 query 到 embedding 服务；冲突判定在启用时会把新/旧记忆和最近对话片段发送到你配置的 LLM（或 DSH 默认模型）。

**数据在哪里？**  
默认 `~/.dsh/memory/memory.db`；备份在 `~/.dsh/memory/backups/`。

## 进阶功能

以下内容面向想深入了解或自行扩展的用户；日常使用不需要读完。

## 自动捕获与 LLM 自动准入

默认 **规则 + LLM + 自动准入**：自动产生的条目先以「候选」形式落库，随后由**插件配置的 LLM**（与抽取同一 provider）按专门的准入提示词逐条判断 `add`（进入记忆）/ `update`（取代一条相似旧记忆）/ `skip`（丢弃），**无需人工确认**。低置信度、判定失败或预算耗尽时候选会留在「待确认」标签里，可手动接受/忽略；面板保留人工覆盖能力。

| 信号 | 层级 | 动作 |
|---|---|---|
| 用户消息命中纠错/强调词（记住、以后别、踩坑、教训、gotcha…） | 规则 | 生成候选（不调用模型） |
| 工具调用失败 | 规则 | 立即用错误签名召回已知坑，并把提示追加到工具结果；同时把会话标记为待抽取 |
| 回合结束（发生过失败/纠错，或每 N 回合） | LLM | 一次结构化抽取：pitfall/decision/preference/project facts → 候选 |
| 定时扫描项目会话（默认 30 分钟） | LLM | 从上次水位之后的新事件抽取；滚动更新项目摘要 → 候选 |
| 候选落库后 | LLM 准入 | 读候选 + 相似 active 记忆，输出 add/update/skip；`add` 直接生效，`update` 把旧记忆标为 superseded |

- 失败提示形如：`[memory] 已知同类坑：症状…；修复…（m_xxx，12 天前）`，同签名每会话最多提示 3 次。
- 候选字段：`kind`、`text`、`details.symptom/cause/fix`、`confidence`、`evidence.quote`、`source(rules|llm)`；LLM 条目必须能在会话原文中找到证据引用，否则丢弃。
- 准入提示词是独立的 curator prompt（`lib/admission.js`）：要求逐候选项返回 `add/update/skip`、类别/作用域/重要度、置信度、目标记忆 id 与理由；`update` 的 targetId 必须来自插件提供的相似记忆列表，模型幻觉出的 id 会被降级为 `add`；低于 `capture.admission.minConfidence`（默认 0.7）的条目由准入直接判为 `skip`（dismissed，可在归档/忽略里恢复）；只有 LLM 调用失败或输出无法解析时候选才会留在「待确认」。
- 准入默认开启，可配 `capture.admission.enabled`、`minConfidence`、`maxPerRun`（每轮最多几条）、`includeRules`（规则层候选是否也走准入）；每轮准入一次 LLM 调用，计入每日预算。
- 预算：设置页可配 `capture.mode`、`extractEveryTurns`、`dailyTokenBudget`、`candidateTtlDays`；周期扫描受 `periodic.maxExtractionsPerDay` 限制。
- 抽取模型（OpenAI 兼容 provider）：设置页填 **API URL / model / API Key / 上下文长度（tokens）/ 最大输出 / 超时**；API Key 存在凭证记录 `dsh-memory/extraction-api-key`，不落配置。留空 URL 或 model 时回退到当前会话默认模型；`extractDebounceMs` 把连续 dirty 回合合并成一次调用，`contextWindow` 决定送入抽取的 transcript 上限。
- 试跑评估：面板「试跑抽取」/ RPC `previewExtraction` 对最新项目会话做一次 dry-run，返回抽取条目、transcript 字符数与耗时，不写候选；设置页显示自动候选接受率（active / active+dismissed）。
- 面板操作：待确认条目可**编辑后接受**，也可接受 / 忽略 / 恢复；确认新项目摘要时会自动把旧摘要归档（`archived`，不再注入/检索）；「归档」标签展示 archived + superseded，可恢复；`/memory candidates|confirm <id>|dismiss <id>|archive <id>|restore <id>|history <id>|admit` 也可用。
- 自动准入运行入口：面板「运行准入」按钮、RPC `admitNow`、`/memory admit`。
- 面板新增「项目」标签：按工作目录展示项目摘要、最近已知坑与记忆数量。
- 记忆面板为独立滚动容器，列表分页（「加载更多」+ 滚动到底自动加载）；搜索结果为 top-N，不参与分页。
- 会话开头注入新增：项目摘要 + 最近 3 条工作区坑（可配 `inject.corePitfalls`）。

## 分层存储与修订历史

数据格式 v7 在原有记录上增加分层、生命周期、上下文反馈、内容复核、冲突与有效期字段：

| 概念 | 取值 | 说明 |
|---|---|---|
| `tier` | `working` / `semantic` / `episodic` | `scope=session` → working；`kind=summary` → episodic；其余 → semantic |
| `status` | `candidate` / `active` / `dismissed` / `superseded` / `archived` | 只有 `active` 参与检索、注入与失败提示 |
| `revision` | 整数 | 每次变更递增；`memory_revisions` 保存 JSON 快照（不含向量），默认每记忆保留最近 20 条 + 迁移基线 |
| `supersededBy` / `validFrom` / `archivedAt` | id / 时间戳 | 取代链与有效期 |
| `useCount` / `lastUsedAt` / `helpfulCount` | 计数 | core 注入、检索返回、失败提示命中时累计；当前只记录，不参与排序 |

- **更新**：`update` 覆盖写但保留旧快照；`supersede`/准入 `update` 不覆盖旧记忆，而是把旧记录置为 `superseded`，检索只取当前 active 版本。
- **修订历史**：`memory history <id>` / `memory action=history` / RPC `history`；`forget` 前也会留一条快照。
- **迁移**：旧库按 schema 版本逐级升级到 v7；升级前用 `VACUUM INTO` 备份到 `<dataDir>/backups/`，迁移在单事务内完成，失败回滚并报错。建议保留最近几份迁移备份。

## 整理、反馈与回滚

- **整理（consolidation）**：默认每 `maintenance.consolidateIntervalHours`（24h）跑一次，也可点面板「整理」/ `/memory consolidate` / RPC `consolidateNow`（支持 dryRun）：
  - 同一作用域/类别内余弦 ≥ `maintenance.nearMergeSimilarity`（0.92）的近重复 active 记忆合并，保留一条、另一条转 `superseded`；
  - 长期未用且低重要度的 knowledge/other/task（`staleAfterDays` 90 天、`staleMaxImportance` 2）归档为 `archived`；
  - 过期 session 记忆不再直接删除：有意义的内容进入 `digest_queue`，下一次项目摘要生成时并入摘要（真正「汇总进摘要」）。
- **helpful 反馈**：失败提示被附加到工具结果后，若同一会话的下一次工具调用成功，`helpfulCount++`（失败不清零，10 分钟内有效）；面板显示「有用 N」，`stats.helpfulTotal` 汇总。
- **修订 diff**：面板「历史」中每个修订有「与当前对比」，展示字段级变化 + 行级 `+/-` 文本 diff（大文本用前后缀回退，最多 400 行）；`/memory diff <id> <from> [to]`、工具 `memory action=diff`、RPC `diffRevisions`。
- **回滚**：面板每行「历史」查看修订快照并「回滚」；`/memory rollback <id> <revision>`、RPC `rollback`；回滚会写成一个新 revision，不破坏历史。
- **分层注入预算**：`inject.budgets.digest` / `inject.budgets.pitfall` 限制摘要在会话开头注入时最多占多少字符，其余名额按 importance/使用次数/近因填充。

## SQLite 图检索

同一 `memory.db` 内的轻量属性图，无需外部图库：

- 节点：memory / project / error_signature / topic；边：`same_project`、`mentions`、`topic`。
- 混合检索先取 top-k，再沿共享 hub 做多跳扩展（`graph.maxHops`，用递归 CTE 遍历；1 跳直接走 hub 索引），扩展命中标记 `match=graph`，按 `graph.expansionWeight` 与跳数衰减分数；设置页可调跳数（1–3）。
- 错误签名节点让「失败提示」不依赖语义相似度，直接命中历史坑。
- 图在启动时按 `graph_version` 一次性重建，之后写时增量维护；图开关从关到开时会自动重建，避免漏写期间的陈旧数据。

## 使用

### Agent 工具

```
memory action=save    text="用户偏好 TypeScript + pnpm，不喜欢 npm。" kind=preference importance=4
memory action=search  query="用户喜欢什么包管理器？" explain=true
memory action=list    scope=workspace
memory action=update  id=m_xxx text="新的表述"
memory action=forget  id=m_xxx
memory action=archive  id=m_xxx
memory action=restore  id=m_xxx
memory action=history  id=m_xxx
memory action=rollback id=m_xxx revision=2
memory action=stats
```

`scope` 省略时按 `kind` 推导：`preference` / `knowledge` → `global`，`project` / `decision` → 默认作用域（workspace），`task` → `session`。

### 用户命令

```
/remember 以后用中文回答，代码注释用英文
/memory search 测试命令
/memory list global
/memory save 项目部署在 NAS 上
/memory forget m_7f3a2b1c
/memory archive m_7f3a2b1c
/memory restore m_7f3a2b1c
/memory history m_7f3a2b1c
/memory admit
/memory consolidate
/memory rollback m_7f3a2b1c 2
/memory feedback m_7f3a2b1c relevant
/memory quality 7
/memory doctor
/memory events 20
/memory backup
/memory backups
/memory restore-backup memory-manual-2026-11-19T00-00-00-000Z.db
/memory stats
```

### 界面

- **设置（左下角齿轮）→ 记忆**：顶部固定「保存/恢复已保存」；内容分为「嵌入与存储 / 注入与召回 / 自动捕获与 LLM 准入 / 数据与备份」四个可折叠分组，默认只展开第一组；存储后端、数据库路径与嵌入服务健康在标题副文案中。
- **左侧栏「记忆」图标 → 主面板**：顶部五个标签（已保存 / 待确认 / 归档 / 项目 / 诊断），维护动作收进「维护」菜单（立即抽取、试跑、自动准入、整理）；搜索/过滤一行，新增表单默认折叠；每行只保留「编辑 / 历史 / 更多」，归档与删除收进「更多」菜单；tier/修订数/使用次数收进次级元信息行。诊断标签用 KPI + 柱状图 + 预算进度条展示健康与趋势。

## 配置

### 设置页（用户层，即时生效）

保存为「用户层」持久化在**当前存储后端**里（SQLite 的 `meta` 表；domain 后端的 global 槽），合并到 Loader 行配置之上。嵌入模型/维度变化会清空向量索引并后台重嵌入。

### Loader 行配置（默认层）

在 profile 的 `cordis.patch.yml` 中按 id 覆盖（覆盖行会替换整份 config）：

```yaml
- id: memory
  name: dsh-memory-harness
  config:
    storage:
      backend: sqlite        # sqlite | domain
      dataDir: /path/to/memory
    embedding:
      baseURL: ''           # 包默认不内置地址；在设置页填写（输入框有示例）
      apiKey: ''            # 推荐留空，用设置页或 DSH_MEMORY_API_KEY
      model: ''             # 包默认不内置模型；在设置页填写
      dimensions: 1024
      timeoutMs: 3000
      queryInstruction: 'Given a user query, retrieve relevant durable personal memories'
    retrieval:
      defaultLimit: 5
      maxLimit: 20
      candidates: 50
      rrfK: 60
      minVectorSimilarity: 0
      recencyHalfLifeDays: 0
      importanceBoost: 0
    capture:
      defaultScope: workspace
      dedupeThreshold: 0.93
      conflictDetection: true
      conflictSimilarity: 0.82
      maxChars: 4000
      mode: rules+llm
      llm:
        baseURL: ''           # 不内置地址；在设置页填写（输入框有示例）
        model: ''             # 不内置模型；在设置页填写
        contextWindow: 32768
        maxOutputTokens: 3000
        timeoutMs: 120000
      admission:
        enabled: true
        minConfidence: 0.7
        maxPerRun: 8
        includeRules: true
      extractDebounceMs: 15000
    inject:
      coreMemories: 10
      coreMinImportance: 3
      coreMaxChars: 900
      includeWorkspace: true
      proactiveRecall:
        enabled: true
        maxMemories: 5
        minSimilarity: 0.33
        maxChars: 1200
    retention:
      sessionMemoryDays: 14
      maxRecords: 20000
    maintenance:
      backfillIntervalMs: 60000
      backfillBatch: 16
      consolidateIntervalHours: 24
      nearMergeSimilarity: 0.92
      staleAfterDays: 90
      staleMaxImportance: 2
      maxConsolidateOps: 20
      digestQueueMaxItems: 200
      digestQueueMaxChars: 6000
      backupIntervalHours: 24
      backupsKeep: 10
      recallKeep: 10000
      recallRetentionDays: 90
      eventKeep: 10000
      eventRetentionDays: 30
```

## 导出与备份

- `/memory export [json|md]` 或设置页「导出 JSON / Markdown」，写入 `<dataDir>/exports/memory-<timestamp>.(json|md)`（JSON 不含向量，可迁移；Markdown 便于阅读）。
- `/memory import <path.json>` 或设置页「导入 / 恢复 JSON」（文件选择）：支持 v1/v2/v3/v4 导出；**同 id 且同文本跳过；同 id 不同文本更新并写 `import` 修订；新 id 原样恢复**（id 被占用时分配新 id）；导入会重新计算 embedding，上限 5000 条 / 20 MB。JSON 导出现在包含 `revisions`（修订快照），导入时一并写回，历史/diff 可继续使用；`includeRevisions:false` 可导出纯记忆。
- **数据库备份**：默认每 `maintenance.backupIntervalHours`（24h）自动备份到 `<dataDir>/backups/memory-<label>-<时间戳>.db`，保留 `maintenance.backupsKeep`（10）份；设置页「立即备份 / 恢复」、命令 `/memory backup|backups|restore-backup <name>`、RPC `createBackup|listBackups|restoreBackup`。一键恢复是**合并恢复**：先自动备份当前库（`pre-restore`），再导入备份中的记忆与修订历史，当前库中备份没有的记录不会删除。
- 数据库备份仍建议复制 `memory.db`（连同 WAL）或暂停宿主后拷贝。

## 可观测性与诊断

- **事件日志**：SQLite `memory_events` 记录抽取、准入、摘要、整理、备份、导入/恢复、检索聚合、失败提示投递/采纳；含状态、耗时、tokens/calls、错误摘要与关联 `runId`，默认保留 10000 条 / 30 天（`maintenance.eventKeep` / `eventRetentionDays`）。
- **`/memory doctor`**：一次输出记忆分布、embedder 健康、待补向量、今日预算、备份数量/最新时间、最近运行与告警。
- **`/memory events [n]`**：查看最近的运行事件。
- **面板「诊断」标签**：顶部「召回质量」区（7/30/90 天切换 + SVG 折线图 + 准确率/有效率/覆盖率/过时率/样本/MQI + 过时建议），下方 KPI 卡片（主动/候选/归档/被取代/修订/事件/摘要队列/待补向量/DB 大小/备份）、6 个 7 天柱状图、预算进度条、embedder/模式/备份、告警、最近运行与事件；按钮支持刷新、导出诊断 JSON、立即备份、整理。
- **RPC**：`diagnostics()`、`events(limit,kind)`、`exportDiagnostics()`。
- 内置告警：embedder 不可用、每日预算/次数耗尽、候选积压、digest 队列积压、待补向量过多、备份过旧/缺失、近 1 小时后台运行失败。

## 检索解释与相关度反馈

- **解释**：`memory action=search explain=true` / RPC `search(..., explain:true)` 返回每条结果的：
  - `route`（both/semantic/keyword/graph）、最终分数；
  - 语义路的 similarity/排名/RRF 贡献，关键词路的 BM25/排名/RRF 贡献，图的 via/depth；
  - 时间衰减/重要度加权的配置。
- 面板搜索结果行新增「为什么命中」折叠区，直接展示上述信息；普通浏览列表不显示。
- **反馈**：SQLite `memory_feedback`（memory_id、query_hash、action、source、时间），面板搜索结果行提供「相关 / 不相关」，命令 `/memory feedback <id> <relevant|irrelevant|helpful|unhelpful>`，RPC `feedback(id, action, query)`。
- `relevant`/`helpful` 会同时增加 `helpfulCount`；`irrelevant` 只记录，不扣分；诊断面板显示近 24h 反馈与最近 7 天趋势；当最近反馈样本 ≥10 且不相关率 >50% 时产生 `poor-retrieval-feedback` 告警。

## 召回质量与对话内评分

- **首轮主动召回**：新会话的第一条用户消息进入模型前，插件用这条消息做一次上下文检索；只注入相似度达到 `inject.proactiveRecall.minSimilarity` 的记忆（默认 5 条、0.33），并生成一个 `proactive` 召回组供评价。没有足够相关的记忆时不注入，也不产生空召回组。设置页「注入与召回」可调开关/条数/最低相似度。
- **召回评价浮层**：Agent 通过 `memory` 工具检索、失败提示、会话开头注入时都会产生一个可追溯的召回组（`memory_recalls`：session/turn/source/query hash/memory ids/config hash）；反馈会进一步影响记忆的 `qualityScore` 和是否进入复核。当前会话有召回时，输入框左上方出现悬浮胶囊 `🧠 召回评价 · N 条未评价`；点击展开为左侧悬浮卡片（可收起），每条记忆分两组：**本次相关吗？**（非常相关 / 相关 / 一般相关 / 不相关）和可选的 **记忆本身**（有效 / 过时 / 错误 / 重复），选择后点「提交」批量写入。提交后面板清空并显示 ✓ 动画；已提交的召回组会被标记为 reviewed 并从临时窗口隐藏，关闭后不再出现（新召回会重新出现）。10 秒内可点「撤销」恢复提交前的评分并重新评价，10 秒后撤销按钮禁用（显示“撤销已过期”）。设置页「注入与召回」可关闭。
- **反馈分成两个轴，含义不同**：
  - **本次相关吗？** 非常相关 / 相关 / 一般相关 / 不相关。只写入“记忆 × 查询上下文”反馈：记录 query embedding、workspace、时间；后续只有**相似查询**会据此微调排序。不相关不会全局降低记忆质量，也不会进入复核。
  - **记忆本身还有效吗？**（可选）仍然有效 / 过时 / 错误 / 重复。只有内容问题累计 2 次才标记 `needs_review`，进入面板「复核」队列；这类记忆不再进入会话开头注入和失败提示，但检索仍可查。选择“仍然有效”会清空内容问题并移出复核。
- **上下文条件化召回**：召回时用当前 query 与历史评价上下文做相似度匹配，按相似度/时间衰减/收缩计算一个小幅 rerank 系数（约 0.82–1.15）；相似上下文里的“不相关”只抑制该场景，换个话题仍可能正常召回。没有足够相似反馈时不调整。
- **内容质量**：`qualityScore`（-1..1）只由内容反馈更新；正向提升少量检索优先级，内容问题降低优先级。
- 复核队列支持：编辑（改完自动移出）、保留（清空内容问题计数并移出）、归档；不自动删除。
- **评分口径**：
  - 未评价保持 `unknown`，不计入准确率分母；托盘与指标都显示样本量/覆盖率；
  - 可选未评价默认值 `somewhat_relevant`（0.25 权重），默认关闭；
  - `very_relevant/relevant` 同时增加 `helpfulCount`；
  - `outdated` 单独计数，不混入不相关；同一记忆累计 2 次过时反馈后诊断页给出归档/更新建议，不自动删除。
- **质量曲线**：诊断标签新增「召回质量」：7/30/90 天切换，SVG 折线展示准确率、有效率、覆盖率，KPI 展示准确率/有效率/覆盖率/过时率/评分样本/MQI；MQI = `0.6×准确率 + 0.2×有效率 + 0.2×(1−过时率)`（评分样本 <5 时不计算）。数据按日写入 `memory_quality_daily`，原始召回默认保留 90 天 / 1 万条。
- **迭代**：`/memory quality [days]` 输出当前窗口指标与建议；召回记录带 config hash，便于后续按配置版本对比曲线。不会自动调参，只给建议。

## 数据与密钥

| 内容 | 位置 |
|---|---|
| 记忆与设置（默认） | `$DSH_HOME/memory/memory.db`（可用 `storage.dataDir` 覆盖） |
| 记忆与设置（domain 后端） | `$DSH_HOME/storages/dsh_memory/`，一条记忆一个 JSON |
| 嵌入 API Key | Harness 凭证记录 `dsh-memory/embedding-api-key`（`$DSH_HOME/.credentials.yaml`，权限 0600） |
| 抽取模型 API Key | Harness 凭证记录 `dsh-memory/extraction-api-key`（同上） |

**迁移**：默认后端启动时若 SQLite 库为空，会从 JSON domain 迁移全部记录与设置一次；原目录保留不删。schema 旧版本升级会自动备份到 `<dataDir>/backups/` 并在单事务内完成。**备份**：复制 `memory.db`（以及 `.db-wal` / `.db-shm`，或先停止 dsh 让 WAL 落盘），或使用导出命令。

## 冲突与时效

- **LLM 冲突判定（主路径）**：保存/确认/更新记忆时，先用相似度 ≥ `capture.conflictJudge.minSimilarity`（默认 0.6）召回同 kind/scope 的候选，把新记忆、候选和最近对话/证据交给配置的模型判断关系：`supersede / update / contradict / duplicate / compatible / unrelated`，并给出 confidence 和证据。
  - 高置信度（≥ `autoApplyConfidence`，默认 0.85）且有证据的 `supersede/update/duplicate` 自动处理：旧记忆变 superseded，保留 revision 可回滚；`contradict` 默认留给人工（可开启 `autoContradictNewWins`）。
  - 中低置信度或矛盾关系 → 创建 `memory_conflicts` 复核卡片，新记忆暂时不参与注入；
  - 面板「复核」显示关系、置信度、判断理由和证据，可**替换旧记忆**、**保留两条**、**忽略**；
  - LLM 不可用/超时 → 自动回退到相似度启发式，不阻塞保存。
- **有效期**：`memory` 工具的 `save`/`update` 支持 `validUntil`（ISO 日期），面板新增记忆也可选日期。
  - 到期记忆不会静默删除，而是进入「复核」并标记「已过期」，停止注入；
  - 复核时点「保留」会清空有效期并恢复；也可编辑/归档。
  - 后台每 5 分钟扫描一次到期记忆。

## 设计要点

- **写入串行化**：保存/更新/删除走一条 promise 链；SQLite 写入在事务里同时更新 `memories` 与 `memories_fts`。
- **去重**：精确文本走 hash 快路径；同作用域余弦 ≥ `capture.dedupeThreshold`（默认 0.93）合并。
- **检索**：过滤（scope/kind/tags/workspace/session）先于打分；SQLite 后端的关键词召回走 FTS5，向量召回为内存精确扫描；两路用 RRF 融合。可选时间衰减/重要度加权默认关闭。
- **注入边界**：注入内容是一条可回放的 `agent/inbox/spliced` 用户消息，`resume`/`compact` 不重复注入。
- **零依赖**：不 import 任何 `@deepseek-ai/*` 包，不引向量数据库/native 模块；中文用 bigram 分词，绕开 unicode61 不分词的问题。

## 数据与隐私

- 数据默认全部在本机 `<dataDir>/memory.db`；备份在 `<dataDir>/backups/`。
- 语义检索会把 **query 文本**发到配置的 embedding provider；冲突判定会把新/旧记忆文本和最近会话片段发到配置的抽取/准入 LLM provider；不配置外部 provider 时回退到当前会话模型。
- 召回上下文只持久化 query embedding 与 workspace，不持久化 query 原文。
- embedding / 抽取 API Key 存在 Harness 凭证记录中，不写入数据库或配置文件。
- 自动捕获会脱敏、过滤疑似指令文本；注入块明确标记“数据不是指令”。它不能替代完整的 PII/密钥扫描，敏感环境请先脱敏或关闭自动捕获。

## 向量索引维护

向量数据持久化在 `memories.vec`，不会被“待补向量”计数删除。切换 embedding 模型/维度后，内存索引会重建：新模型/维度与旧向量不匹配的记录才需要重新 embedding。

- 诊断页新增「重建向量索引」：从数据库里的向量重建内存索引，不需要调用 embedding 服务；
- 只有模型/维度确实变化时才需要补向量；补向量失败会保留原向量，不会丢失记忆；
- 如果 UI 显示大量“待补向量”，先看模型/维度是否与旧记忆一致，必要时点「重建向量索引」。

## 已知限制

- 向量召回目前是精确扫描（SQLite 负责持久化、FTS5 关键词与图检索）；10 万条以上再考虑 ANN/IVF。
- LLM 自动抽取优先使用设置的 OpenAI 兼容 provider；未配置 URL/model 时回退默认模型，仍不可用时只剩规则层与失败提示。
- 自动抽取与摘要以「候选」形式落库，未确认前不会参与检索/注入；规则/LLM 自动捕获会过滤指令性文本与脱敏，注入块明确标注「数据不是指令」。
- 试跑评估不做持久化，但会计入每日 token 预算。
- 嵌入 API Key 记录是明文 JSON（Harness 本地凭证文件，0600）；更严格场景可接 OS keychain。
- 设置页/记忆面板通过包内私有 Remote 服务访问，仅支持同源已认证的 Web 页面。**不要自己 `connection.rpc.intercept('/api', …)`**：该通道全进程只允许一个 interceptor，已被 stock gateway 占用，第二个注册会在启动期 fatal。
- `node:sqlite` 目前是 Node 的实验 API（会打印 ExperimentalWarning），随 Node 版本升级需回归测试。
- CI 目前覆盖 Node 单元/集成测试与打包检查；浏览器端到端 smoke 仍需在真实 GUI 上手动执行。
- LLM 冲突判定的自动 supersede 依赖模型输出和证据，极端情况下仍可能误判；revision/回滚与人工复核是安全网。

## 开发与发布

```bash
npm test                  # node --test test/*.test.mjs
npm run pack:check        # npm pack --dry-run
# 浏览器端手动验证（不提交、不包含在 npm 包中）：在真实 DSH GUI 操作设置页/面板/召回浮层
```

CI：`.github/workflows/ci.yml` 在 Node 22 上跑单元/集成测试和 `npm pack --dry-run`。

发布前检查：

1. npm 上 `dsh-memory` 已被他人占用；本包暂用 `dsh-memory-harness`（当前可用）。发布前确认名字，或改用 `@<scope>/dsh-memory`。
2. 改名需要同步三处：`package.json` 的 `name`、`cordis.patch.yml` 的行 `name`、`client.js` 顶部 `window.__ModuleLoader__.load({ id })`，然后重新 `install_bundle`。
3. `npm run pack:check` 确认包内容；`npm publish` 需要 npm 登录（`publishConfig.access: public`）。
4. 发布前补齐 `repository` / `homepage` / `bugs` / `author` 元数据；当前仓库尚未配置远端。
5. 首次公开发布建议使用 0.x beta 版本，先在干净 DSH profile 中安装 tarball 验证。
