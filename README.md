# Omphalos

**AI-native 产品经理工作台。图是第一等公民，其他一切都是它的推论。**

> 产品工作的价值不在文档里，在文档之间的关系里。roadmap、PRD、看板、反馈收件箱——都不是独立的工具，而是同一张产品语义图的不同视图。

## 核心理念

- **4 节点心跳**：证据 → 需求 → 任务 → 结果。一条用户反馈如何变成一个功能、拆成任务、上线后被指标验证或证伪。
- **8 种有类型的边**：支撑 / 实现 / 验证 / 证伪 / 因为 / 取代 / 重复 / 阻塞。因果关系是一等公民，不是聊天记录里的碎片。
- **一键追溯**：对任意需求/决策，问"当初为什么这么定"，得到带应用内深链的回答——不是生成的推测，是从图上遍历出来的事实。
- **工具即 body**：所有工具（文档、看板、反馈收件箱）原生长在同一个代码库、共用同一个数据库，不做 API/MCP 拼接。
- **降级完整**：AI 侧边栏可随时关闭，工作台仍是一个功能完整的工具。

## 文档

- [产品理念与MVP讨论.md](./产品理念与MVP讨论.md) —— 核心理念、目标用户、冷启动与最小心脏
- [Agent架构设计.md](./Agent架构设计.md) —— 图内核、Agent 运行时、记忆架构、技术选型
- [PRD-MVP.md](./PRD-MVP.md) —— MVP 需求文档
- [开源选型表.md](./开源选型表.md) —— 相关开源项目的解剖与借鉴
- [Roadmap.md](./Roadmap.md) —— 分阶段开发计划与出口标准
- [Phase0-开工计划.md](./Phase0-开工计划.md) —— 当前阶段的技术栈定案与任务分解

## 开发

技术栈：Next.js（TS）+ Drizzle + Postgres/pgvector（本地走 Supabase CLI，上线迁移 Supabase 云）+ Vercel AI SDK → LiteLLM → DeepSeek。

```bash
pnpm install
cp .env.example .env.local   # 按本地 supabase status 填 DATABASE_URL，另填 DEEPSEEK_API_KEY
pnpm supabase:start          # 起本地 Postgres+pgvector（首次会拉取镜像，较慢）
pnpm db:migrate              # 应用迁移（含图内核的硬约束触发器）
pnpm dev
```

Agent 相关开发还需要 LiteLLM 代理（把 DeepSeek 包成 OpenAI 兼容端点）：

```bash
cp litellm/.env.example litellm/.env   # 填 DEEPSEEK_API_KEY
pnpm litellm:start                     # 起 LiteLLM（http://127.0.0.1:4000）
pnpm litellm:stop
```

常用命令：`pnpm test`（vitest）、`pnpm typecheck`、`pnpm lint`、`pnpm db:studio`（Drizzle Studio 查图）。

## 目标用户

公司内部产品团队——组织记忆和追溯检索能力，只有在团队规模变大、历史变长之后才真正显出价值。

## License

[AGPL-3.0](./LICENSE)。完全开源，非 open core。
