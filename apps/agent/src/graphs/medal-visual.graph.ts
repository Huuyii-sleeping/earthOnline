import { medalVisualPromptV1 } from "../prompts/medal-visual.v1.js";
import { getLLMProvider } from "../providers/index.js";
import type { ChatMessage } from "../providers/types.js";

/**
 * Visual instructions produced by the medal-visual graph.
 */
export interface MedalVisualInstructions {
  visualPrompt: string;
  styleTags: string[];
  negativePrompt: string;
}

export function getMedalVisualGraphMetadata() {
  return {
    promptName: medalVisualPromptV1.name,
    promptVersion: medalVisualPromptV1.version,
  };
}

function parseVisualResponse(raw: string): MedalVisualInstructions {
  let content = raw.trim();

  // Strip markdown code fences if present.
  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  // Find JSON object boundaries.
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error("Agent did not return parseable JSON for visual instructions");
  }

  const jsonStr = content.slice(jsonStart, jsonEnd + 1);
  const parsed = JSON.parse(jsonStr) as Partial<MedalVisualInstructions>;

  if (typeof parsed.visualPrompt !== "string" || !parsed.visualPrompt.trim()) {
    throw new Error("Agent response missing visualPrompt");
  }

  const styleTags = Array.isArray(parsed.styleTags)
    ? parsed.styleTags
        .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
        .filter(Boolean)
        .map((tag) => tag.toLowerCase())
    : [];

  const negativePrompt =
    typeof parsed.negativePrompt === "string" && parsed.negativePrompt.trim()
      ? parsed.negativePrompt.trim()
      : "text, watermark, logo, realistic face, busy background, oversaturated";

  return {
    visualPrompt: parsed.visualPrompt.trim(),
    styleTags: styleTags.length > 0 ? styleTags : ["cinematic", "soft light", "low saturation"],
    negativePrompt,
  };
}

/**
 * Generate visual instructions for a medal.
 *
 * The medal's textual content (title, short reason, meaning focus and story) is
 * fed to the LLM which returns a structured visual prompt that can be handed off
 * to an image generation model.
 */
export async function generateVisualInstructions(
  medalTitle: string,
  shortReason: string,
  meaningFocus: string,
  story: string,
): Promise<MedalVisualInstructions> {
  const systemPrompt = medalVisualPromptV1.template;

  const userContent = [
    `奖章名称：${medalTitle}`,
    `授奖理由：${shortReason}`,
    `意义重心：${meaningFocus}`,
    `叙事草稿：${story}`,
    "",
    "请基于以上奖章内容，生成可用于图像生成的视觉指令。",
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const provider = getLLMProvider();
  const response = await provider.chat(messages);

  return parseVisualResponse(response.content);
}
