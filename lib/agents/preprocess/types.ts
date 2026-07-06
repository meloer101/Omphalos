/**
 * 预处理头（Agent架构设计.md 决策点 6："一个抽取内核 + 按来源可换的
 * 预处理头，输出统一 schema"）。头只影响"怎么读原始输入、抽取时该
 * 侧重什么"，不改变输出 schema——图的入口只有一个，可校验点只有一个。
 *
 * P1 先行两个头：反馈（feedback）、会议（meeting）。Slack/飞书头是
 * P4 的事——届时是新增一个头，不需要改这里的类型或抽取内核。
 */
export type PreprocessHeadName = "feedback" | "meeting";

export interface PreprocessHead {
  name: PreprocessHeadName;
  /** 向模型说明这批输入是什么来源、大致长什么样。 */
  describe: string;
  /** 这个来源的抽取该侧重什么——决定抽取质量的关键提示。 */
  extractionHint: string;
}
