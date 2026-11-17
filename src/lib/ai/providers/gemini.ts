import { AiProviderError, type AiProvider, type GenerateJsonArgs } from "../types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Google Gemini via the REST generateContent API with JSON-schema structured output. */
export class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey: string,
    readonly model: string = "gemini-2.5-flash",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateJson({ system, prompt, schema, timeoutMs, temperature = 0.1 }: GenerateJsonArgs) {
    let res: Response;
    try {
      res = await this.fetchImpl(`${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature, responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
      throw new AiProviderError(timeout ? `Gemini timed out after ${timeoutMs}ms` : `Gemini request failed: ${(e as Error).message}`, true);
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new AiProviderError(`Gemini responded with HTTP ${res.status}`, retryable, res.status);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    if (json.promptFeedback?.blockReason) throw new AiProviderError(`Prompt blocked: ${json.promptFeedback.blockReason}`, false);
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new AiProviderError(`Empty response (finishReason=${json.candidates?.[0]?.finishReason ?? "unknown"})`, true);
    return { text, usage: { inputTokens: json.usageMetadata?.promptTokenCount, outputTokens: json.usageMetadata?.candidatesTokenCount } };
  }
}
