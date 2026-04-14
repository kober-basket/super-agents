import type { CurrentChatState } from "../../types";

export interface ChatHomeQuickPrompt {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

export const CHAT_HOME_QUICK_PROMPTS: ChatHomeQuickPrompt[] = [
  {
    id: "read-project",
    title: "读懂当前项目",
    description: "快速梳理代码结构、技术栈和关键模块。",
    prompt: "请先阅读当前工作区，并用中文总结项目结构、技术栈和关键模块。",
  },
  {
    id: "debug-issue",
    title: "定位一个问题",
    description: "帮我分析 bug、报错或异常行为的根因。",
    prompt: "请帮我定位当前项目里的问题，先找根因，再给出修复建议。",
  },
  {
    id: "plan-feature",
    title: "拆解一个需求",
    description: "把想法整理成可执行的实现方案。",
    prompt: "请把我的需求拆解成明确的功能模块、改动点和实现步骤。",
  },
  {
    id: "ship-task",
    title: "直接开始做",
    description: "给出目标后，继续实现并验证结果。",
    prompt: "我准备好了，请先理解任务，然后直接开始实现并验证。",
  },
];

export function shouldShowChatHome(currentChat: CurrentChatState) {
  return (
    currentChat.sessionId === null &&
    currentChat.messages.length === 0 &&
    !currentChat.busy &&
    !currentChat.blockedOnQuestion
  );
}
