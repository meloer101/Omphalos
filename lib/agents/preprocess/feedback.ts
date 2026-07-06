import type { PreprocessHead } from "./types";

export const feedbackHead: PreprocessHead = {
  name: "feedback",
  describe:
    "这是一批用户反馈——可能混合来自应用商店评论、客服工单、销售访谈、" +
    "社群留言、问卷自由填空等不同渠道的原始文本。",
  extractionHint:
    "把每条独立的用户诉求/痛点抽成一条证据；同一个人反复表达的同一件事只算" +
    "一条，不同人表达的相似诉求各自成条——不要在这一步就判定为重复，" +
    "跨批去重由系统另外处理，你只管把每个人说的话如实抽出来。",
};
