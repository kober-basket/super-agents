export interface QuickAutomation {
  title: string;
  description: string;
  prompt: string;
}

export const QUICK_AUTOMATIONS: QuickAutomation[] = [
  {
    title: "会议纪要",
    description: "把聊天、录音或资料整理成清晰纪要。",
    prompt: "请把今天的讨论整理成一份简洁的会议纪要，并列出待办和负责人。",
  },
  {
    title: "行程整理",
    description: "把出行计划、清单和提醒排顺。",
    prompt: "请帮我安排一个轻松但不慌乱的两天行程，顺便列出随身清单。",
  },
  {
    title: "轻松一下",
    description: "找点灵感、休闲推荐或轻量陪伴。",
    prompt: "请根据我今天有点累的状态，给我三个轻松放松的小建议。",
  },
];
