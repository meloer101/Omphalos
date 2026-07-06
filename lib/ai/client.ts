import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * 模型接入层（Agent架构设计.md 5.3）：AI SDK 只认 OpenAI 兼容协议，
 * 换模型/换供应商永远是改 litellm/config.yaml 一行配置，不碰这个
 * 文件或任何调用方代码。
 *
 * 故意做成惰性构造（函数而非顶层 const）：Next.js 运行时会自动加载
 * .env.local，顶层构造本来没问题；但独立脚本（如 spike-stress-test.ts）
 * 里 `import` 会被提升到所有代码之前执行——如果 client.ts 在模块顶层
 * 读 process.env，会跑在脚本自己的 dotenv config() 之前，读到空值。
 * 惰性构造把读取时机推迟到真正调用时，两种场景都安全。
 */
function getLitellmProvider() {
  return createOpenAICompatible({
    name: "litellm",
    baseURL: process.env.LITELLM_BASE_URL ?? "http://127.0.0.1:4000",
    apiKey: process.env.LITELLM_API_KEY,
    // 不开这个，provider 只发裸 json_object 模式（不带 schema），
    // DeepSeek 会自己瞎编一个 JSON 形状，不认我们传的 zod schema——
    // 0.4 spike 压测踩过这个坑，见 Phase0-开工计划.md。注意：已装的
    // @ai-sdk/openai-compatible@3.0.5 里 `.languageModel(id, config)`
    // 的第二个参数其实被忽略（.d.ts 比实际实现新），这个开关只能在
    // createOpenAICompatible() 顶层设，对这个 provider 建出来的所有
    // 模型全局生效。
    supportsStructuredOutputs: true,
  });
}

export function getDefaultModel() {
  return getLitellmProvider()("default");
}

/**
 * 检索生成用的"快模型"（Phase2-开工计划.md 决策 F）。捕获用的思考模型
 * 延迟 ~11s，交互式 Cmd-K 追溯不能等；架构 5.2"按角色配模型"允许分离。
 * 换供应商只改 litellm/config.yaml 的 `fast` 别名。
 */
export function getFastModel() {
  return getLitellmProvider()("fast");
}

/**
 * 语义索引用的 embedding 模型（Phase2-开工计划.md 决策 E）。走 OpenAI
 * 兼容 1536 维，正好匹配 db/schema.ts 的 `nodes.embedding vector(1536)`，
 * 零 schema 改动。换供应商/换本地模型只改 litellm/config.yaml 的
 * `embedding` 别名——注意换维度需同步改 schema 与向量索引迁移。
 */
export function getEmbeddingModel() {
  return getLitellmProvider().textEmbeddingModel("embedding");
}
