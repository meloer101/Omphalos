import type { PreprocessHead, PreprocessHeadName } from "./types";
import { feedbackHead } from "./feedback";
import { meetingHead } from "./meeting";

export type { PreprocessHead, PreprocessHeadName };

const HEADS: Record<PreprocessHeadName, PreprocessHead> = {
  feedback: feedbackHead,
  meeting: meetingHead,
};

export function getPreprocessHead(name: PreprocessHeadName): PreprocessHead {
  return HEADS[name];
}
