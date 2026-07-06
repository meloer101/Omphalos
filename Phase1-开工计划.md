# Phase 1 开工计划：Agent 运行时 + 捕获 + 审批 + 侧边栏

> 上游：《Roadmap.md》Phase 1（1.1–1.5）· 《Agent架构设计.md》(5.1–5.4、决策点 5–10) · 《PRD-MVP.md》(R3/R5/R6)
> 目标（出口）：**录入这件脏活从此归 AI；人只审不录。** 粘贴 20 条杂乱反馈 → 捕获产出去重聚类提议 → 审批 tab 5 分钟内批完落图，全程键盘零录入；故意投喂垃圾输入，提议可整体拒绝，图无污染。
> 估算 3 周（2026-07-21 → 08-08）。承接 P0（图内核 + 三视图 + BlockNote + LiteLLM 链路已就位）。
>
> **2026-07-06 事故记录**：本文件在首次完成 Phase 1 全部内容后因本地文件夹被意外替换而丢失（未提交到 git，只有 Phase 0 的提交在远端）。凭本次会话的完整记忆重建，内容与决策记录保持一致；重建时顺手修好了重建前发现的一处遗漏（capture 合同的 supports 边缺 batchId）。往后每完成一个子阶段就立即 commit，不再攒到最后。

---

## 一、P1 关键架构决策（开工前写死，避免中途摇摆）

三个岔路口已定案（2026-07-06，与产品负责人确认）：

### 决策 A：编排层 = pg-boss 异步 + 薄编排，不做全事件驱动总线
- **理由**：0.4 spike 实测 `deepseek-v4-pro` 延迟均值 ~11s（思考模型），捕获**必须异步**，不能阻塞式同步等待——这直接逼出一个后台 job 队列（pg-boss 已在 P0 装好，只装未用）。
- **但不提前造多 Agent 总线**：架构文档决策点 5 的"Agent 靠往图里写东西协作"（捕获写入→事件→检索被叫醒查重）是**多 Agent 协作**才需要的编排。P1 只有捕获**一个** Agent，没有协作对象，提前搭 LISTEN/NOTIFY 事件路由 + 订阅骨架是过度设计。
- **落地形态**：
  - `pg-boss` 承载 `capture` job（后台异步跑五段流水线）。
  - `LISTEN/NOTIFY` **只用于**把"新提议已写入"这一个信号实时推给前端侧边栏审批 tab（SSE），不承载 Agent 间编排。
  - 编排代码保持薄：一个 job handler，不建通用事件总线抽象。
- **P2 迁移承诺**：检索 Agent 登场时，把"捕获写入 → 唤醒检索查重"接成第二条 job/订阅即可，pg-boss 已在位，迁移平滑。

### 决策 B：捕获入口 P1 只做「粘贴文本」+「上传 md/txt」，邮件转发仅预留接口
- 出口验收只要求粘贴 20 条反馈。粘贴 + 文件上传两个入口足以打通并验证全链路。
- 邮件转发需要真实 inbound 收信基础设施（较重、引外部依赖），PRD 明确把邮件列为"食物"而非承重墙。**P1 只预留 `POST /api/capture/inbound` webhook 接口占位 + 预处理头接口**，不接真实收信服务；真实邮件转发推迟到 P4。

### 决策 C：低风险边写入即 confirmed + 可撤销；高风险边 proposed 必须人确认
- 贴合架构文档决策点 9 的"低风险（标签/疑似重复）自动生效可撤销"。
- **落库规则**（捕获 Agent 写入时）：
  - 低风险边（`duplicates` / `blocks`）→ 直接落 `confirmed`，进图即生效，审批 tab 提供「撤销」（写 `audit_log` action `reverted` + 删边，枚举已就位）。
  - 高风险边（`supports` / `because` / `validates` / `refutes`）→ 落 `proposed`，虚线呈现，必须人显式确认。
  - **所有捕获产出的节点一律 `proposed`**（节点比边便宜，但仍是"当初为什么"的事实载体，统一走确认）。
- 调参哲学写死：**宁可漏连，不可错连**（决策点 9.3）。

### 决策 D（照搬 0.4 spike，不再讨论）：结构化输出走 tool-calling
- **唯一稳定模式**：`generateText` + `tools` + `toolChoice: 'auto'` + prompt 明示"必须调用工具"，从 tool call 的 `input` 取结构化结果，再过 zod 校验。
- 不用 `generateObject` / `Output.object()`（`deepseek-v4-pro` 拒绝 `response_format: json_schema`），不用强制 `tool_choice`（思考模型拒绝）。见 Phase0-开工计划.md 0.4。

---

## 二、技术栈增量（相对 P0）

| 层 | 新增/变化 | 备注 |
|---|---|---|
| 任务队列 | **pg-boss 启用**（P0 只装未用） | 后台跑捕获 job；建自己的 schema，仍是单库 Postgres |
| 实时推送 | **Postgres LISTEN/NOTIFY + SSE route** | 新提议实时进审批 tab；只此一个用途 |
| DB 凭证 | **新增只读角色 + `DATABASE_URL_READONLY`** | 架构 5.2 检索合同"物理只读"。P1 只**建角色 + 授权**（低成本），消费方（检索）P2 才有 |
| Agent 运行时 | `lib/agents/`（运行时执行器 + 合同抽象 + 捕获合同） | 新目录，五段流水线 |
| Worker 进程 | 独立 node 进程 `worker/index.ts`（tsx 起） | dev 加 `pnpm worker` script |
| 前端 | 侧边栏框架替换 P0 右栏占位 | `components/workbench-chrome.tsx` |

---

## 三、Agent 运行时设计（1.1，架构 5.2/5.3）

### 合同抽象（`lib/agents/contract.ts`）
四份合同同结构，P1 只实现捕获一份，其余先立类型不填：`ContractName`/`AssembledContext`/`PromptSpec`/`ContractPermission`/`AgentContract<TInput,TOutput>`。

### 五段流水线执行器（`lib/agents/runtime.ts`）
```
job 触发 → 上下文装配（查图，一跳邻域 + 候选节点清单） → LLM（generateText+tools+auto）
        → zod 校验（tool input，失败即抛错） → 写提议态节点/边（lib/graph）
```
- 重试/死信不在 `runtime.ts` 手写——pg-boss 队列级 `retryLimit`+`deadLetter` 已经是这件事该用的机制，运行时执行器只管一次尝试。
- 无状态：worker 挂了重启零损失（架构 5.1）。

### 双凭证（`db/migrations/0003_readonly_role.sql`）
- 手写 SQL：建 `graph_readonly` role，`GRANT SELECT` 于四张表，`REVOKE` 一切写。
- `db/client.ts` 导出 `getDbReadonly()`——P1 建好但暂无消费方，P2 检索合同用。**物理隔离靠构造，不靠模型自觉**（架构 5.2）。

---

## 四、任务分解（勾选推进）

### 1.0 运行时地基（Week 1）—— ✅ 完成 2026-07-06
- [x] pg-boss 接入：`lib/queue/boss.ts` 单例（惰性构造，同 client.ts 规避 import 提升坑）；启动建自身 schema + `capture`/`capture_dlq` 队列（`retryLimit:1, deadLetter`）
- [x] Worker 入口 `worker/index.ts`：注册 `capture` job handler；`pnpm worker` dev script
- [x] LISTEN/NOTIFY：`createNode`/`createEdge` 在写入 `proposed` 节点/边的同一事务内 `pg_notify('graph_proposals', ...)`；SSE route `app/api/proposals/stream/route.ts` 用 `db.$client.listen()` 订阅并推前端（`export const dynamic = "force-dynamic"`）
- [x] 双凭证：`0003_readonly_role.sql`（`graph_readonly` 角色，`GRANT SELECT` + 显式 `REVOKE INSERT/UPDATE/DELETE/TRUNCATE`）+ `db/client.ts` 的 `getDbReadonly()` + `DATABASE_URL_READONLY` env
- [x] 合同抽象 `lib/agents/contract.ts` + 运行时执行器 `lib/agents/runtime.ts`
- **决策落地记录**：重试/死信没有在 `runtime.ts` 里手写——pg-boss 队列级 `retryLimit`+`deadLetter` 已经是这件事该用的机制，比原计划"重试 1 次后进死信"更干净，效果等价。

### 1.2 捕获 Agent（R3，Week 1–2）—— ✅ 完成 2026-07-06
- [x] 抽取内核 `lib/agents/contracts/capture.ts`：prompt 头 + `outputSchema`（证据节点数组 + 到既有 feature 的 supports 边草案）；单批内去重聚类靠 prompt 明确指示合并同义表达
- [x] 预处理头 `lib/agents/preprocess/`：`feedback` 头 + `meeting` 头，只调整 prompt 措辞与抽取侧重，不改输出 schema
- [x] 粘贴文本入口：`POST /api/capture/text`（zod 校验 body）→ enqueue → 202 + jobId，不等模型跑完
- [x] 文件上传入口：`POST /api/capture/file`（校验扩展名 .md/.txt、1MB 上限）
- [x] 邮件转发：`POST /api/capture/inbound` webhook 占位（决策 B）
- [x] 出处自动填充：`sourceRef.detail` 带 `rawExcerpt`/`channel`/`contract`/`batchId`，`confidence` 落库
- [x] 跨批去重：`lib/agents/dedup.ts`，字符二元组 Jaccard 粗匹配已有证据节点标题（阈值 0.2，真实模型输出样本校准——见下方校准记录），命中→`duplicates` 边（低风险，决策 C 下写入即 `confirmed`）
- **阈值校准记录**：手写样本最初定 0.28；接入真实模型后发现短标题的真实重复对能低至 0.25（模型倾向于用不同措辞概括同一句话）；扩样后真重复对落在 0.25~0.44，真不重复对落在 0.00~0.10，改到 0.2，两头都留安全边际。
- **重建时修复的遗漏**：`supports` 边的 `sourceRef.detail` 一开始漏写了 `batchId`（节点和 `duplicates` 边都写了，唯独 `supports` 边漏了），导致审批 tab 会把它错误拆成单独一组而不是并入捕获批次。本次重建时一次性写对，并加了回归测试锁住。

### 1.3 审批（R5，Week 2）—— ✅ 完成 2026-07-06
- [x] 提议态视觉：inbox / board / node 详情三视图统一虚线呈现 `proposed`（`border-dashed`，叠加在 P0 已有的"提议中"/"已确认"文字标签之上）
- [x] 审批页 `/review`：批量 diff 视图，按天 > 按捕获批次分组（`app/review/group.ts` 纯函数）。批次键复用 `sourceRef.detail.batchId`（worker 用 pg-boss 的 `job.id` 填充），零 schema 成本。**先落成独立页面，不是侧边栏内 tab**——1.4 再把同一套查询/actions 逻辑收纳进侧边栏
- [x] 风险分级落地（决策 C，1.2 已实现写入规则）：`acceptBatch`/`rejectBatch` 整批操作（并发调用单条 `confirmNode`/`confirmEdge`/`deleteNode`/`rejectEdge`）
- [x] 撤销路径：`revertEdge`（`lib/graph`，audit action `reverted` + 删边），镜像 `rejectEdge`
- [x] 接受/拒绝/撤销日志按边类型入库（`audit_log.edgeType`，v2 放权原料）

**发现并修复的真实 bug（非计划内条目，但直接堵塞本节功能）**：0001 迁移的 `guard_confirmed_edges` 触发器没有区分 risk，把所有已确认边（不论高低风险）都锁成永久不可删除/撤销——这与架构文档决策点 9（"低风险边自动生效可撤销"）、db/enums.ts 对 `blocks` 的注释（"不进信任账本"）矛盾。P0 没暴露这个问题是因为 P0 只有人工手动确认，没有"自动确认的低风险边"这个场景；给 `duplicates` 边写"撤销"功能时才第一次真正尝试删除一条已确认低风险边，直接被 DB 拒绝。用 `db/migrations/0004_low_risk_edges_revocable.sql` 重写触发器修复：只对**高风险**边保留信任账本约束，低风险边确认后可删除/撤销。回归测试：`db/__tests__/graph-kernel.test.ts` ③c、`db/__tests__/review.test.ts`。

### 1.4 AI 侧边栏（R6，Week 2–3）—— ✅ 完成 2026-07-06
- [x] 可开关侧边栏框架：`components/workbench-chrome.tsx`（Client Component）替换 `<aside>` 占位；`app/(workbench)/layout.tsx` 改 async，用 `cookies()` 读开关状态做首屏渲染，切换时 Client 端写 `document.cookie`（`lib/config.ts` 的 `SIDEBAR_OPEN_COOKIE` 常量防两处拼错）。**关闭时 `<aside>` 整个不渲染**（浏览器实测 `document.querySelector('aside')` 为 `null`），不是 CSS 隐藏
- [x] 锚定机制：`components/sidebar-context-panel.tsx`（Client，`usePathname()` 探测 `/node/:id` + 打新建的 `app/api/node/[id]/context/route.ts`）。**架构取舍**：Roadmap 原话"Server Component 直取"在这里做不到——布局包裹所有页面，拿不到 `/node/[id]` 这个子路由的动态段参数；改用客户端探测路径 + 打一个纯图查询的轻量 route handler，零模型调用
- [x] 捕获入口 tab + 审批 tab 收纳进侧边栏：`components/sidebar-capture-panel.tsx`（给 1.2 建好的 `/api/capture/text`、`/api/capture/file` 接上第一个 UI）+ `components/review-panel.tsx`（从 `app/review/page.tsx` 抽出的共享渲染逻辑，`/review` 独立页和侧边栏 tab 复用同一份组件/Server Actions）
- [x] **顺带把 1.0 建好但一直没人用的 SSE 基础设施接上**：`components/sidebar-live-refresh.tsx` 订阅 `/api/proposals/stream`，新提议落库后 `router.refresh()`（300ms 去抖）
- [x] **关闭态回归验证**：`<aside>` DOM 消失 + `SidebarLiveRefresh` 的 SSE 连接随组件卸载一起断开 + `/inbox` 创建证据表单在侧边栏关闭状态下完整可用

**一个 Next.js 16 lint 规则的经验**：`eslint-config-next` 的 `react-hooks/set-state-in-effect` 规则禁止在 effect body 里同步调用 `setState`（哪怕只是设置 loading 标志）。解法：`SidebarContextPanel` 用"结果对象自带它所属的 nodeId，loading 从两者是否一致 derive 出来"的模式，effect 里只在异步回调里 setState 一次。本次重建直接照此模式写，没有重踩这个坑。

### 1.5 提前的占位 surface（Week 3，只占位不做豪华编辑器）—— ✅ 完成 2026-07-06
- [x] 原型占位块：feature 节点新增「画布」tab（只对 feature 类型显示）。存在 `body.prototypes`，跟 BlockNote 的 `body.blocks` 共享同一个 JSONB 列，不需要新迁移
  - 贴图：剪贴板粘贴图片 → 客户端转 data URL（`components/prototype-paste-box.tsx`）→ Server Action 校验格式/大小（≤1.5MB）后存库，不需要额外的对象存储服务
  - Figma 链接：校验 `figma.com` 域名 → 自动构造 `figma.com/embed?...` iframe 嵌入 + "在 Figma 中打开"兜底链接
  - 原型可被 `implements` 边指向——沿用已有的边机制
- [x] Roadmap 视图：`lib/graph` 新增 `listRoadmapFeatures`，feature 节点按创建时间排列，状态（计划中/进行中/已完成）**不是新字段**，从它的 `implements` 入边连接的任务看板状态聚合推导——跟"看板=任务节点按状态渲染"同一个套路，纯视图层零 schema 成本

**顺手堵住的回归**：`saveNodeBody`（BlockNote 正文保存）原来是整体覆盖 `body: { blocks }`，1.5 给 feature 节点的 body 加了 `prototypes` 兄弟字段后，这个覆盖会静默冲掉已经贴好的原型——改成先读现有 body 再合并保存。本次重建时一次性写对。

### 🚪 P1 出口验收
- [ ] 粘贴 20 条杂乱反馈 → 捕获产出去重聚类提议 → 审批 tab 5 分钟内批完 → 落图，全程键盘零录入
- [ ] 故意投喂垃圾输入：提议可整体拒绝，图无污染

---

## 五、验收测试计划
- **捕获流水线单测**：mock 输出 → zod 校验 → 提议节点/边写入，断言出处 + 置信度 + `createdBy: 'capture'`（`db/__tests__/capture-contract.test.ts`，含 batchId 回归）
- **风险分级单测**：低风险边落 `confirmed`、高风险边落 `proposed`；撤销路径写 `reverted` 且图无残边（`db/__tests__/graph-kernel.test.ts` ③c）
- **去重粗匹配单测**：`lib/agents/__tests__/dedup.test.ts`，锁住阈值校准的行为
- **审批数据源单测**：`db/__tests__/review.test.ts`，pending/revocable 正确区分
- **Roadmap 状态推导单测**：`db/__tests__/roadmap.test.ts`，三态 + 排序
- **双凭证测试**：`db/__tests__/readonly-role.test.ts`，`dbReadonly` 执行 INSERT/UPDATE/DELETE 被 DB 拒绝
- 沿用 P0 约定：`vitest.config.ts` 已设 `fileParallelism: false`（共享本地 Postgres）

## 六、P1 明确不做（防蔓延）
- ❌ 检索 / 追溯 / Cmd-K —— P2（只把双凭证角色建好待用）
- ❌ embedding / 语义索引填充 —— P2
- ❌ 冷启动导入器（Notion/飞书）—— P2
- ❌ 推进 Agent / 判断 Agent —— P4 / P5（合同类型先立，不实现）
- ❌ 全事件驱动多 Agent 协作总线 —— P2 检索登场时接（决策 A）
- ❌ 真实邮件收信基础设施 —— P4（P1 只留 webhook 占位，决策 B）
- ❌ Excalidraw 画布 —— P5（1.5 只贴图/嵌链接）
- ❌ 认证 / 多用户 / 项目切换 —— 仍用 `DEFAULT_PROJECT_ID` 单项目
- ❌ 自动放权 / 信任刻度 —— 写死审批规则，只记接受率数据（决策点 10）

## 七、风险登记（Phase 1 专项）
| 风险 | 信号 | 预案 |
|---|---|---|
| 捕获质量不达标 | dogfooding 接受率 <50% | 缩范围只做反馈头（弃会议头），提高单类精度 |
| 审批疲劳 | 日审批 >10 分钟 或"全选通过"行为 | 先降捕获产量，宁少勿滥 |
| 异步 UX 复杂度 | SSE + LISTEN/NOTIFY 前端集成卡壳 | 降级为前端轮询提议表 |
| 11s 延迟拖垮批量捕获 | 20 条串行 = 数分钟 | worker 并发消费；捕获按批并行而非逐条 |
| **本地文件夹意外丢失（新增，2026-07-06 实际发生过）** | 一整天工作未提交就没了 | **每个子阶段做完立即 commit**（本文件此后严格执行）；重要节点 push 到远端 |
| 范围蔓延 | 冒出任何 P2+ 功能 | 写入 Roadmap 停车场，不进 Phase 1 |

## 八、待决事项（P1 内定，不阻塞开工）
- **D3 embedding 模型**：DeepSeek 有无 embedding？否则本地 bge / 走 LiteLLM 另配——P2 才用，P1 末定即可
- **审批风险默认线的完整清单**：决策 C 已定高/低风险边归类（沿用 `HIGH_RISK_EDGE_TYPES`）；"用户可改"的配置化留到 P4 审批面板
- **worker 生产部署形态**：dev 单独进程已够；上线时拆独立服务还是同容器多进程，P1 末评估
- **交互风格备忘（2026-07-06 讨论）**：P2 检索栏的答案应该是自然语言段落，引用以行内蓝色链接嵌入句子中（点开直达节点），不是列表/卡片式的"来源"区块。P1 侧边栏"上下文"面板目前是结构化的边列表，P2 检索栏做完后一并回头看要不要把"上下文"面板也改写成同样的自然语句+行内链接风格，到时候整体感受一遍再决定。

## 九、开工第一步

~~1.0 运行时地基~~ ~~1.2 捕获 Agent~~ ~~1.3 审批~~ ~~1.4 AI 侧边栏~~ ~~1.5 占位 surface~~ **全部完成 2026-07-06**（含一次因本地文件夹意外丢失导致的重建，凭 git 上的 Phase 0 提交 + 完整会话记忆原样恢复）。

下一步：跑一遍 **P1 出口验收**——粘贴 20 条杂乱反馈的完整故事线，验证全流程 5 分钟内批完、垃圾输入可整体拒绝。验收通过后进入 Phase 2（检索/追溯 + 冷启动导入）。
