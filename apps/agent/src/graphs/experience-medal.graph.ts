import { medalGenerationPromptV1 } from "../prompts/medal-generation.v1.js";

export function getExperienceMedalGraphMetadata() {
  return {
    promptName: medalGenerationPromptV1.name,
    promptVersion: medalGenerationPromptV1.version,
  };
}
