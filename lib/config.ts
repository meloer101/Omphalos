/**
 * Phase 0 无认证/多项目切换（见 Roadmap.md Phase 0 明确不做）。
 * 所有页面和 Server Action 暂时共用这一个固定 project scope，
 * 直到 P1+ 引入真正的项目切换。
 */
export const DEFAULT_PROJECT_ID = "00000000-0000-0000-0000-000000000001";

/**
 * AI 侧边栏开关状态的 cookie 名（Phase1-开工计划.md 1.4）。一处在
 * layout.tsx（Server Component 读，决定首屏渲染），另一处在
 * workbench-chrome.tsx（Client Component 切换时用 document.cookie 写），
 * 两处共用同一个常量防止拼错导致读写不一致。
 */
export const SIDEBAR_OPEN_COOKIE = "sidebar-open";
