import { resolveOpenAiApiKey } from "../local-api-keys";

type SceneImageReviewPayload = {
  openaiApiKey?: string;
  analysis?: string;
  productionPlan?: string;
  videoFormat?: string;
  duration?: string;
  images?: Array<{
    name?: string;
    mimeType?: string;
    base64?: string;
    copy?: {
      main?: string;
      sub?: string;
    };
    textPosition?: "bottom" | "top" | "left" | "right";
    sceneIndex?: number;
  }>;
};

type SceneImageReview = {
  sceneIndex: number;
  score: number;
  status: "pass" | "warning" | "fail";
  shouldRegenerate: boolean;
  issue: string;
  fix: string;
  strength: string;
};

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
      ? "OpenAI API 키를 확인해주세요."
      : `OpenAI 이미지 검수 요청 중 오류가 발생했습니다. 상태 코드: ${status}`;

  if (typeof data !== "object" || data === null) {
    return fallback;
  }

  const error = (data as { error?: { message?: string } }).error;
  return error?.message ?? fallback;
}

function clampScore(score: unknown) {
  const parsed = typeof score === "number" ? score : Number(score);

  if (!Number.isFinite(parsed)) {
    return 70;
  }

  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function normalizeStatus(
  status: unknown,
  score: number,
): SceneImageReview["status"] {
  if (status === "pass" || status === "warning" || status === "fail") {
    return status;
  }

  if (score >= 82) {
    return "pass";
  }

  return score >= 62 ? "warning" : "fail";
}

function parseReviewOutput(
  text: string,
  images: NonNullable<SceneImageReviewPayload["images"]>,
) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  const jsonText = start === -1 || end === -1 ? fenced : fenced.slice(start, end + 1);

  try {
    const parsed = JSON.parse(jsonText) as {
      summary?: unknown;
      reviews?: unknown;
    };
    const sourceReviews = Array.isArray(parsed.reviews) ? parsed.reviews : [];
    const reviews = sourceReviews.map((rawReview, fallbackIndex) => {
      const review =
        typeof rawReview === "object" && rawReview !== null
          ? (rawReview as Record<string, unknown>)
          : {};
      const fallbackSceneIndex =
        images[fallbackIndex]?.sceneIndex ?? fallbackIndex;
      const rawSceneIndex = review.sceneIndex;
      const sceneIndex =
        typeof rawSceneIndex === "number" && Number.isInteger(rawSceneIndex)
          ? rawSceneIndex
          : fallbackSceneIndex;
      const score = clampScore(review.score);
      const status = normalizeStatus(review.status, score);

      return {
        sceneIndex,
        score,
        status,
        shouldRegenerate:
          typeof review.shouldRegenerate === "boolean"
            ? review.shouldRegenerate
            : status === "fail",
        issue:
          typeof review.issue === "string" && review.issue.trim()
            ? review.issue.trim()
            : "대본과 이미지의 연결을 더 명확하게 점검해야 합니다.",
        fix:
          typeof review.fix === "string" && review.fix.trim()
            ? review.fix.trim()
            : "장면의 주인공, 행동, 배경을 대본 문장에 맞춰 더 구체화합니다.",
        strength:
          typeof review.strength === "string" && review.strength.trim()
            ? review.strength.trim()
            : "기본 장면 구성은 사용할 수 있습니다.",
      } satisfies SceneImageReview;
    });

    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "이미지 검수가 완료됐습니다.",
      reviews,
    };
  } catch {
    return {
      summary: "검수 결과를 구조화하지 못했습니다. 문제 컷은 수동으로 확인해주세요.",
      reviews: images.map((image, index) => ({
        sceneIndex: image.sceneIndex ?? index,
        score: 70,
        status: "warning" as const,
        shouldRegenerate: false,
        issue: "자동 검수 결과를 읽지 못했습니다.",
        fix: "미리보기에서 대본과 장면이 맞는지 확인한 뒤 필요하면 이 컷만 다시 생성해주세요.",
        strength: "이미지는 생성되어 미리보기 확인이 가능합니다.",
      })),
    };
  }
}

function buildPrompt(payload: Required<Omit<SceneImageReviewPayload, "openaiApiKey">>) {
  const sceneList = payload.images
    .map((image, index) => {
      const rawSceneIndex = image.sceneIndex ?? index;
      const sceneLabel =
        rawSceneIndex < 0 ? "Intro hook scene" : `Scene ${rawSceneIndex + 1}`;
      return [
        sceneLabel,
        `sceneIndex: ${rawSceneIndex}`,
        `name: ${image.name ?? sceneLabel}`,
        `main copy: ${image.copy?.main ?? ""}`,
        `sub copy: ${image.copy?.sub ?? ""}`,
        `caption position: ${image.textPosition ?? "bottom"}`,
      ].join(" / ");
    })
    .join("\n");

  return `당신은 독고탁 스튜디오의 쇼츠 이미지 검수관입니다.
아래 제작 지시서와 장면 이미지를 비교해서, 실제 쇼츠에 사용할 수 있는지 컷별로 판단하세요.

검수 기준:
- 대본과 제작 지시서의 핵심 의미가 이미지에 보이는가
- 장면별 주인공, 행동, 배경, 감정이 서로 다르게 설계됐는가
- 한 장면이 콜라쥬, 분할 화면, 여러 사진을 붙인 형태가 아닌가
- 이미지 안에 한글/영어 문구, 로고, 버튼, 가격표, 상세페이지 캡처가 들어가지 않았는가
- 제품 또는 주인공이 작거나 흐려서 메시지가 약하지 않은가
- 앱이 나중에 자막을 합성할 여백이 caption position에 충분한가
- 대본에 없는 효능, 인증, 브랜드, 과장 장면을 만들지 않았는가
- 폰트 오타 문제는 이미지 안 텍스트가 있을 때만 문제로 잡고, 앱 자막은 별도로 판단하지 마세요

영상 설정:
- 길이: ${payload.duration}
- 비율: ${payload.videoFormat}

장면 목록:
${sceneList}

제작 지시서:
${payload.productionPlan}

제품/대본 분석:
${payload.analysis}

반드시 JSON만 출력하세요.
{
  "summary": "전체 검수 요약",
  "reviews": [
    {
      "sceneIndex": 0,
      "score": 0,
      "status": "pass | warning | fail",
      "shouldRegenerate": true,
      "issue": "문제점 한 문장",
      "fix": "재생성 지시로 바로 쓸 수 있는 수정 방향 한 문장",
      "strength": "괜찮은 점 한 문장"
    }
  ]
}`;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as SceneImageReviewPayload;
    const openaiApiKey = await resolveOpenAiApiKey(payload.openaiApiKey);
    const analysis = payload.analysis?.trim() || "분석 정보 없음";
    const productionPlan = payload.productionPlan?.trim();
    const videoFormat =
      payload.videoFormat === "horizontal" ? "가로형 16:9" : "세로형 9:16";
    const duration = payload.duration?.trim() || "15초";
    const images = (payload.images ?? [])
      .filter((image) => image.base64 && image.mimeType)
      .slice(0, 13);

    if (!openaiApiKey) {
      return Response.json(
        { ok: false, message: "OpenAI API 키를 먼저 저장해주세요." },
        { status: 400 },
      );
    }

    if (!productionPlan) {
      return Response.json(
        { ok: false, message: "영상 제작 지시서가 필요합니다." },
        { status: 400 },
      );
    }

    if (images.length === 0) {
      return Response.json(
        { ok: false, message: "검수할 장면 이미지가 없습니다." },
        { status: 400 },
      );
    }

    const content = [
      {
        type: "input_text",
        text: buildPrompt({
          analysis,
          productionPlan,
          videoFormat,
          duration,
          images,
        }),
      },
      ...images.map((image) => ({
        type: "input_image",
        image_url: `data:${image.mimeType};base64,${image.base64}`,
      })),
    ];

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        store: false,
        max_output_tokens: 2200,
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
        { ok: false, message: "이미지 검수 결과를 읽지 못했습니다." },
        { status: 500 },
      );
    }

    const reviewResult = parseReviewOutput(outputText, images);

    return Response.json({
      ok: true,
      summary: reviewResult.summary,
      reviews: reviewResult.reviews,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "이미지 검수 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
