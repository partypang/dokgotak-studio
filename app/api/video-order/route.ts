import { resolveOpenAiApiKey } from "../local-api-keys";

type VideoOrderFrame = {
  label?: string;
  position?: number;
  mimeType?: string;
  base64?: string;
};

type VideoOrderClip = {
  id?: string;
  fileName?: string;
  duration?: number;
  width?: number;
  height?: number;
  subtitles?: Array<{
    start?: number;
    end?: number;
    text?: string;
    sourceText?: string;
  }>;
  frames?: VideoOrderFrame[];
};

type VideoOrderPayload = {
  openaiApiKey?: string;
  clips?: VideoOrderClip[];
};

type SuggestedVideoOrderItem = {
  clipId: string;
  order: number;
  role: string;
  reason: string;
  confidence: number;
};

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

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

function getOpenAiErrorMessage(status: number, data: unknown) {
  const fallback =
    status === 401 || status === 403
      ? "OpenAI API 키가 올바르지 않거나 권한이 없습니다."
      : `OpenAI 영상 순서 추천 요청 중 오류가 발생했습니다. 상태 코드: ${status}`;

  if (typeof data !== "object" || data === null) {
    return fallback;
  }

  const error = (data as { error?: { message?: string } }).error;
  return error?.message ?? fallback;
}

function clampConfidence(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return 60;
  }

  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function parseOrderOutput(outputText: string, clips: Required<VideoOrderClip>[]) {
  const fenced = outputText.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? outputText;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  const jsonText = start === -1 || end === -1 ? fenced : fenced.slice(start, end + 1);
  const clipIds = new Set(clips.map((clip) => clip.id));

  try {
    const parsed = JSON.parse(jsonText) as {
      summary?: unknown;
      confidence?: unknown;
      spellingNote?: unknown;
      items?: unknown;
    };
    const sourceItems = Array.isArray(parsed.items) ? parsed.items : [];
    const usedIds = new Set<string>();
    const items: SuggestedVideoOrderItem[] = [];

    sourceItems.forEach((rawItem, fallbackIndex) => {
      const item =
        typeof rawItem === "object" && rawItem !== null
          ? (rawItem as Record<string, unknown>)
          : {};
      const clipId =
        typeof item.clipId === "string" && clipIds.has(item.clipId)
          ? item.clipId
          : "";

      if (!clipId || usedIds.has(clipId)) {
        return;
      }

      usedIds.add(clipId);
      items.push({
        clipId,
        order:
          typeof item.order === "number" && Number.isFinite(item.order)
            ? Math.max(1, Math.round(item.order))
            : fallbackIndex + 1,
        role:
          typeof item.role === "string" && item.role.trim()
            ? item.role.trim()
            : "흐름 구성",
        reason:
          typeof item.reason === "string" && item.reason.trim()
            ? item.reason.trim()
            : "장면 흐름상 이 위치가 자연스럽습니다.",
        confidence: clampConfidence(item.confidence),
      });
    });

    clips.forEach((clip) => {
      if (usedIds.has(clip.id)) {
        return;
      }

      items.push({
        clipId: clip.id,
        order: items.length + 1,
        role: "보강 장면",
        reason: "AI가 명확한 위치를 찾지 못해 기존 순서를 유지했습니다.",
        confidence: 45,
      });
    });

    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "영상 흐름을 기준으로 추천 순서를 만들었습니다.",
      confidence:
        parsed.confidence === "high" ||
        parsed.confidence === "medium" ||
        parsed.confidence === "low"
          ? parsed.confidence
          : "medium",
      spellingNote:
        typeof parsed.spellingNote === "string" && parsed.spellingNote.trim()
          ? parsed.spellingNote.trim()
          : "추천 이유 문장의 맞춤법과 띄어쓰기를 점검했습니다.",
      items: items.sort((left, right) => left.order - right.order),
    };
  } catch {
    return {
      summary: "AI 추천 결과를 구조화하지 못해 기존 순서를 유지했습니다.",
      confidence: "low" as const,
      spellingNote: "맞춤법 검수 결과를 읽지 못했습니다.",
      items: clips.map((clip, index) => ({
        clipId: clip.id,
        order: index + 1,
        role: "기존 순서",
        reason: "추천 결과를 읽지 못해 기존 순서를 유지했습니다.",
        confidence: 35,
      })),
    };
  }
}

function normalizeClips(rawClips: VideoOrderClip[] = []) {
  return rawClips
    .map((clip, index) => ({
      id: clip.id?.trim() || `clip-${index + 1}`,
      fileName: clip.fileName?.trim() || `영상 ${index + 1}`,
      duration: Number.isFinite(clip.duration) ? Number(clip.duration) : 0,
      width: Number.isFinite(clip.width) ? Number(clip.width) : 0,
      height: Number.isFinite(clip.height) ? Number(clip.height) : 0,
      subtitles: (clip.subtitles ?? [])
        .filter((subtitle) => subtitle.text || subtitle.sourceText)
        .slice(0, 12),
      frames: (clip.frames ?? [])
        .filter(
          (frame) =>
            frame.base64 &&
            frame.mimeType &&
            allowedImageTypes.has(frame.mimeType),
        )
        .slice(0, 3),
    }))
    .filter((clip) => clip.frames.length > 0)
    .slice(0, 12);
}

function buildPrompt(clips: ReturnType<typeof normalizeClips>) {
  const metadata = clips
    .map((clip, index) => {
      const subtitleLines = clip.subtitles
        .map((subtitle) => {
          const time =
            Number.isFinite(subtitle.start) && Number.isFinite(subtitle.end)
              ? `${subtitle.start}-${subtitle.end}초`
              : "시간 미상";
          const text = subtitle.text?.trim() || subtitle.sourceText?.trim() || "";

          return `  - ${time}: ${text}`;
        })
        .join("\n");

      return [
        `${index + 1}. clipId=${clip.id}`,
        `파일명: ${clip.fileName}`,
        `길이: ${Math.round(clip.duration)}초`,
        `크기: ${clip.width}x${clip.height}`,
        subtitleLines ? `자막/대사 단서:\n${subtitleLines}` : "자막/대사 단서: 없음",
      ].join("\n");
    })
    .join("\n\n");

  return `당신은 쇼츠/광고 영상을 편집하는 한국어 스토리 편집자입니다.
사용자가 올린 여러 영상 클립이 뒤섞여 있습니다.
각 클립의 대표 프레임, 파일명, 길이, 자막 단서를 보고 가장 자연스러운 순서를 추천하세요.

판단 기준:
- 도입/후킹, 문제 제기, 상황 전개, 해결/증거, 행동 유도, 엔딩 흐름을 우선합니다.
- 같은 장소나 행동이 이어지는 경우 시선 방향, 동작 진행, 전후 맥락을 추론합니다.
- 상품/사람/배경이 반복되면 이야기 흐름이 자연스럽게 바뀌도록 배열합니다.
- 확실하지 않은 경우 낮은 confidence를 주고 이유에 불확실성을 짧게 적습니다.
- 원본 clipId는 절대 바꾸지 마세요.
- 모든 클립을 정확히 한 번씩 포함하세요.

맞춤법 필수 규칙:
- 모든 한국어 문장은 맞춤법, 띄어쓰기, 표준어를 반드시 점검하세요.
- "마춤법" 같은 오기는 "맞춤법"으로 바로잡는 수준까지 철저히 교정하세요.
- 이유 문장은 자연스럽고 짧은 한국어 한 문장으로 작성하세요.
- 은어, 깨진 문자, 영어 섞어 쓰기를 피하세요.

클립 정보:
${metadata}

반드시 JSON만 출력하세요.
{
  "summary": "추천 순서 전체 요약 한 문장",
  "confidence": "high | medium | low",
  "spellingNote": "맞춤법 검수 결과 한 문장",
  "items": [
    {
      "clipId": "원본 clipId",
      "order": 1,
      "role": "도입 | 문제 제기 | 전개 | 해결 | 증거 | CTA | 엔딩 | 보강",
      "reason": "맞춤법이 정확한 추천 이유 한 문장",
      "confidence": 0
    }
  ]
}`;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as VideoOrderPayload;
    const openaiApiKey = await resolveOpenAiApiKey(payload.openaiApiKey);
    const clips = normalizeClips(payload.clips);

    if (!openaiApiKey) {
      return Response.json(
        { ok: false, message: "OpenAI API 키를 먼저 저장해주세요." },
        { status: 400 },
      );
    }

    if (clips.length < 2) {
      return Response.json(
        { ok: false, message: "순서를 추천하려면 영상이 2개 이상 필요합니다." },
        { status: 400 },
      );
    }

    const content: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string; detail: "auto" }
    > = [
      {
        type: "input_text",
        text: buildPrompt(clips),
      },
    ];

    clips.forEach((clip) => {
      clip.frames.forEach((frame, frameIndex) => {
        const frameLabel = frame.label?.trim() || `프레임 ${frameIndex + 1}`;
        const position =
          Number.isFinite(frame.position) && typeof frame.position === "number"
            ? `${Math.round(frame.position * 100)}% 지점`
            : "위치 미상";

        content.push({
          type: "input_text",
          text: `clipId=${clip.id} / ${clip.fileName} / ${frameLabel} / ${position}`,
        });
        content.push({
          type: "input_image",
          image_url: `data:${frame.mimeType};base64,${frame.base64}`,
          detail: "auto",
        });
      });
    });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        store: false,
        max_output_tokens: 2400,
        input: [
          {
            role: "user",
            content,
          },
        ],
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      return Response.json(
        {
          ok: false,
          message: getOpenAiErrorMessage(response.status, data),
        },
        { status: 400 },
      );
    }

    const outputText = extractOutputText(data);
    if (!outputText) {
      return Response.json(
        { ok: false, message: "영상 순서 추천 결과를 읽지 못했습니다." },
        { status: 500 },
      );
    }

    return Response.json({
      ok: true,
      ...parseOrderOutput(outputText, clips),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "영상 순서 추천 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
