# Phase 0 开工计划：图内核 + 四类节点最小 surface

> 上游：《Roadmap.md》Phase 0 · 《Agent架构设计.md》(R1 图内核) · 《PRD-MVP.md》(R1/R2)
> 目标（出口）：**AI 一行代码没有，但工作台已是完整可用工具**——纯手动建齐一条 证据→需求→任务→结果 完整链，任一节点改动即时反映到所有视图。
> 估算 2 周（2026-07-07 → 07-18）。

---

## 一、技术栈定案（2026-07-05）

| 层 | 选型 | 备注 |
|---|---|---|
| 语言/框架 | TypeScript + Next.js（App Router，单应用起步） | worker 先作内部脚本，需要独立部署时再拆 monorepo |
| 数据库 | Postgres + pgvector，**Supabase 本地栈**（Supabase CLI 起 Docker） | 上线迁移 Supabase 云零摩擦；现在仍纯本地 |
| ORM/迁移 | **Drizzle** | SQL 原生，触发器/pgvector/枚举约束友好；自定义 DDL 走 SQL 迁移文件 |
| Schema 校验 | zod（与 Drizzle 枚举单一来源） | 边类型等枚举 zod 与 DB 同源，防漂移 |
| 编辑器 | **待 spike**（TipTap vs BlockNote，1 天封顶） | 选型看手感 + JSON 存储契合度 |
| 模型接入 | Vercel AI SDK → **LiteLLM proxy** → DeepSeek | AI SDK 负责 `generateObject`/结构化；LiteLLM 负责 provider 抽象，换模型改一行配置。**Phase 0 仅搭通链路 + 压测结构化输出，不写业务 Agent** |
| 任务队列 | pg-boss（Postgres 上，单库） | Phase 0 只装不用，Phase 1 才跑 worker |
| 前端组件 | 看板拖拽 dnd-kit；图表待 P4 | 均 MIT |

### 待办决定（不阻塞开工，spike 中定）
- D2：TipTap vs BlockNote（0.4 任务）
- D3：embedding 模型（DeepSeek 有无 embedding？否则本地 bge / 走 LiteLLM 另配）——Phase 0 只留列，索引到 P2 才用

---

## 二、目录结构（单 Next.js 应用）

```
omphalos/
├─ app/                    # Next.js App Router
│  ├─ (workbench)/         # 三栏工作台外壳
│  │  ├─ inbox/            # 反馈收件箱（证据视图）
│  │  ├─ board/            # 看板（任务视图）
│  │  └─ node/[id]/        # 节点详情（变形中央栏 + tabs）
│  └─ api/                 # route handlers
├─ db/
│  ├─ schema.ts            # Drizzle schema（节点/边/出处/确认）
│  ├─ enums.ts             # 节点/边类型枚举（zod + drizzle 同源）
│  ├─ migrations/          # drizzle-kit 生成 + 手写 SQL（触发器）
│  └─ client.ts
├─ lib/
│  ├─ graph/               # 图操作核心（建节点/连边/查邻域/查出处）
│  └─ ai/                  # LiteLLM 客户端封装（Phase 0 仅连通性）
├─ components/             # 视图组件（编辑器、卡片、连边 UI）
├─ supabase/               # supabase CLI 本地配置
├─ drizzle.config.ts
├─ .env.local             # (gitignored)
└─ docker-compose 由 supabase CLI 托管
```

---

## 三、图内核 schema 设计（核心，最先做）

### 枚举（db/enums.ts，zod + drizzle 同源）
- `node_type`: evidence（证据）| feature（需求）| task（任务）| outcome（结果）
- `edge_type`: supports（支撑）| implements（实现）| validates（验证）| refutes（证伪）| because（因为）| supersedes（取代）| duplicates（重复）| blocks（阻塞）
- `edge_risk`: high（因为/验证/证伪/支撑）| low（重复/阻塞/标签）
- `status`: proposed（提议中）| confirmed（已确认）

### 表

**nodes**
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | |
| type | node_type | |
| project_id | uuid | scope 字段（逻辑分割） |
| title | text | |
| body | jsonb | 编辑器内容（需求 PRD / 证据原文等） |
| status | status | 默认 proposed |
| embedding | vector | 留列，Phase 0 不填（P2 用） |
| created_at / updated_at | timestamptz | |

**edges**
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | |
| type | edge_type | 非法值 DB check 约束拒绝 |
| risk | edge_risk | |
| src_id / dst_id | uuid fk → nodes | |
| project_id | uuid | 跨界边允许 src/dst 不同 project |
| status | status | |
| created_at | timestamptz | |

**provenance**（出处，每条边/AI 节点必须有）
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | |
| edge_id / node_id | uuid | 关联对象 |
| source_ref | jsonb | 原始输入片段引用 |
| created_by | text | 'human' 或 agent 合同名 |
| confidence | real | AI 置信度，人工为 null |

**audit_log**（确认记录，append-only）
| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | |
| target_type / target_id | | node 或 edge |
| action | text | proposed / confirmed / rejected / reverted |
| actor | text | |
| edge_type | edge_type | 便于 P1 按边类型统计接受率 |
| at | timestamptz | |

### 硬约束（数据库层，不靠应用自觉）
- [x] `edges.type` / `nodes.type` 绑定枚举 —— Postgres 原生 ENUM 类型即已保证非法值报错，无需额外 CHECK
- [x] **append-only 触发器**：`audit_log` 禁止 UPDATE/DELETE；`provenance` 禁止 UPDATE（DELETE 允许级联，用于拒绝态提议的清理）
- [x] 边写入触发器：deferred constraint trigger，无 provenance 行的 edge 在事务提交时被拒
- [x] 手写 SQL 迁移承载上述触发器（`db/migrations/0001_graph_kernel_guardrails.sql`）
- [x] 额外加固（超出原计划）：`edges`/`nodes` 已确认后不可删除、关键字段不可改（"trust ledger"）；risk 由 DB 触发器权威派生，不信任应用层

---

## 四、任务分解（勾选推进）

### 0.0 环境与地基（Day 1）—— ✅ 完成 2026-07-05
- [x] `create-next-app`（TS、App Router、Tailwind、Next.js 16 + Turbopack）
- [x] Supabase CLI 初始化 + 本地栈起 Postgres+pgvector（`supabase start`）
- [x] Drizzle 接入 + drizzle.config + 首个空迁移跑通
- [x] `.env.local` 约定（DB_URL、LITELLM_BASE_URL、DEEPSEEK_API_KEY）+ `.env.example` 提交
- [x] CI：GitHub Actions，lint + typecheck + test + build（用 `pgvector/pgvector:pg17` 作为服务，而非完整 Supabase 栈）
- 备忘：Next.js 16 breaking changes 已核对（`params`/`searchParams` 全部转 Promise，需 `await`；`middleware`→`proxy`；本项目 Phase 0 尚无 middleware，不受影响）

### 0.1 图内核（Day 2-4）—— ✅ 完成 2026-07-05
- [x] enums.ts（zod + drizzle 同源，`edgeRiskOf()` 计算高/低风险）
- [x] schema.ts 四张表（nodes/edges/provenance/audit_log）
- [x] 手写 SQL 迁移：见上方硬约束清单
- [x] `lib/graph`：建节点 / 连边（同事务写出处）/ 确认 / 拒绝（删除+留 audit）/ 查一跳邻域 / 查出处链
  - 一跳邻域（非完整 k 跳遍历）对 Phase 0 已足够；k 跳上下文装配是 P1 Agent 运行时的事（见 Agent架构设计.md 5.1）
- [x] **验收测试（vitest，全绿）**：① 非法边类型报错（原生 ENUM） ② 无出处边写入被拒（deferred trigger） ③ audit_log 不可 UPDATE/DELETE；已确认边不可删除/改关键字段 ④ 出处链完整可查（谁创建/基于什么/置信度）

### 0.2 工作台外壳 + 四视图（Day 5-8）—— 🚧 进行中（外壳骨架已搭，CRUD 待接图内核）
- [x] 三栏布局外壳（左导航 / 中变形栏 / 右侧栏占位，AI 侧栏 P1 才填）—— 已用 preview 验证导航与渲染无误
- [ ] 反馈收件箱：证据节点列表 CRUD
- [ ] 看板：任务节点按状态列（dnd-kit 拖拽改状态）
- [ ] 节点详情页 `/node/[id]`：中央变形栏 + tabs（正文 / 关联边 / 出处）
- [ ] 结果节点：手动录入指标快照表单（**P0 就纳入**）
- [ ] 手动连边 UI：任意节点选类型→选目标→（高风险边）填出处→建边
- [ ] 单一数据源验证：一处改动，多视图即时刷新

### 0.3 文档编辑器 spike（Day 5，与 0.2 并行）
- [ ] TipTap 与 BlockNote 各接一个最小 demo，存 JSONB、读回渲染
- [ ] 定选型（D2），文档页（需求节点正文）用选中者落地

### 0.4 模型链路连通性 spike（Day 9，风险前置）
> 不写业务 Agent，只验证"AI SDK → LiteLLM → DeepSeek 结构化输出"这条命脉稳不稳。
- [ ] 自部署 LiteLLM proxy（Docker），配 DeepSeek，暴露 OpenAI 兼容端点
- [ ] AI SDK `createOpenAICompatible` 指向 LiteLLM，跑通 `generateObject`
- [ ] **压测**：给一个"从 5 条反馈抽取结构化证据节点"的 zod schema，跑 20 次，测 DeepSeek 结构化输出的成功率/稳定性
- [ ] 结论写入风险登记：达标则 P1 捕获 Agent 按此搭；不达标则评估换模型（LiteLLM 换一行）或加 schema 修复层

### 0.5 出口验收（Day 10）
- [ ] **纯手动完整链**：录 3 条证据 → 建 1 个需求（挂 supports 边）→ 拆 2 张任务卡（挂 implements 边）→ 录 1 条结果（挂 validates 边）
- [ ] 任一节点修改即时反映到所有视图
- [ ] AI 尚不存在，工作台全功能可用（降级态即出生态）
- [ ] 全部验收测试绿，CI 绿
- [ ] 打 tag `v0.1.0-phase0`

---

## 五、Phase 0 明确不做（防蔓延）
- ❌ 任何业务 Agent（捕获/检索/推进/判断）—— P1 起
- ❌ 语义检索 / embedding 填充 —— P2
- ❌ AI 侧边栏交互 —— P1（0.2 只留右栏占位）
- ❌ 原型画布、Roadmap 视图 —— P1
- ❌ 冷启动导入器 —— P2
- ❌ 认证/多用户 —— 单用户本地起步
- ❌ 富文本协同（CRDT）—— P5，编辑器 spike 只做单人编辑

## 六、风险登记（Phase 0 专项）
| 风险 | 信号 | 预案 |
|---|---|---|
| DeepSeek 结构化输出不稳 | 0.4 压测成功率 <90% | LiteLLM 换模型（改配置）或加 zod 修复重试层；结论前置到 Phase 0 就是为此 |
| Drizzle 触发器/pgvector 摩擦 | 迁移写不出触发器 | 触发器用纯手写 SQL 迁移文件，绕过 drizzle-kit 生成 |
| 编辑器 JSONB 往返丢格式 | spike 存读不一致 | 选型即以"JSONB 无损往返"为硬指标 |
| 范围蔓延 | 冒出任何 P1+ 功能 | 记进《Roadmap.md》停车场，不进 Phase 0 |

---

## 七、开工第一步
`create-next-app` + `supabase start` + Drizzle 空迁移跑通（即 0.0）。确认计划后我就开始搭 0.0 骨架。
