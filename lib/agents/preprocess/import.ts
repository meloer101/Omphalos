/**
 * 冷启动导入的预处理头（Phase2-开工计划.md 2.3，决策 H）。
 *
 * 刻意**不**登记进 lib/agents/preprocess/index.ts 的 HEADS 表——那张表服务
 * paste 捕获合同，输出 schema 是证据一条路；导入合同有自己的、更宽的
 * 输出 schema（允许新建 feature 与 because 边），是另一份合同。这里只导出
 * 供导入合同 buildPrompt 复用的措辞常量，不碰已出口验收的 capture 通路。
 */

export const importHead = {
  describe:
    "这是一份团队的历史文档（旧 PRD / 需求评审 / 决策记录 / 会议纪要等），" +
    "冷启动导入用来把过去的产品记忆熔成图里的原生节点与因果边。",
  extractionHint:
    "与实时捕获不同：这里图往往是空的，你需要**新建**节点来承载历史。抽取要点：\n" +
    "- 把文档里的产品需求/决策抽成 feature 节点；把支撑它的用户证据、约束、" +
    "调研结论抽成 evidence 节点。\n" +
    "- 用 supports 边连「证据→需求」，用 because 边连「需求/决策→它的原因" +
    "（约束或证据）」——'当初为什么'这条链全靠 because 边，务必把文档里" +
    "写明的推迟/取舍原因挂上。\n" +
    "- 只抽文档明确写到的内容，不臆测、不补全；宁可漏挂一条边，不可编一条边。",
} as const;
