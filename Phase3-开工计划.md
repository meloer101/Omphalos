# Phase 3 开工计划：Dogfooding（用工作台管理工作台自身）

> 上游：《Roadmap.md》Phase 3 ·《PRD-MVP.md》§6 Success Metrics（Leading 指标）+ G1–G5 ·《Phase2-开工计划.md》§六收口 / §七顺延项。
> 目标（出口）：**本产品成为图里的第一个项目，用 4 周真实使用回答"这东西到底有没有用"。** Leading 指标达标（捕获接受率 ≥70%、高风险边错连率 <5%、周追溯查询 ≥10 次）→ Go：找首个设计伙伴团队；不达标 → 定位是捕获质量 / 检索质量 / 审批疲劳，修完再评。
> 估算 4 周——**但这 4 周是日历时间，不是工时**。指标要靠真实使用天数长出来（见 §零）。承接 P2：图内核、`lib/graph` 唯一写入口、capture/import 两份合同、两段式检索 + Cmd-K、审批 tab、`audit_log`（已按边类型记 proposed/confirmed/rejected/reverted）、本地 bge-m3 + DeepSeek 端到端均已就位。

---

## 零、Phase 3 与前三个阶段本质不同（先说清楚，免得跑偏）

P0–P2 的出口是"某个功能能跑通"，一次演示即可判定。**P3 的出口是一组统计指标，只能靠日历时间累积**——接受率、周追溯次数这些量，本质上要求"每天真的在用"。所以 P3 拆成两段，别混为一谈：

- **建设期（约 3–5 天工时）**：把"能开始 dogfooding"的地基铺好——拆库、埋点、种子内容、指标面板。这段是写代码，可快速完成。
- **食用期（4 周日历）**：每天真的用工作台管产品自身的开发，指标自然累积；每周复盘一次。这段几乎不写功能代码，写的是**用产品产生的图数据**和**复盘记录**。

**建设期不达标不进食用期**（埋点没接好就开始用 = 4 周白费，测不出任何东西）。这是本阶段的第一个内部出口。

---

## 一、开工前写死的关键决策

延续 P2 的决策字母（A–I 已用），本阶段新增 J–N。

### 决策 J：先拆库——vitest 测试库与 dogfooding 开发库物理分离（**建设期第一件事，阻塞一切**）
- 现状（P2 §七 papercut）：dev 库与 vitest 测试库是同一个，`db/__tests__/test-helpers.ts` 的 `resetGraph()` 会 `TRUNCATE`。P0–P2 无所谓——图是一次性 demo 数据，跑测试清掉重导就行。
- 到了 P3 这条从"可忍"变"致命"：dogfooding 图要**连续积累 4 周**，任何人在这期间跑一次 `pnpm test` 就把 4 周真实数据 + 指标事件清空，本阶段直接归零。
- 决策：**测试用独立库（`pmeverything_test`），dev/dogfooding 用主库（`pmeverything`）**。`DATABASE_URL`（含只读 `DATABASE_URL_READONLY`）指主库；vitest 与 CI 走独立的 `DATABASE_URL_TEST`。`resetGraph()` 增加护栏——**库名不含 `_test` 就拒绝 TRUNCATE**（防手滑指错库把 dogfooding 图清了）。
- 这是本阶段风险最高的"地基"操作，先做、单独验证、再往上叠任何东西。

### 决策 K：遥测方案结案（D5）——指标全部留在本地 Postgres，不接外部服务，可关
- D5（"开源产品的匿名指标收集，可关"）此前挂着"P3 前决定"。现在的决定：**dogfooding 阶段的指标不出本机**——落在主库一张新的 append-only `events` 表里，不接 PostHog / 不发匿名遥测。贴合自部署 / 数据敏感定位（OQ3 一脉相承）。
- 匿名遥测（开源健康度、外部实例数）是"外部团队入驻"才需要的东西，属 **P4 lagging 指标**，本阶段不做，不提前造抽象。
- 全局开关 `TELEMETRY_ENABLED`（默认 on，dogfooding 需要它 on）；关掉时埋点静默 no-op，产品功能不受影响（呼应 PRD Non-Goal"遥测可关"）。

### 决策 L：两条 R5 指标从 `audit_log` 派生，不重复埋点；三条交互指标才建 `events` 表
- `audit_log` 已经是权威账本，按边类型记了 `proposed/confirmed/rejected/reverted` + `actor`。所以：
  - **捕获接受率** = `confirmed` / (`confirmed` + `rejected`)，over AI 提议的节点+边（`actor` / provenance.createdBy ≠ human）。
  - **高风险边错连率** = 被 `rejected` 的高风险边 / 高风险边提议总数（risk 由 `edgeRiskOf(edgeType)` 派生，不用新列）。
  - 这两条**只写聚合查询，零新埋点**——数据早就在库里躺着了。
- 剩下三条现在**完全没采集**，才需要 `events` 表：
  - **引用点击率**：Cmd-K 行内蓝链被点 → 前端埋点。
  - **拒答占比**：`/api/retrieval` 现在不落任何日志——每次追溯问答记一条（`answer` / `no_record` / `error`）。
  - **日均审批耗时**：审批 tab 打开→批完的停留时长，现在无计时。
- `events` 表刻意扁平：`{ id, kind, payload jsonb, project_id, at }`。不做花哨 schema——够聚合即可，呼应 Roadmap"简易指标面板，内部用，够看即可"。

### 决策 M：dogfooding 图仍用单 project（`DEFAULT_PROJECT_ID`），不引入多项目/鉴权
- 多项目切换是 P4。本阶段"第一个项目"就直接是 `DEFAULT_PROJECT_ID` 这张图——产品自身的历史**就是**这张图的全部内容。
- 升级式检索的"全局"仍指全部 project scope（P2 决策不变）。
- 建设期开始前，主库里的 P2 demo 残留数据先清一次（人工确认后 TRUNCATE 主库一次），让 dogfooding 从干净图起步；此后主库只进不清。

### 决策 N：种子内容走真实捕获/导入通路 + 人工审批，**不走后门直插**
- 诱惑是写个脚本把四份 md 直接 INSERT 成 confirmed 节点，省事。**明确不这么做**——那样第一批接受率数据就是假的，dogfooding 头一周就自欺。
- 四份 md（PRD-MVP / 产品理念与MVP讨论 / Agent架构设计 / Roadmap）走**已有 import 合同**（决策 H 通路）熔图 → **在审批 tab 真实审一遍** → 落图。这一审本身就是**第一批捕获接受率样本**，也是对 import 合同质量的第一次真实检验。
- 例外：Roadmap 的勾选清单结构性极强，import 合同（面向叙事文本）未必能干净熔成任务节点。**先试熔**；若产出杂乱，退化到一个确定性小脚本把每个 `[x]/[ ]` 勾选项转成 task 节点 + `implements` 边挂到对应 feature——但脚本产出的节点**照样进审批 tab 走人工确认**（保持"人只审不录"的一致体验，也让这批也计入接受率分母）。这个降级路径事先说清，省得临场纠结。

---

## 二、技术栈增量（相对 P2）

| 层 | 新增 | 落地 |
|---|---|---|
| 数据库 | 测试库/开发库拆分 + `resetGraph` 库名护栏 | `DATABASE_URL_TEST`，CI 改指测试库 |
| 数据库 | 迁移 `0007`：`events` 表（append-only，扁平 jsonb） | `{id, kind, payload, project_id, at}` |
| 埋点 | `lib/metrics/emit.ts`：`emitEvent(kind, payload)` 单一入口 + `TELEMETRY_ENABLED` 开关 | 服务端直写；失败静默不连累主流程 |
| 埋点 | 检索路由记 `retrieval`；审批 tab 记 `approval_session`；Cmd-K 链接记 `citation_click` | 三处 call site |
| 指标 | `lib/metrics/rollup.ts`：五条 Leading 指标聚合查询（2 条查 audit_log，3 条查 events） | 纯 SQL，可脱 UI 单测 |
| 前端 | `/metrics` 简易面板（Server Component 直读 rollup） | 内部用，无需美化 |
| 内容 | dogfooding 种子：四份 md 熔图 + 审批 | 走 import 通路（决策 N） |
| 流程 | 每周复盘 ritual（把新问题记成证据节点） | 用产品本身，非代码 |

---

## 三、任务分解

### 3.0 建设期地基（阻塞项，按顺序）
- [x] **拆库（决策 J）**：`db/client.ts` 在 VITEST 下强制走 `DATABASE_URL_TEST`（缺失即报错）；只读连接同理走 `DATABASE_URL_READONLY_TEST`；新迁移 `0007` 用 `current_database()` 修掉 0003 写死的 `GRANT CONNECT ON DATABASE postgres`（让只读角色能连测试库）；`resetGraph()` 加"当前库名不含 `_test` 即抛错"护栏（真值取 `current_database()`，非 URL 字符串）；`drizzle.config.ts` 加 `DRIZZLE_TEST` 开关 + `pnpm db:migrate:test`；CI 建 `pmeverything_test` 并分别迁移 dev/test 库。**验证已通过**：dev 库种一条哨兵节点 → `pnpm test`（63 通过/21 gated skip）→ 哨兵仍在（拆库前会被 TRUNCATE 清零）；readonly-role.test 全绿证明 0007 让只读角色成功连上测试库。
- [x] **清主库一次（决策 M）**：TRUNCATE dev 主库（清掉哨兵 + P2 demo 残留），确认 nodes/edges/audit 全 0，dogfooding 从干净图起步。

### 3.1 指标埋点层（决策 K/L）—— ✅ 完成
- [x] 迁移 `0008_events.sql`：扁平 `events` 表（`{id, kind, payload jsonb, project_id, at}`）+ `(kind, at)` 复合索引。天然只 append，不加禁 UPDATE/DELETE 触发器（决策 L）。schema.ts 补 `events` 表 + 类型；`resetGraph()` 的 TRUNCATE 列表也加上 events。
- [x] `lib/metrics/emit.ts`：`emitEvent(kind, payload)`，读 `TELEMETRY_ENABLED`（默认 on，非 "false" 即开）；即发即忘不 await，写失败 `catch` 只 `console.warn` 不冒泡；`VITEST` 短路不写库。
- [x] **拒答占比**：`/api/retrieval/route.ts` 三个出口（answer / no_record / error）各 `emitEvent('retrieval', {outcome, ...})`。
- [x] **引用点击率**：`components/cmd-k-search.tsx` 行内蓝链 onClick → `navigator.sendBeacon('/api/metrics/citation-click')`（beacon 在跳转时仍能送出）；新端点 `emitEvent('citation_click', {nodeId, question})`。用 ref 记住"产生当前答案的问题"，避免读到用户随后改写的输入。
- [x] **审批耗时**：`components/approval-timer.tsx`（client，嵌进 ReviewPanel，两处渲染点自动带上）——pending 首次>0 起表、归 0（批完）落表、pagehide/隐藏时 beacon 送出；新端点 `/api/metrics/approval-session`，服务端清洗 durationMs（>20 分视为挂着没看，丢弃）。

### 3.2 指标聚合 + 面板 —— ✅ 完成
- [x] `lib/metrics/rollup.ts`：六个纯函数（都接受可选 `since` 窗口）——`captureAcceptRate` / `highRiskMiswireRate`（← audit_log 派生，决策 L）、`noRecordRate` / `citationClickRate` / `avgApprovalDurationMs`（← events）、外加 `retrievalCount`（P3 出口硬门槛"周追溯 ≥10"用）。统一返回 `{value, numerator, denominator}`，无样本 value=null。
- [x] `lib/metrics/__tests__/rollup.test.ts`：连测试库造 audit_log + events 样本，断言六条聚合算得对——**Go/No-Go 的裁判**。覆盖边界：人工创建不进接受率分母、低风险边不进错连率分母、`since` 窗口过滤（防 Date 绑定回归）。
- [x] `app/(workbench)/metrics/page.tsx` + nav"指标"入口：Server Component 直读 rollup，六张数字卡，本周窗口对目标线着色（达标绿/未达标红/无样本灰），三个硬门槛标「门槛」。**已在浏览器端到端验证**：三种事件经真实端点 emit → 落 events 表 → 面板正确反映（周追溯 1、审批 1.5 分）；空图态六卡正确显示「—」不当 0。

### 3.3 种子内容——把产品自身熔进图（决策 N）
- [x] 四份 md（PRD-MVP / 产品理念与MVP讨论 / Agent架构设计 / Roadmap）经 `/api/import` 熔图 → **133 节点（58 证据 + 75 需求）+ 85 边（42 supports + 43 because，全高风险）**，4 个批次、全部 proposed、133/133 已向量化。质量抽查：需求节点对应 R1–R7/P1，证据节点含 G1–G5 + 各条"不做 X 的理由"，because 边连出真正的决策→理由因果链（如"v1 不做判断 Agent → 因为图不满会摧毁信任"）。
- [x] **审批 tab 真实审这一批 → 落图**：产品负责人真实审完——确认 138、**拒绝 72**，落图 82 节点（36 证据 + 46 需求）+ 56 边。接受率 **65.7%**（低于 70% 门槛）。这是一次真审，不是走过场。
- [ ] Roadmap 勾选项 → task 节点：本次 import 把 Roadmap 熔成了 feature/evidence（不是 task）。鉴于过度切碎的发现，暂缓补 task 脚本，先解决 import 产量问题（见发现 ②）。
- [x] **首个 dogfooding 追溯自测**：⌘K 问"为什么 v1 不做判断 Agent？"→ 自然语言答案 + 行内引用 `[E1][F2]`（E1「图不满时 AI 判断不可信」、F2「判断层放最后做」）、**0 错误引用**。G1/G4 在真实自有数据上首验通过。

**首审暴露的两个发现（dogfooding 立刻见效）：**
- **① 指标 bug（已修）**：`rejectEdge` 漏记 `edgeType`（违反 PRD R5"接受/拒绝按边类型记录"），导致被拒高风险边 `edge_type=NULL`、被"高风险边错连率"漏统计 → **面板误显示 0%（假绿），真实是 27%（21/77）**。若不修，这个 Go/No-Go 硬门槛会被误判通过。已修根因（rejectEdge 补记 edgeType）+ 让 rollup 从 proposed 行判高风险（修正历史 NULL 数据）+ 加回归测试。
- **② import 过度切碎（产品质量信号，已调优 + 重新种）**：一份 PRD 熔 46 节点、四份共 133 节点，接受率 66%、错连率 27%——产量过大、噪声偏多。根因：`importHead.extractionHint` 对边有"宁可漏挂"约束，但对**节点粒度零约束**，模型一行一节点。**修复**：extractionHint 加节点粒度纪律（一节点=一个承重决策/证据、多要点合并进 bodyText、跳过结构性内容、"个位数到十几个"预算校准），重启 worker 加载新提示词，清图重种。**结果**：133→84 节点（−37%）、85→48 边（−44%），关键 because 因果链与判断-Agent 链全保留，需求节点抽象层更高（"4节点心跳模型"合并子弹点）。**注**：调优对 3/4 文档显著（PRD 46→21、Roadmap 38→14），但 Agent架构设计（最密的引擎图纸）34→36 未降——高决策密度文档本就该多节点，不强压。新种 84 项待重审，验证调优是否真提高接受率。

### 3.4 食用期运转（4 周日历，主要不是写代码）
- [ ] **每日**：产品自身开发中的真实反馈/决策/问题，走捕获或直接建节点进图（吃自己的狗粮）。新发现的 bug/想法 → 证据节点。
- [ ] **每周复盘**（4 次）：看 `/metrics` 面板；把当周暴露的产品问题记成图中证据节点（闭环自己的环）；在本文件 §五追加一条周复盘记录（日期 + 五指标读数 + 定性观察）。
- [ ] 观察三类信号并即时记录：捕获是否总在错聚类某类输入、审批是否出现"全选通过"疲劳行为、追溯是否频繁"图里没有记录"。这三条直接对应 §风险登记的红灯。

---

## 四、出口验收（P3 🚪）

### 建设期内部出口（进食用期前必须全绿）—— ✅ 通过
- [x] 拆库生效：`pnpm test` 不再动主库（哨兵节点验证通过）。
- [x] 五条指标埋点全部产生真实事件：审批（138 确认/72 拒绝）、追溯问答（2 次）、审批耗时（3 次会话，均值 ~0.65 分）、拒答占比（0/2）均已落 `/metrics`，无 N/A。（引用点击 0——自测用 curl 未点链接，食用期真实点击会有。）
- [x] 种子四份 md 熔图并审批落图；首个自有数据追溯问答 0 错误引用（"为什么不做判断 Agent"，`[E1][F2]`）。
- 附带产出：dogfooding 首日即抓到一个会误判 Go/No-Go 门槛的指标 bug（见 3.3 发现 ①，已修）。这本身就是"这东西有没有用"的第一个正面证据。

### 食用期出口（4 周后，Roadmap P3 出口标准）
- [ ] **捕获接受率 ≥70%**
- [ ] **高风险边错连率 <5%**
- [ ] **周追溯查询 ≥10 次**（连续，非一次性刷量）
- [ ] （辅助观察，不作硬门槛）引用点击率、拒答占比趋势、日均审批耗时 <5 分钟

### Go / No-Go 决策
- **三条硬指标全达标** → **Go**：启动"找首个设计伙伴团队"（进入 P4 外部团队线）。
- **任一未达标** → **No-Go + 定位**：
  - 接受率低 → 捕获质量问题 → 参照风险登记"缩小捕获范围（只做反馈，不做会议记录）"。
  - 错连率高 → 检索会引到脏边 → 收紧自动生效范围 / 提高高风险边确认门槛。
  - 追溯次数低 → 要么产品没解决真痛点，要么追溯入口不好用 → 定性访谈自己（唯一用户）到底为什么不问。
  - 修完对应项，**重新计一个观察窗口再评**，不跳出口。

---

## 五、周复盘记录（食用期滚动追加）

> 每周一条：日期 · 五指标读数 · 定性观察 · 本周记了哪些新证据节点。

_（食用期开始后填写）_

---

## 六、明确不做（顺延 P4 / 停车场）

- **匿名遥测 / 开源健康度指标**（stars / 自部署实例 / 外部 PR）——外部团队线才需要，P4（决策 K）。
- **指标自动进食**（PostHog webhook → 结果节点 + 自动验证/证伪边）——P4 最优先项，本阶段结果节点仍手动录入。
- **趋势图表 / 花哨指标面板**——本阶段只要数字卡够判 Go/No-Go；真要趋势线等有多周数据再说。
- **多项目 / 鉴权重构**——仍单 project（决策 M），P4。
- **推进 Agent、Slack/飞书捕获头、审批准确率可视化面板**——P4。
- 把 P1 侧边栏"上下文"面板改写成自然语句风格——P2 遗留的"整体感受一遍再决定"，dogfooding 用起来后如果确实别扭，作为一条证据节点记入图，按真实痛感排期，不提前拍。

---

## 七、风险登记（本阶段特有）

| 风险 | 信号 | 预案 |
|---|---|---|
| 拆库出错清了主库 | dogfooding 图突然为空 | 决策 J 的库名护栏；建设期结束后主库定期 `pg_dump` 备份 |
| 单一用户样本偏差 | 只有作者一人用，接受率"虚高"（自己熔的自己觉得对） | 复盘时刻意投喂"别人会怎么写"的杂乱输入；接受率与错连率**一起**看，只看接受率会自我麻醉 |
| 埋点拖累体验 | 审批/追溯变卡 | emit 全程 fire-and-forget + 失败静默；`sendBeacon` 不阻塞导航 |
| 4 周里忍不住加功能 | 食用期在写新 surface 而不是在用 | 范围蔓延红灯：任何新功能想法先记成证据节点，等出口后按指标重排，不当场做 |
| 指标达标但产品其实没用 | 三条硬指标绿、但自己其实不想用 | Go/No-Go 不只看数字——复盘诚实记"我今天是真的需要它，还是为了刷指标"，定性观察有一票否决权 |
