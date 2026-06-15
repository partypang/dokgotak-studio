import { resolveOpenAiApiKey } from "../local-api-keys";

type TranscriptionSegment = {
  id?: number;
  start?: number;
  end?: number;
  text?: string;
};

type NormalizedSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
};

type SubtitleCue = {
  start: number;
  end: number;
  text: string;
  sourceText?: string;
};

function getOpenAiErrorMessage(status: number, data: unknown) {
  const fallback =
    status === 401 || status === 403
      ? "OpenAI API 키가 올바르지 않거나 권한이 없습니다."
      : `OpenAI 자막 생성 요청 중 오류가 발생했습니다. 상태 코드: ${status}`;

  if (typeof data !== "object" || data === null) {
    return fallback;
  }

  const error = (data as { error?: { message?: string } }).error;
  return error?.message ?? fallback;
}

async function readResponseData(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      error: {
        message: text.trim(),
      },
    };
  }
}

function extractOutputText(data: unknown): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "output_text" in data &&
    typeof data.output_text === "string"
  ) {
    return data.output_text;
  }

  const found: string[] = [];

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value !== "object" || value === null) {
      return;
    }

    const item = value as Record<string, unknown>;
    if (item.type === "output_text" && typeof item.text === "string") {
      found.push(item.text);
    }

    Object.values(item).forEach(walk);
  };

  walk(data);
  return found.join("\n\n").trim();
}

function normalizeSegments(
  rawSegments: unknown,
  fallbackText = "",
): NormalizedSegment[] {
  const segments = Array.isArray(rawSegments) ? rawSegments : [];
  const normalized = segments
    .map((segment, index) => {
      const item =
        typeof segment === "object" && segment !== null
          ? (segment as TranscriptionSegment)
          : {};
      const start = Number(item.start);
      const end = Number(item.end);
      const text = item.text?.trim() ?? "";

      if (!text) {
        return null;
      }

      return {
        id: typeof item.id === "number" ? item.id : index,
        start: Number.isFinite(start) ? Math.max(0, start) : index * 4,
        end: Number.isFinite(end) ? Math.max(0, end) : index * 4 + 3.5,
        text,
      };
    })
    .filter((segment): segment is NormalizedSegment => Boolean(segment));

  if (normalized.length > 0) {
    return normalized;
  }

  const cleaned = fallbackText.trim();
  if (!cleaned) {
    return [];
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return sentences.map((text, index) => ({
    id: index,
    start: index * 4,
    end: index * 4 + 3.5,
    text,
  }));
}

function parseTranslatedCues(
  outputText: string,
  segments: NormalizedSegment[],
): SubtitleCue[] {
  const fenced = outputText.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? outputText;
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  const jsonText = start === -1 || end === -1 ? fenced : fenced.slice(start, end + 1);

  try {
    const parsed = JSON.parse(jsonText) as Array<{
      id?: unknown;
      text?: unknown;
    }>;
    const cues: SubtitleCue[] = [];

    segments.forEach((segment, index) => {
      const translated =
        parsed.find((item) => item.id === segment.id) ?? parsed[index];
      const text =
        typeof translated?.text === "string"
          ? translated.text.trim()
          : segment.text.trim();

      if (!text) {
        return;
      }

      cues.push({
        start: segment.start,
        end: Math.max(segment.start + 0.5, segment.end),
        text,
        sourceText: segment.text,
      });
    });

    return cues;
  } catch {
    return segments.map((segment) => ({
      start: segment.start,
      end: Math.max(segment.start + 0.5, segment.end),
      text: segment.text,
      sourceText: segment.text,
    }));
  }
}

function buildTranslationPrompt(segments: NormalizedSegment[]) {
  return `Translate the following English video subtitle segments into natural Korean subtitles.

Rules:
- Return JSON only.
- Preserve the id values exactly.
- Translate meaning, not word-for-word.
- Keep each subtitle short enough for mobile video, ideally under 28 Korean characters when possible.
- Do not add explanations, markdown, speaker labels, or timestamps.
- If a segment is not English, still produce natural Korean.

Input JSON:
${JSON.stringify(
  segments.map((segment) => ({
    id: segment.id,
    text: segment.text,
  })),
)}

Output shape:
[
  { "id": 0, "text": "한국어 자막" }
]`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const openaiApiKey = await resolveOpenAiApiKey(
      typeof formData.get("openaiApiKey") === "string"
        ? (formData.get("openaiApiKey") as string)
        : "",
    );
    const file = formData.get("file");

    if (!openaiApiKey) {
      return Response.json(
        { ok: false, message: "OpenAI API 키를 먼저 저장해주세요." },
        { status: 400 },
      );
    }

    if (!(file instanceof Blob)) {
      return Response.json(
        { ok: false, message: "자막을 만들 영상 파일이 필요합니다." },
        { status: 400 },
      );
    }

    const transcriptionForm = new FormData();
    const fileName = file instanceof File ? file.name : "subtitle-audio.wav";
    transcriptionForm.append("file", file, fileName || "subtitle-audio.wav");
    transcriptionForm.append("model", "whisper-1");
    transcriptionForm.append("language", "en");
    transcriptionForm.append("response_format", "verbose_json");
    transcriptionForm.append("timestamp_granularities[]", "segment");

    const transcriptionResponse = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: transcriptionForm,
      },
    );
    const transcriptionData = await readResponseData(transcriptionResponse);

    if (!transcriptionResponse.ok) {
      return Response.json(
        {
          ok: false,
          message: getOpenAiErrorMessage(
            transcriptionResponse.status,
            transcriptionData,
          ),
        },
        { status: 400 },
      );
    }

    const segments = normalizeSegments(
      (transcriptionData as { segments?: unknown }).segments,
      (transcriptionData as { text?: string }).text ?? "",
    ).slice(0, 80);

    if (segments.length === 0) {
      return Response.json(
        { ok: false, message: "영상에서 영어 음성을 찾지 못했습니다." },
        { status: 400 },
      );
    }

    const translationResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        store: false,
        max_output_tokens: 2500,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildTranslationPrompt(segments),
              },
            ],
          },
        ],
      }),
    });
    const translationData = await readResponseData(translationResponse);

    if (!translationResponse.ok) {
      return Response.json(
        {
          ok: false,
          message: getOpenAiErrorMessage(translationResponse.status, translationData),
        },
        { status: 400 },
      );
    }

    const outputText = extractOutputText(translationData);
    const cues = parseTranslatedCues(outputText, segments);

    return Response.json({
      ok: true,
      cues,
      sourceText: (transcriptionData as { text?: string }).text ?? "",
      message: `${cues.length}개 한국어 자막을 만들었습니다.`,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "한국어 자막 생성 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
