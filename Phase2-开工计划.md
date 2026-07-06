# Phase 2 开工计划：检索/追溯 + 冷启动导入

> 上游：《Roadmap.md》Phase 2（2.1–2.3）·《PRD-MVP.md》R4/R7 + Demo 故事线 ·《Agent架构设计.md》决策点 1/2（两段式检索）。
> 目标（出口）：**Demo 故事线 5 步完整可演** —— 导入真实历史 → 审批确认因果边 → Cmd-K 问"X 当初为什么" → 回答每句挂行内深链直达节点 → 关侧边栏工作台仍完整可用；外加检索评估集精确率达标（**错误引用 0 容忍**）。
> 估算 3 周。承接 P1：图内核 4 表、`lib/graph` 唯一写入口、pg-boss 队列、只读凭证 `getDbReadonly()`、LiteLLM 模型抽象、侧边栏外壳、审批 tab（SSE）均已就位。

---

## 一、开工前写死的关键决策

三个决策与产品负责人确认（2026-07-06）：

### 决策 E：embedding 走 API OpenAI 兼容（1536 维），经 LiteLLM 一行配置可换
- schema 的 `nodes.embedding vector(1536)` 已按 1536 维预留，选 `text-embedding-3-small` 类模型**零 schema 改动**。
- 与 `lib/ai/client.ts` 同构：`getEmbeddingModel()` 只认 LiteLLM，换供应商改 `litellm/config.yaml`。内部团队本地嵌入模型诉求（OQ3）延后——LiteLLM 已是可换点，不提前造第二层抽象。

### 决策 F：检索生成用独立"快模型" + 流式，与捕获模型分离
- 捕获用 `deepseek-v4-pro` 思考模型延迟 ~11s，交互式 Cmd-K"哇时刻"不能等；架构 5.2"按角色配模型"允许。`litellm/config.yaml` 多配 `fast` 别名，`lib/ai/client.ts` 加 `getFastModel()`，检索用 `streamText` 流式。

### 决策 G：检索不复用 `runPipeline`，零幻觉靠结构性护栏
- `runPipeline` 是"写提议"的流水线；检索是"读+生成答案"，全程走**只读凭证** `getDbReadonly()`（架构 5.2 物理只读）。
- 生成层给每个可达节点配一个短句柄（E1/F2…），模型只引用句柄；服务端把句柄与"遍历可达节点集合"求交，非法句柄确定性剥离。这是"错误引用 0 容忍"的**真正**保证点，可脱 LLM 单测——不靠模型自律。

### 决策 H：导入用独立 import 合同，不动已出口验收的 paste 捕获合同
- paste 捕获刻意"不臆测新需求，只挂已存在候选"；冷启动图是空的，历史必须熔成**新建**的 feature/证据 + `because`/`supports` 边——需求正相反。
- import 复用 `runPipeline` + `lib/graph` + 决策 C 风险分级，但用一份更宽的 `outputSchema`（允许 feature 节点 + because 边）。paste 合同不改、不回归。`ContractName` 加 `import`。

### 决策 I：P2 导入器 = 通用 MD/CSV + Notion 一个；飞书导入器与 5000 条压测顺延 P4
- 出口只需"一份"真实历史即可演示。飞书导出格式解析 + 大批量压测会顶满 3 周盒子，写入 P4/停车场。

---

## 二、技术栈增量（相对 P1）

| 层 | 新增 | 落地 |
|---|---|---|
| Embedding | LiteLLM `embedding` 模型 + `getEmbeddingModel()` | AI SDK `embed`/`embedMany`，1536 维 |
| 检索模型 | LiteLLM `fast` 别名 + `getFastModel()` | `streamText` 流式 |
| 向量索引 | 迁移 `0005`：`nodes.embedding` 的 HNSW cosine 索引 | `vector_cosine_ops` |
| 任务队列 | pg-boss `embed` + `import` 队列 | 与 capture 同构，worker 并发即并行 |
| 依赖 | `adm-zip` 解 Notion 导出包 | pure JS |
| 前端 | 全局 Cmd-K 命令面板 | ⌘K 唤起，行内蓝链引用 |

---

## 三、任务分解（全部完成 2026-07-06）

### 2.1 语义索引 —— ✅ 完成
- [x] `litellm/config.yaml` 加 `embedding` / `fast`；`.env.example` 补 `OPENAI_API_KEY`。
- [x] `lib/ai/client.ts`：`getEmbeddingModel()` / `getFastModel()`（惰性构造）。
- [x] `lib/embed/index.ts`：`nodeEmbeddingText` 拍平三种 body 形状（evidence `{text}` / feature·task `{blocks}` 递归抽 BlockNote 文本 / outcome `{metric,value,note}`）；`embedNode`/`embedNodes` 写回。embedding 是派生元数据，直连 UPDATE，不进 audit_log。
- [x] pg-boss `embed` 队列 + worker handler；`createNode`/`updateNode`（仅 title/body 变化）提交后异步入队，失败不连累写入。**单测里 `VITEST` 短路不起 boss**。
- [x] `0005_embedding_index.sql`：HNSW cosine 索引（已 `db:migrate` 应用）。
- [x] `lib/retrieval/search.ts`：`semanticSearch` 只读凭证 + 只认 confirmed 节点 + 升级式检索（局部无果查全局标注来源）；`embedQuery`。

### 2.2 检索 Agent + Cmd-K —— ✅ 完成
- [x] `lib/retrieval/traverse.ts`：从入口 BFS 有界遍历（2 跳），**只走 confirmed 边**、只纳入 confirmed 节点（proposed 高风险因果边对追溯不可见，PRD R5）。
- [x] `lib/retrieval/cite.ts`：短句柄引用护栏（决策 G）——`assignHandles`/`buildSourceList`/`parseCitedAnswer`，非法句柄剥离，确定性可脱 LLM 单测。
- [x] `lib/retrieval/answer.ts`：两段式串联 + `streamText`（快模型）；入口/子图为空直接走 `NO_RECORD_MESSAGE`，不进模型。
- [x] `app/api/retrieval/route.ts`：首行 JSON 元数据 + 流式正文分帧；前置失败兜底返回 `{kind:error}`。
- [x] `components/cmd-k-search.tsx`：⌘K 面板，边收边用 cite.ts 解析行内蓝链；**随 AI 侧边栏开关，关闭态不挂**（G5）。
- [x] 检索评估集 v1：`eval.fixtures.ts`（种子图 + 21 问答对，含 6 应拒答）+ `eval.test.ts` CI 层（评估集自洽 + 引用护栏跑遍评估集）；live 端到端层 gated 待补。

### 2.3 冷启动导入 —— ✅ 完成
- [x] `lib/agents/preprocess/import.ts`：import 头（不登记进 capture 的 HEADS 表）。
- [x] `lib/agents/contracts/import.ts`：import 合同（决策 H），ref 声明节点→连边，ref 解析不到即跳过（宁可漏挂不可错挂）。
- [x] `lib/import/notion.ts`：解 Notion "Markdown & CSV" zip → 每页/每表一份 `ImportDoc`（标题去 32 位 hex id、CSV 转逐行文本）。
- [x] `app/api/import/route.ts`：.zip/.md/.txt/.csv 拆分入队，同批 `batchId`，结果走已有审批通路。
- [x] `app/(workbench)/import/page.tsx` + nav"导入"入口。
- [x] worker import handler（batchId 用上传值，非 job.id）。

---

## 四、验收 / 验证

**自动化（全绿）**：`pnpm test` 64 用例（63 通过 + 1 live 占位跳过），`pnpm typecheck`、`pnpm lint` 均干净。新增覆盖：
- `lib/embed`：三种 body 形状文本抽取。
- `lib/retrieval/cite`：引用护栏保真剥假、大小写、去重（**0 容忍把关点**）。
- `lib/retrieval/eval`：评估集自洽 + 护栏跑遍全集。
- `lib/import/notion`：zip 解析。
- `db/import-contract`：applyOutput 冷启动熔图落库（连真库）。

**preview 手动核对**：`/inbox /board /roadmap /review /import` 全 200；导入页渲染正常；⌘K 面板正确开合、带 idle 提示；**关 AI 侧边栏后 Cmd-K 不挂载**（G5 确认）；`/api/retrieval` 请求正确抵达 LiteLLM `/embeddings`，模型不可用时干净降级为"出错了"而非卡死。

> **⚠️ 验证方式说明（同 P0/P1 惯例）**：本环境 `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` 未配、且在跑的 LiteLLM 容器是 12 小时前用旧 config 起的（无 `embedding`/`fast` 模型）。因此**依赖真实模型的 5 步 demo 端到端（真向量化 + 真生成 + 真熔图）尚未在本机跑通**——失败点确认为纯环境/供应商配置（请求已正确成形并路由到 LiteLLM，报错是 proxy 侧"Invalid model name / 无 key"），不是代码缺陷。补齐步骤：填 `DEEPSEEK_API_KEY`+`OPENAI_API_KEY` → `pnpm litellm:stop && pnpm litellm:start` 重载新 config → 起 `pnpm worker` → 跑 `RUN_RETRIEVAL_EVAL=1` 端到端评估 + 手动走 5 步 demo。确定性的零幻觉护栏已由 `cite.test.ts` 脱机坐实，不依赖上述环境。

---

## 五、明确不做（顺延 P4/停车场）

- 飞书导入器、5000 条并行压测（决策 I）。
- 邮件真实收信、指标自动进食、推进 Agent（P4+）。
- 多项目/鉴权重构——仍用 `DEFAULT_PROJECT_ID`；升级式检索的"全局"先指全部 project scope。
- 把 P1 侧边栏"上下文"面板改写成自然语句风格——Roadmap 2.2 备忘：Cmd-K 做完后整体感受一遍再决定，留到出口验收后回看。

## 六、待补（不阻塞子阶段，出口验收前收口）

- live 端到端评估层实现（`eval.test.ts` 的 gated describe）：seedEvalGraph → embedNodes → answerQuestion 逐题断言引用 ⊆ 种子、应拒答返回 no_record。
- 真实 Notion 导出包跑一遍 5 步 demo，补记踩坑。
