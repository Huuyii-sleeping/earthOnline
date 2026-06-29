// Safety review — detect sensitive content and trigger safe response.

const SELF_HARM_KEYWORDS = [
  "不想活", "想死", "自杀", "自残", "了结", "结束生命",
  "kill myself", "suicide", "self-harm", "end my life",
];

const VIOLENCE_KEYWORDS = [
  "杀人", "伤害他人", "报复社会", "bomb", "attack others",
];

export interface SafetyResult {
  safe: boolean;
  reason?: string;
  safeResponse?: string;
}

export function checkSafety(content: string): SafetyResult {
  const lower = content.toLowerCase();

  for (const keyword of SELF_HARM_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      return {
        safe: false,
        reason: "self_harm_detected",
        safeResponse:
          "我听到你说的这些，我很关心你现在的状态。你此刻的感受很重要，我建议你联系专业支持：\n\n- 全国心理援助热线：400-161-9995\n- 北京心理危机研究与干预中心：010-82951332\n\n你不是一个人，有人愿意倾听和帮助你。",
      };
    }
  }

  for (const keyword of VIOLENCE_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      return {
        safe: false,
        reason: "violence_detected",
        safeResponse:
          "我理解你可能正在经历很大的压力和愤怒。伤害他人不是解决问题的方法，也不会让你感觉更好。如果你愿意，可以告诉我发生了什么，我们一起看看有没有其他方式来应对。",
      };
    }
  }

  return { safe: true };
}
