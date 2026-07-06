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

### 0.2 工作台外壳 + 四视图（Day 5-8）—— ✅ 完成 2026-07-05
- [x] 三栏布局外壳（左导航 / 中变形栏 / 右侧栏占位，AI 侧栏 P1 才填）
- [x] 反馈收件箱：证据节点列表 CRUD（`app/(workbench)/inbox`）
- [x] 看板：任务节点按状态列，`@dnd-kit` 拖拽改 `board_status`（`app/(workbench)/board` + `components/board-client.tsx`）
- [x] 节点详情页 `/node/[id]`：中央变形栏 + tabs（正文 / 关联边 / 出处），outcome 类型专属指标表单
- [x] 结果节点：手动录入指标快照表单
- [x] 手动连边 UI：边类型下拉 + `NodePicker`（选已有或即时新建目标节点）+ 可选"为什么"写入出处
- [x] 单一数据源验证：Server Component 直读 Postgres，无客户端缓存，`revalidatePath` 保证多视图同步

**新增 schema（决策记录）**：`nodes.board_status` 枚举列（todo/in_progress/done），与 `nodes.status`（提议中/已确认信任账本轴）正交独立，见迁移 `0002_task_board_status.sql`。手动创建的节点/边默认 `proposed`，通过详情页/收件箱的"确认"按钮进入信任账本——CRUD 需求与已有硬约束（已确认不可删除）完全兼容。

**验证方式的调整（重要）**：浏览器自动化点击在这次的 preview 环境里遇到工具本身的限制——点击/`.click()`/`requestSubmit()` 均确认事件到达 DOM，但未能触发 React 19 对 `<form action={serverAction}>` 的拦截（先后排除了两个假说：viewport 过窄导致 `<aside>` 遮挡按钮的真实布局 bug，已修复；以及 stale HMR 的 action 引用，重启+清缓存后依旧复现）。用 curl 直接构造 Next.js 的 no-JS 渐进增强表单编码（`$ACTION_ID_xxx` + multipart/form-data）验证了 `createEvidence` 端到端可用（写库+重渲染），证明底层机制正确；随后补充 `db/__tests__/node-crud.test.ts`（5 个用例，覆盖 `getNode`/`updateNode`/`confirmNode`/`deleteNode`/`listAllNodes`）作为新函数的主要验证手段，全部通过。最后用脚本直接调用 `lib/graph` 跑通完整出口验收链（3 证据→1 需求 supports→2 任务 implements→1 结果 validates），并在浏览器中逐页 `preview_snapshot` 视觉确认渲染正确（收件箱/看板/需求详情/结果指标表单/出处 tab 全部截图核对）。
- **副产品修复**：`vitest.config.ts` 加 `fileParallelism: false`——两个测试文件共享同一本地 Postgres 并用 TRUNCATE 重置状态，并行跑文件会互相冲突甚至死锁，这个坑不修会在 CI 里更隐蔽地复现。

### 0.3 文档编辑器 spike（Day 5，与 0.2 并行）—— ✅ 完成 2026-07-05
- [x] TipTap 与 BlockNote 各接一个最小 demo，存 JSONB、读回渲染——两者 JSONB 往返均无损（vitest 之外用 preview 逐项核对：标题/列表/加粗/斜体全部保留）
- [x] **定选型（D2）：BlockNote。** 理由：
  - 两者都通过硬指标（JSONB 无损往返），非阻塞项
  - BlockNote 开箱即带 Notion 式 slash 命令/拖拽手柄/格式工具栏，命中产品定位里"很像 Notion 的 block 编辑体验"；TipTap 更灵活但需要自建这套 UI chrome
  - BlockNote 底层就是 TipTap/ProseMirror（`@tiptap/core` 是其依赖），选 BlockNote 不等于放弃 TipTap 生态的可扩展性（自定义 inline content 仍可做 @节点提及）
  - 代价：JSON 结构更冗长（每个 block 带 id/props，即使默认值）——Phase 0 规模下不是问题；且 BlockNote 构造时访问 `window`，SSR 场景必须走 `next/dynamic(ssr:false)`（已建 `components/node-body-editor-loader.tsx` 封装，一次性成本）
  - 落地：`components/node-body-editor.tsx` + `-loader.tsx`，接入 `/node/[id]` 正文 tab（evidence/feature/task 类型），`body` 存 `{ blocks: BlockNote.Block[] }`；outcome 类型仍用专属指标表单，不受影响
- [x] 已移除未选中的 TipTap 依赖（`@tiptap/react`/`@tiptap/pm`/`@tiptap/starter-kit`）及全部 spike 路由

### 0.4 模型链路连通性 spike（Day 9，风险前置）—— ✅ 完成 2026-07-05／06
> 不写业务 Agent，只验证"AI SDK → LiteLLM → DeepSeek 结构化输出"这条命脉稳不稳。
- [x] 自部署 LiteLLM proxy（`docker-compose.litellm.yml`），配 `deepseek-v4-pro`，暴露 OpenAI 兼容端点
- [x] AI SDK `createOpenAICompatible` 指向 LiteLLM，跑通结构化输出
- [x] **压测**：`lib/ai/spike-stress-test.ts`，从 5 条混合反馈抽取结构化证据条目，跑 20 次
- [x] 结论写入风险登记（见下）：**达标，100% 成功率**，P1 捕获 Agent 可按此链路搭建

**压测结果：成功率 100.0%（20/20），平均延迟 10805ms/次。**

**关键发现（决定 P1 捕获 Agent 怎么写，比压测数字本身更重要）：**

1. **`deepseek-v4-pro` 拒绝 `response_format: json_schema`**——报错"This response_format type is unavailable now"。`generateObject`/`Output.object()` 这条路走不通（除非退化成不带 schema 的裸 `json_object`，那样模型会自己瞎编 JSON 形状，完全不认我们传的 zod schema）。
2. **`deepseek-v4-pro` 是"思考模式"（reasoning）模型，拒绝强制 `tool_choice`**（指定具体工具、或 `'required'`）——报错"Thinking mode does not support this tool_choice"。
3. **唯一稳定跑通的策略：tool-calling + `toolChoice: 'auto'` + prompt 里明确要求调用工具。** 100% 成功率验证。**P1 捕获 Agent 必须照此模式搭建**，不要指望 response_format 或强制 tool_choice——这两条路在这个模型上都是死路。
4. **延迟较高（平均 10.8 秒/次，最高 18 秒）**，符合"思考模式"模型的预期（推理耗 token）。**UX 含义**：捕获 Agent 面向用户的交互必须设计成异步/后台处理，不能是阻塞式同步等待。
5. **两个 LiteLLM/docker 配置坑**（记录避免以后重踩）：
   - docker compose 的 `environment: ${VAR}` 替换是 compose CLI 自己的机制，只认同目录字面量 `.env` 文件，不认 `env_file:`；写错会静默替换成空字符串，还会覆盖 `env_file` 已经正确注入的值。
   - 不能把整个 `.env.local` 通过 `env_file` 塞给 litellm 容器——里面的 `DATABASE_URL` 会被 LiteLLM 自动识别当成它自己的后端 Postgres 去连，容器内 `127.0.0.1:54322` 连不到宿主机的 Supabase。已改用专门的 `litellm/.env`（只放 `DEEPSEEK_API_KEY`/`LITELLM_API_KEY`，已 gitignore）。
   - `@ai-sdk/openai-compatible@3.0.5` 的 `.languageModel(id, config)` 第二个参数被静默忽略（`.d.ts` 比实际实现新）；`supportsStructuredOutputs` 只能在 `createOpenAICompatible()` 顶层设置，对该 provider 建出的所有模型全局生效。
6. **另一个环境坑**：独立 tsx 脚本里 `import` 会被提升到所有代码之前执行——`config({path:'.env.local'})` 写在 import 语句之后并不能保证先跑。`lib/ai/client.ts` 已改成惰性构造（函数而非顶层 const）规避这个问题。

### 0.5 出口验收（Day 10）—— ✅ 完成 2026-07-06
- [x] **纯手动完整链**：3 条证据（已确认）→ 1 个需求"结算页支持微信支付"（3 条 supports 边）→ 2 张任务卡（2 条 implements 边）→ 1 条结果"支付转化率 +12%"（1 条 validates 边）——DB 直查 + 浏览器 `/inbox`、`/board`、`/node/[id]?tab=edges` 逐页截图核对，6 条边全部"已确认"、标题/类型/深链渲染无误
- [x] 任一节点修改即时反映到所有视图（Server Component 直读 + `revalidatePath`，0.2 已验证机制成立）
- [x] AI 尚不存在，工作台全功能可用（降级态即出生态）——右侧栏全程只是"Phase 1 实现"占位文案，三个视图和图内核完全不依赖任何 AI/LiteLLM 组件
- [x] 全部验收测试绿（11/11，vitest）；CI 绿（GitHub Actions，Phase 0 四次提交全部 success）
- [x] 打 tag `v0.1.0-phase0`

**Phase 0 收尾总结**：地基（Next.js 16 + Drizzle + Supabase 本地 + AGPL）、图内核（4 节点/8 边 + 硬约束触发器）、三视图 CRUD、BlockNote 文档编辑器、LiteLLM/DeepSeek 连通性全部按计划完成，且比原定 10 天估算提前。过程中处理的非计划内但有价值的发现：三栏布局窄视口遮挡 bug（已修）、浏览器自动化点击与 React 19 Server Action 表单拦截的工具兼容性问题（未根治，改用等效验证路径）、vitest 并行测试文件共享 DB 的死锁问题（已修）、deepseek-v4-pro 结构化输出的正确策略（tool-calling + auto，已文档化进 Agent架构设计.md，直接影响 Phase 1 捕获 Agent 的实现方式）。

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
