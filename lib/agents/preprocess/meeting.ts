import type { PreprocessHead } from "./types";

export const meetingHead: PreprocessHead = {
  name: "meeting",
  describe:
    "这是一段会议记录或访谈纪要——通常夹杂闲聊、议程报告、讨论过程等噪音。",
  extractionHint:
    "只抽取会议中产生的决策、达成的结论、明确提到的用户/业务约束作为证据条目；" +
    "跳过闲聊和过程性讨论。标题要体现\"谁在什么场景下说了/决定了什么\"，" +
    "而不是笼统复述整段讨论。",
};
