import {
  getUploadedFiles,
  storedFileToBytes,
  type UploadedFileMeta,
} from "../upload-store";
import { resolveOpenAiApiKey } from "../local-api-keys";

type SceneImagePayload = {
  openaiApiKey?: string;
  sessionId?: string;
  files?: UploadedFileMeta[];
  analysis?: string;
  productionPlan?: string;
  videoFormat?: string;
  duration?: string;
  includeIntroImage?: boolean;
  targetSceneIndex?: number;
  regenerationNote?: string;
  targetTextPosition?: TextPosition;
};

const imageFormats = {
  vertical: {
    label: "세로 9:16",
    size: "1024x1536",
    layout:
      "Compose for a vertical 9:16 shorts frame. Build a premium card-news advertising still with a clear subject, cinematic depth, and a calm typography zone for later Korean captions.",
  },
  horizontal: {
    label: "가로 16:9",
    size: "1536x1024",
    layout:
      "Compose for a horizontal 16:9 video frame. Build a premium card-news advertising still with a clear subject, cinematic depth, and a calm typography zone for later Korean captions.",
  },
} as const;

type ImageFormatId = keyof typeof imageFormats;
type TextPosition = "bottom" | "top" | "left" | "right";

function isTextPosition(value: unknown): value is TextPosition {
  return value === "bottom" || value === "top" || value === "left" || value === "right";
}

const sceneTemplates = [
  {
    name: "hook",
    label: "1컷 후킹",
    role:
      "고객이 멈춰 보게 만드는 첫 장면. 제품과 가장 강한 욕망 또는 고민을 한눈에 보여준다.",
    fallbackMain: "눈길이 멈추는 순간",
    fallbackSub: "필요한 이유를 한 장면으로 보여줍니다.",
  },
  {
    name: "problem",
    label: "2컷 문제 공감",
    role:
      "고객이 평소 불편해하던 상황을 세련된 생활 장면으로 보여준다.",
    fallbackMain: "불편함은 짧게",
    fallbackSub: "공감은 선명하게 전달합니다.",
  },
  {
    name: "solution",
    label: "3컷 해결",
    role:
      "제품이 어떤 방식으로 도움을 주는지 사용 장면 중심으로 보여준다.",
    fallbackMain: "해결은 더 간단하게",
    fallbackSub: "제품이 필요한 순간을 보여줍니다.",
  },
  {
    name: "benefit",
    label: "4컷 혜택",
    role:
      "고객이 얻는 이익과 사용 후 기대감을 밝고 고급스럽게 보여준다.",
    fallbackMain: "생활이 더 편해지는 선택",
    fallbackSub: "작은 변화가 만족을 만듭니다.",
  },
  {
    name: "proof",
    label: "5컷 신뢰",
    role:
      "제품 이미지나 PDF에서 확인 가능한 구성, 특징, 편의성을 디테일 컷으로 보여준다.",
    fallbackMain: "보이는 구성 그대로",
    fallbackSub: "확인 가능한 장점만 담았습니다.",
  },
  {
    name: "action",
    label: "6컷 확인 유도",
    role:
      "고객이 구매 또는 상세 확인으로 자연스럽게 넘어가게 만드는 엔딩 장면.",
    fallbackMain: "지금 확인해보세요",
    fallbackSub: "내 상황에 맞는지 살펴보세요.",
  },
] as const;

const extraSceneTemplates = [
  {
    name: "routine",
    label: "루틴 확장컷",
    role:
      "제품이 실제 생활 루틴 안에서 자연스럽게 돋보이는 장면. 제품은 화면의 주인공으로 선명하게 보인다.",
    fallbackMain: "매일 쓰기 쉬운 선택",
    fallbackSub: "루틴 속에서 제품이 돋보입니다.",
  },
  {
    name: "detail",
    label: "디테일 확장컷",
    role:
      "제품 패키지, 구성품, 질감, 사용 요소를 고급 클로즈업으로 보여주는 장면.",
    fallbackMain: "디테일까지 깔끔하게",
    fallbackSub: "눈에 보이는 특징을 강조합니다.",
  },
  {
    name: "usage",
    label: "사용 확장컷",
    role:
      "고객이 제품을 실제로 준비하거나 사용하는 순간을 영화적인 광고 스틸로 보여주는 장면.",
    fallbackMain: "쓰는 순간이 간편하게",
    fallbackSub: "제품 중심의 사용 장면입니다.",
  },
  {
    name: "premium",
    label: "프리미엄 확장컷",
    role:
      "브랜드감 있는 조명과 소재감으로 제품 가치를 한 단계 높여 보이는 프리미엄 장면.",
    fallbackMain: "제품 가치가 보이게",
    fallbackSub: "고급스러운 무드로 정리합니다.",
  },
] as const;

const sceneTemplatePool = [...sceneTemplates, ...extraSceneTemplates] as const;

type SceneTemplate = (typeof sceneTemplatePool)[number];

const dokgotakCardNewsImagePhilosophy = [
  "카드뉴스는 상세페이지를 여러 장으로 나눈 것이 아니라 짧은 구매전환 콘텐츠다.",
  "읽는 콘텐츠가 아니라 넘기는 콘텐츠이므로 모바일에서 1~2초 안에 이해되어야 한다.",
  "한 장면에는 하나의 메시지, 하나의 주인공, 하나의 감정만 담는다.",
  "크게 말하고, 적게 설명하고, 여백으로 설득한다.",
  "이미지 안에 글자를 만들지 않고, 나중에 한글 자막이 올라갈 고급 여백을 설계한다.",
  "평범한 자료 사진이 아니라 조명, 구도, 렌즈감, 배경 깊이가 있는 프리미엄 카드뉴스 컷으로 만든다.",
  "대본의 추상 문장을 실제로 보이는 상징, 장소, 행동, 표정, 소품으로 번역한다.",
  "각 장면은 배경, 거리, 색감, 조명, 인물 동작이 달라야 한다.",
];

const sceneVisualDirections = {
  hook: {
    textPosition: "bottom",
    direction:
      "Premium scroll-stopping hero still. Make the product large and sharp, with a dramatic diagonal composition, rich side lighting, refined props, and a background that feels expensive. Avoid the plain white table, bottle, and water-glass setup.",
  },
  problem: {
    textPosition: "bottom",
    direction:
      "Lifestyle problem scene. Show the customer's uncomfortable moment or hesitation with one natural person or one clear situation, while the product appears as a believable part of the scene. Use a different room, mood, camera distance, and prop set from scene 1.",
  },
  solution: {
    textPosition: "top",
    direction:
      "Action solution scene. Show a close, tactile usage moment such as a hand preparing the product, a capsule/spoon/water interaction, or a routine setup. Use macro depth of field and motion-ready composition. Do not repeat the simple front bottle plus glass pose.",
  },
  benefit: {
    textPosition: "bottom",
    direction:
      "Benefit lifestyle scene. Show the after-feeling as a premium daily routine: brighter energy, clean kitchen or desk, confident morning, or active lifestyle. Keep claims subtle and realistic. Product should be present but not in the same position as previous scenes.",
  },
  proof: {
    textPosition: "left",
    direction:
      "Trust and proof detail scene. Make a premium macro/detail still using the original product, package label, capsules, measured ingredients, clean lab-wellness props, or PDF-verifiable product details. Create a distinct close-up composition, not a collage or spec sheet.",
  },
  action: {
    textPosition: "right",
    direction:
      "Final CTA hero still. Create an elegant purchase-ready ending frame with the product staged like a high-end catalog shot, refined shadows, premium material textures, and a clear open copy area. It must feel different from all earlier scenes.",
  },
  routine: {
    textPosition: "top",
    direction:
      "Premium daily routine still. The product is the hero in the foreground, sharp and well-lit, while a natural lifestyle setting supports it in the background. Avoid repeating earlier backgrounds or camera angles.",
  },
  detail: {
    textPosition: "left",
    direction:
      "Luxury product detail still. Show package texture, label, cap, ingredients, capsules, or product surface in a clean macro composition. The product must occupy a strong visual area and look expensive.",
  },
  usage: {
    textPosition: "bottom",
    direction:
      "Cinematic usage moment. Show one believable hand/action interaction with the product, with shallow depth of field and premium commercial lighting. Keep the product clear, large, and visually dominant.",
  },
  premium: {
    textPosition: "right",
    direction:
      "Premium brand-value still. Use elegant material textures, controlled shadows, and a refined set design that makes the product feel valuable and purchase-ready.",
  },
} satisfies Record<
  SceneTemplate["name"],
  { textPosition: TextPosition; direction: string }
>;

const textAreaDirections = {
  vertical: {
    bottom:
      "Leave the lower 30% visually calm and dark enough for later Korean typography, without adding text yourself.",
    top: "Leave the upper 25% visually calm and dark enough for later Korean typography, without adding text yourself.",
    left: "Keep the left third visually calm for later Korean typography, but keep the final scene natural and not split-screen.",
    right:
      "Keep the right third visually calm for later Korean typography, but keep the final scene natural and not split-screen.",
  },
  horizontal: {
    bottom:
      "Leave the lower band visually calm for later Korean typography, without adding text yourself.",
    top: "Leave the upper band visually calm for later Korean typography, without adding text yourself.",
    left: "Leave the left 42% visually calm for later Korean typography, with the main subject on the right.",
    right:
      "Leave the right 42% visually calm for later Korean typography, with the main subject on the left.",
  },
} satisfies Record<ImageFormatId, Record<TextPosition, string>>;

function getOpenAiErrorMessage(status: number, data: unknown) {
  const fallback =
    status === 401 || status === 403
      ? "OpenAI API 키가 올바르지 않거나 권한이 없습니다."
      : `OpenAI 이미지 생성 오류가 발생했습니다. 상태 코드: ${status}`;

  if (typeof data !== "object" || data === null) {
    return fallback;
  }

  const error = (data as { error?: { message?: string } }).error;
  return error?.message ?? fallback;
}

type SceneCopy = {
  main: string;
  sub: string;
};

const forbiddenImageText = [
  "Typecast",
  "Pain Point",
  "Solution",
  "Benefit",
  "Proof",
  "CTA",
  "Hook",
  "각 컷의 길이 조정",
  "자막 위치 및 크기 조정",
  "나레이션 음성 톤 강조",
  "배경 음악 추가",
  "효과음 추가",
];

const minSceneImages = 3;
const maxSceneImages = 12;

function clampSceneCount(count: number) {
  return Math.min(maxSceneImages, Math.max(minSceneImages, count));
}

function getFallbackSceneCount(duration?: string) {
  const seconds = Number.parseInt(duration ?? "", 10);

  if (!Number.isFinite(seconds)) {
    return 6;
  }

  if (seconds >= 55) {
    return 12;
  }

  if (seconds >= 25) {
    return 9;
  }

  return 5;
}

function getMaxSceneCountForDuration(duration?: string) {
  const seconds = Number.parseInt(duration ?? "", 10);

  if (!Number.isFinite(seconds)) {
    return 8;
  }

  if (seconds >= 55) {
    return 12;
  }

  if (seconds >= 25) {
    return 10;
  }

  return 6;
}

function extractRequestedSceneCount(productionPlan: string) {
  const patterns = [
    /IMAGE_SCENE_COUNT\s*[:=]\s*(\d{1,2})/i,
    /선택\s*장면\s*수\s*[:=]\s*(\d{1,2})/i,
    /이미지\s*장면\s*수\s*[:=]\s*(\d{1,2})/i,
  ];

  for (const pattern of patterns) {
    const match = productionPlan.match(pattern);
    const count = Number.parseInt(match?.[1] ?? "", 10);

    if (Number.isFinite(count)) {
      return clampSceneCount(count);
    }
  }

  return null;
}

function getSceneTemplate(index: number): SceneTemplate {
  return sceneTemplatePool[index % sceneTemplatePool.length];
}

function lineLooksLikeSceneCopy(line: string) {
  return /(?:^|\s|[-*])(?:\d{1,2}\s*(?:컷|장면|scene)|scene\s*\d{1,2})/i.test(
    line,
  );
}

function cleanCopy(value: string, maxLength: number) {
  const cleaned = value
    .replace(/^[-*]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^\d+[\).\s-]+/, "")
    .replace(/^\d+컷\s*[^:：]*[:：]\s*/, "")
    .replace(/^\d+컷\s*/i, "")
    .replace(/^(후킹|문제 공감|해결|혜택|신뢰|확인 유도|구매 유도)\s*/i, "")
    .replace(/^(메인\s*카피|보조\s*카피|소리\s*멘트|이미지\s*카피|메인|보조)\s*[:：=]?\s*/i, "")
    .replace(/^(main\s*copy|sub\s*copy|caption)\s*[:：]?\s*/i, "")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (forbiddenImageText.some((phrase) => cleaned.includes(phrase))) {
    return "";
  }

  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function parseCopyLine(rawLine: string, fallback: SceneCopy) {
  const cleaned = rawLine
    .replace(/^[-*]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^\d+[\).\s-]+/, "")
    .replace(/^\d+컷\s*[^:：]*[:：]\s*/, "")
    .replace(/^\d+컷\s*/i, "")
    .replace(/^(후킹|문제 공감|해결|혜택|신뢰|확인 유도|구매 유도)\s*/i, "")
    .trim();
  const readableMain = cleaned.match(/(?:메인|main)\s*[=:：]\s*([^/|]+)/i);
  const readableSub = cleaned.match(/(?:보조|sub)\s*[=:：]\s*([^/|]+)/i);

  if (readableMain || readableSub) {
    return {
      main: cleanCopy(readableMain?.[1] ?? cleaned, 34) || fallback.main,
      sub: cleanCopy(readableSub?.[1] ?? "", 34) || fallback.sub,
    };
  }

  const pieces = cleaned
    .replace(/메인\s*카피\s*[:：=]?/gi, "")
    .replace(/메인\s*[:：=]?/gi, "")
    .split(/\s*(?:보조\s*카피\s*[:：=]?|보조\s*[:：=]?|\/|\||→| - )\s*/i)
    .map((piece) => cleanCopy(piece, 34))
    .filter(Boolean);

  return {
    main: pieces[0] || fallback.main,
    sub: pieces[1] || fallback.sub,
  };
}

function extractSceneCopies(productionPlan: string) {
  const lines = productionPlan.split(/\n+/);
  const startIndex = lines.findIndex((line) =>
    line.includes("장면별 소리 멘트/이미지 카피"),
  );
  const copies: SceneCopy[] = [];

  if (startIndex !== -1) {
    for (const rawLine of lines.slice(startIndex + 1)) {
      if (/^\s*(4\.|최종 선택 대본|타임라인 컷 구성)/.test(rawLine)) {
        break;
      }

      if (!/\d+컷/.test(rawLine)) {
        continue;
      }

      const template = sceneTemplates[copies.length];
      if (!template) {
        break;
      }

      copies.push(
        parseCopyLine(rawLine, {
          main: template.fallbackMain,
          sub: template.fallbackSub,
        }),
      );
    }
  }

  if (copies.length >= sceneTemplates.length) {
    return copies;
  }

  const narrationIndex = lines.findIndex((line) =>
    line.includes("Typecast 붙여넣기용 나레이션"),
  );
  const narrationText =
    narrationIndex === -1
      ? ""
      : lines
          .slice(narrationIndex + 1)
          .filter((line) => !/^\s*\d+\./.test(line))
          .join(" ");
  const narrationPieces = narrationText
    .split(/[.!?。！？\n]+/)
    .map((line) => cleanCopy(line, 34))
    .filter(Boolean);

  return sceneTemplates.map((template, index) => {
    if (copies[index]) {
      return copies[index];
    }

    return {
      main: narrationPieces[index] || template.fallbackMain,
      sub: template.fallbackSub,
    };
  });
}

void extractSceneCopies;

function extractNarrationPieces(productionPlan: string) {
  const lines = productionPlan.split(/\n+/);
  const narrationIndex = lines.findIndex(
    (line) =>
      line.includes("최종 나레이션 원문") ||
      line.includes("나레이션 원문") ||
      line.includes("Typecast"),
  );
  const collected: string[] = [];

  if (narrationIndex !== -1) {
    for (const line of lines.slice(narrationIndex + 1)) {
      if (/^\s*\d+\./.test(line) || line.includes("장면별 화면 설계")) {
        break;
      }

      collected.push(line);
    }
  }

  const narrationText =
    collected.length > 0 ? collected.join(" ") : lines.join(" ");

  return narrationText
    .split(/[.!?。！？\n]+/)
    .map((line) => cleanCopy(line, 34))
    .filter(Boolean);
}

function extractDynamicSceneCopies(
  productionPlan: string,
  duration?: string,
  preferredSceneCount = 0,
) {
  const lines = productionPlan.split(/\n+/);
  const requestedCount = extractRequestedSceneCount(productionPlan);
  const durationMaxCount = getMaxSceneCountForDuration(duration);
  const preferredCount =
    preferredSceneCount > 0 ? clampSceneCount(preferredSceneCount) : null;
  const startIndex = lines.findIndex((line) => {
    const lower = line.toLowerCase();
    return (
      (line.includes("장면별") &&
        (line.includes("카피") ||
          line.includes("이미지") ||
          line.includes("멘트"))) ||
      lower.includes("scene copy") ||
      lower.includes("image copy")
    );
  });
  const sourceLines = startIndex === -1 ? lines : lines.slice(startIndex + 1);
  const copies: SceneCopy[] = [];

  for (const rawLine of sourceLines) {
    if (
      startIndex !== -1 &&
      copies.length > 0 &&
      /^\s*(4\.|5\.|6\.|7\.|8\.|9\.|10\.)/.test(rawLine)
    ) {
      break;
    }

    if (!lineLooksLikeSceneCopy(rawLine)) {
      continue;
    }

    const template = getSceneTemplate(copies.length);
    copies.push(
      parseCopyLine(rawLine, {
        main: template.fallbackMain,
        sub: template.fallbackSub,
      }),
    );

    if (copies.length >= maxSceneImages) {
      break;
    }
  }

  if (copies.length >= minSceneImages) {
    const targetCount =
      preferredCount ??
      Math.min(requestedCount ?? copies.length, copies.length, durationMaxCount);

    if (targetCount <= copies.length) {
      return copies.slice(0, clampSceneCount(targetCount));
    }
  }

  const narrationPieces = extractNarrationPieces(productionPlan);
  const targetCount =
    preferredCount ??
    clampSceneCount(
      Math.min(
        requestedCount ??
          Math.max(narrationPieces.length, getFallbackSceneCount(duration)),
        durationMaxCount,
      ),
    );

  return Array.from({ length: targetCount }, (_, index) => {
    if (copies[index]) {
      return copies[index];
    }

    const template = getSceneTemplate(index);

    return {
      main: narrationPieces[index] || template.fallbackMain,
      sub: template.fallbackSub,
    };
  });
}

function shortenIntroCopy(value: string, maxLength: number, fallback: string) {
  const cleaned = cleanCopy(value, maxLength);

  if (!cleaned) {
    return fallback;
  }

  return cleaned.length > maxLength
    ? `${cleaned.slice(0, Math.max(1, maxLength - 1))}…`
    : cleaned;
}

function extractIntroSceneCopy(
  productionPlan: string,
  sceneCopies: SceneCopy[],
) {
  const fallback = sceneCopies[0] ?? {
    main: "지금 멈춰볼 순간",
    sub: "첫 장면에서 바로 이유를 보여줍니다.",
  };
  const lines = productionPlan.split(/\n+/);
  const startIndex = lines.findIndex(
    (line) =>
      line.includes("인트로 후킹 카피") ||
      line.includes("인트로 카피") ||
      line.includes("Intro hook copy"),
  );

  if (startIndex !== -1) {
    for (const rawLine of lines.slice(startIndex + 1)) {
      if (/^\s*\d+\./.test(rawLine) && !rawLine.includes("인트로")) {
        break;
      }

      if (!rawLine.includes("인트로") && !rawLine.includes("메인")) {
        continue;
      }

      const parsed = parseCopyLine(rawLine, fallback);
      if (parsed.main) {
        return {
          main: shortenIntroCopy(parsed.main, 18, fallback.main),
          sub: shortenIntroCopy(parsed.sub, 28, fallback.sub),
        };
      }
    }
  }

  return {
    main: shortenIntroCopy(fallback.main, 18, "지금 멈춰볼 순간"),
    sub: shortenIntroCopy(
      fallback.sub || fallback.main,
      28,
      "첫 장면에서 바로 이유를 보여줍니다.",
    ),
  };
}

function extractIntroVisualDirection(productionPlan: string, analysis: string) {
  const planLines = productionPlan.split(/\n+/);
  const startIndex = planLines.findIndex(
    (line) =>
      line.includes("인트로 이미지 생성 지시") ||
      line.includes("Intro hook image"),
  );

  if (startIndex !== -1) {
    for (const rawLine of planLines.slice(startIndex + 1)) {
      if (/^\s*\d+\./.test(rawLine) && !rawLine.includes("인트로")) {
        break;
      }

      if (!rawLine.includes("인트로")) {
        continue;
      }

      const cleaned = cleanCopy(
        rawLine
          .replace(/^[-*]\s*/, "")
          .replace(/^인트로\s*[:：-]?\s*/i, ""),
        220,
      );

      if (cleaned) {
        return cleaned;
      }
    }
  }

  const firstAnalysisLine =
    analysis
      .split(/\n+/)
      .map((line) => cleanCopy(line, 120))
      .find((line) => /[가-힣]/.test(line)) ?? "";

  return `대본의 가장 강한 고민이나 욕망을 첫 1초에 보여주는 시네마틱 인트로 장면. ${firstAnalysisLine}`;
}

function extractSceneVisualDirections(productionPlan: string, analysis: string) {
  const planLines = productionPlan.split(/\n+/);
  const analysisLines = analysis.split(/\n+/);
  const imagePromptIndex = planLines.findIndex((line) =>
    line.includes("이미지 생성 지시서"),
  );
  const sceneDesignIndex = planLines.findIndex((line) => {
    const lower = line.toLowerCase();
    return (
      lower.includes("scene visuals") ||
      line.includes("장면별 화면 설계")
    );
  });
  const sceneVisualIndex =
    imagePromptIndex !== -1 ? imagePromptIndex : sceneDesignIndex;
  const analysisVisualIndex = analysisLines.findIndex((line) =>
    line.includes("장면별 화면 지시"),
  );
  const sourceLines =
    sceneVisualIndex !== -1
      ? planLines.slice(sceneVisualIndex + 1)
      : analysisVisualIndex !== -1
        ? analysisLines.slice(analysisVisualIndex + 1)
        : [];
  const directions: string[] = [];

  for (const rawLine of sourceLines) {
    if (
      directions.length > 0 &&
      (rawLine.includes("사용자 입력 대본") ||
        rawLine.toLowerCase().includes("style directions") ||
        rawLine.toLowerCase().includes("brand mood rules") ||
        rawLine.toLowerCase().includes("scene composition") ||
        rawLine.toLowerCase().includes("scene copy") ||
        rawLine.includes("장면별 제작표") ||
        rawLine.includes("장면별 자막 카피") ||
        rawLine.includes("스타일 및 사운드 방향") ||
        rawLine.includes("영상 스타일 디렉션") ||
        rawLine.includes("브랜드/무드 사용 규칙"))
    ) {
      break;
    }

    const visualMatch = rawLine.match(/visual\s*=\s*([^/|]+)/i);
    const subjectSceneMatch = rawLine.match(/주인공과\s*장면\s*=\s*([^/|]+)/);
    const numberedMatch = rawLine.match(/^\s*\d+[\).\s-]+(.+)/);
    const sceneMatch = rawLine.match(/Scene\s*\d+\s*[:：-]\s*(.+)/i);
    const cutMatch = rawLine.match(/^\s*-?\s*\d{1,2}\s*컷\s*[:：-]\s*(.+)/);
    const visual =
      visualMatch?.[1] ??
      subjectSceneMatch?.[1] ??
      sceneMatch?.[1] ??
      cutMatch?.[1] ??
      numberedMatch?.[1] ??
      "";
    const cleaned = cleanCopy(
      visual.replace(/^visual\s*=\s*/i, "").replace(/^[-*]\s*/, ""),
      160,
    );

    if (cleaned) {
      directions.push(cleaned);
    }
  }

  return directions;
}

function extractSectionLines(
  source: string,
  sectionLabel: string | string[],
  stopLabels: string[],
) {
  const lines = source.split(/\n+/);
  const sectionLabels = Array.isArray(sectionLabel)
    ? sectionLabel
    : [sectionLabel];
  const startIndex = lines.findIndex((line) =>
    sectionLabels.some((label) => line.includes(label)),
  );

  if (startIndex === -1) {
    return [];
  }

  const collected: string[] = [];

  for (const rawLine of lines.slice(startIndex + 1)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (stopLabels.some((label) => line.includes(label))) {
      break;
    }

    const cleaned = cleanCopy(
      line
        .replace(/^[-*]\s*/, "")
        .replace(/^\d+[\).\s-]+/, "")
        .replace(/^visual\s*=\s*/i, ""),
      220,
    );

    if (cleaned) {
      collected.push(cleaned);
    }
  }

  return collected;
}

function extractStyleDirections(productionPlan: string, analysis: string) {
  return [
    ...extractSectionLines(productionPlan, ["Style directions", "스타일 및 사운드 방향"], [
      "Brand mood rules",
      "Scene composition",
      "Scene copy",
      "브랜드/무드 사용 규칙",
      "금지 규칙",
    ]),
    ...extractSectionLines(analysis, "영상 스타일 디렉션", [
      "브랜드/무드 사용 규칙",
      "장면별 화면 지시",
      "사용자 입력 대본",
    ]),
  ].slice(0, 28);
}

function extractBrandMoodRules(productionPlan: string, analysis: string) {
  return [
    ...extractSectionLines(productionPlan, ["Brand mood rules", "브랜드/무드 사용 규칙"], [
      "Scene composition",
      "Scene copy",
      "금지 규칙",
      "최종 렌더 지시",
    ]),
    ...extractSectionLines(analysis, "브랜드/무드 사용 규칙", [
      "장면별 화면 지시",
      "사용자 입력 대본",
    ]),
  ].slice(0, 16);
}

function buildScenePrompt(options: {
  sceneLabel: string;
  sceneRole: string;
  sceneNumber: number;
  sceneCount: number;
  sceneVisualDirection: string;
  formatLabel: string;
  formatLayout: string;
  textAreaDirection: string;
  analysis: string;
  hasReferenceImages: boolean;
  styleDirections: string[];
  brandMoodRules: string[];
}) {
  const referenceRules = options.hasReferenceImages
    ? `실제 제품 이미지는 유지하고, 배경/분위기와 카드뉴스형 화면 구도만 연출한다.
제품 형태, 색상, 구성품, 로고, 패키지 구조를 임의로 바꾸지 않는다.
참고 이미지는 제품 이해용으로만 사용하고, 최종 결과는 하나의 자연스러운 단일 장면으로 만든다.
The product must be the visual hero: large, sharp, well-lit, and immediately recognizable. Do not hide it behind people, props, text space, or background objects.
원본 제품 패키지에 이미 인쇄된 라벨 외에는 어떤 신규 텍스트도 만들지 않는다.`
    : `참조 제품 이미지가 없으므로 가짜 제품 병, 건강식품 통, 화장품 용기, 패키지 박스, 브랜드 라벨, 로고를 만들지 않는다.
제품 형태, 효능, 인증, 가격, 성분, 리뷰, 수상 내역을 임의로 만들지 않는다.
대본과 장면표에 나온 현실 요소만 사용하고, 사용자가 말하지 않은 상품을 새로 만들지 않는다.
The scene subject must follow the user-provided visual direction, not a generic product hero shot.
If a person appears, keep it cinematic, realistic, respectful, and emotionally clear.`;
  const subjectSummaryLabel = options.hasReferenceImages
    ? "제품 분석 요약"
    : "한글 대본 및 장면 지시 요약";
  const cardNewsPrinciples = dokgotakCardNewsImagePhilosophy
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");
  const styleRules = options.hasReferenceImages
    ? `독고탁 에이젼시 카드뉴스 만들기 스타일을 참고한다.
제품을 크게 보여주되, 배경은 상세페이지 정보 나열이 아니라 프리미엄 광고 화보처럼 설계한다.
모바일에서 1-2초 안에 메시지가 읽히는 카드뉴스 무드로 단순하고 세련되게 연출한다.
넓은 여백, 감도 높은 조명, 소재감 있는 배경, 깊이감 있는 카메라 구도를 만든다.`
    : `독고탁 에이젼시 카드뉴스 만들기 스타일을 참고한다.
제품이 없을 때도 대본 속 사람, 장소, 행동, 상징물을 광고 스틸의 주인공으로 만든다.
사용자 대본의 콘셉트와 색감 지시를 우선하고, 특정 업종이나 소재를 임의로 끼워 넣지 않는다.
모바일에서 1-2초 안에 상황과 감정이 이해되는 프리미엄 카드뉴스 무드로 단순하고 세련되게 연출한다.`;
  const userStyleRules =
    options.styleDirections.length > 0
      ? options.styleDirections
          .map((line, index) => `${index + 1}. ${line}`)
          .join("\n")
      : "No additional user style notes.";
  const brandMoodRules =
    options.brandMoodRules.length > 0
      ? options.brandMoodRules
          .map((line, index) => `${index + 1}. ${line}`)
          .join("\n")
      : "Do not create real brand logos, trademarks, mascots, or copied package designs. If a brand is mentioned as a mood reference, use only broad color, energy, pacing, and advertising mood.";

  return `${
    options.hasReferenceImages
      ? "REFERENCE PRODUCT IMAGE PROVIDED. Keep the original product/package faithful to the uploaded reference."
      : "NO REFERENCE PRODUCT IMAGE PROVIDED. Create premium advertising background/lifestyle scenes from the Korean user script only. Do not invent a fake product package, logo, brand label, certification, price, ingredient fact, medical effect, or product-specific claim. Use the Korean script as the only source of meaning. Keep the final image text-free so Korean typography can be added later in the video renderer."
  }

NO TEXT IMAGE. 최종 이미지는 글자가 전혀 없는 광고 배경 이미지여야 한다.

독고탁 에이젼시 카드뉴스 이미지 철학:
${cardNewsPrinciples}

${referenceRules}
없는 인증, 수상, 리뷰, 효능, 1위/최고/완벽 같은 과장 표현을 만들지 않는다.
결과 이미지는 한 장의 연속된 사진처럼 보여야 한다.
콜라쥬, 몽타주, 분할 화면, 그리드, 여러 장의 사진을 붙인 구성, 상세페이지 캡처 형태를 절대 만들지 않는다.
한 이미지 안에 같은 제품을 여러 번 복제하거나 여러 컷을 동시에 배치하지 않는다.
출력 비율은 ${options.formatLabel} 광고 영상에 맞춘다.
${options.formatLayout}

Scene ${options.sceneNumber} of ${options.sceneCount} must have a clearly different visual idea from the other images.
Scene visual direction:
${options.sceneVisualDirection}

Card-news visual decision:
- Message: show only the core emotion or promise of this one scene.
- Hero subject: choose one dominant product, person, object, or action from the scene direction.
- Setting: use one believable location that supports the script, not a generic stock background.
- Camera: use a clear commercial-photo angle such as hero close-up, over-the-shoulder, low angle, macro detail, or cinematic wide shot.
- Lighting: choose deliberate premium lighting that matches the emotional stage.
- Composition: leave negative space for captions while keeping the hero subject strong and not tiny.
- Variation: make this scene visually different from every other scene.

Reserved copy area:
${options.textAreaDirection}

Across the full ${options.sceneCount}-scene set, do not reuse the same background, table surface, camera distance, product position, prop set, lighting direction, or person pose.
Do not make multiple versions of the same product photo.
Do not use the plain white tabletop + water glass + bottle composition unless the scene direction explicitly requires it.
Each image must feel like a unique premium advertising still for a shorts video.
${styleRules}

User-provided style direction:
${userStyleRules}

Brand/mood reference rules:
${brandMoodRules}
If a real brand name appears, do not reproduce its logo, mascot, exact package, typography, trade dress, or trademarked visual identity. Use only the requested general mood, color energy, pacing, and composition.

글자, 단어, 문장, 숫자, 한글, 영어, 제품 설명 문구, 광고 카피, CTA 버튼, 가격표, 정보 박스, 아이콘 나열, 스펙표, 긴 설명문은 이미지 안에 절대 넣지 않는다.
타이포그래피 영역은 비워 둔다. 포스터, 전단지, 카드뉴스 완성본, 텍스트가 박힌 상세페이지처럼 만들면 실패다.
메인 카피와 보조 카피는 후처리 렌더러가 직접 올린다. 이미지 모델은 텍스트 없는 배경과 제품 장면만 만든다.
내부 라벨, 컷 번호, 페이지 번호, Typecast, Pain Point, Solution, Benefit, Proof, CTA, Hook 같은 제작 용어는 이미지에 넣지 않는다.

장면 목표:
${options.sceneLabel} - ${options.sceneRole}

${subjectSummaryLabel}:
${options.analysis.slice(0, 2400)}

스타일:
프리미엄 쇼츠 카드뉴스용, 모바일에서 선명한 단일 메시지 컷, 깨끗한 상업 사진 느낌, 자연스러운 조명, 과장 없는 실제감.`;
}

async function generateSceneWithImages(options: {
  apiKey: string;
  imageFiles: ReturnType<typeof getUploadedFiles>;
  prompt: string;
  size: string;
}) {
  const formData = new FormData();
  formData.append("model", "gpt-image-1.5");
  formData.append("prompt", options.prompt);
  formData.append("size", options.size);
  formData.append("quality", "high");
  formData.append("background", "opaque");

  options.imageFiles.slice(0, 1).forEach((file) => {
    const blob = new Blob([storedFileToBytes(file)], { type: file.fileType });
    formData.append("image[]", blob, file.fileName);
  });

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: formData,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(getOpenAiErrorMessage(response.status, data));
  }

  const imageBase64 = (data as { data?: Array<{ b64_json?: string }> }).data?.[0]
    ?.b64_json;

  if (!imageBase64) {
    throw new Error("이미지 생성 결과를 찾지 못했습니다.");
  }

  return imageBase64;
}

async function generateSceneWithoutImages(options: {
  apiKey: string;
  prompt: string;
  size: string;
}) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt: options.prompt,
      size: options.size,
      quality: "high",
      background: "opaque",
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(getOpenAiErrorMessage(response.status, data));
  }

  const imageBase64 = (data as { data?: Array<{ b64_json?: string }> }).data?.[0]
    ?.b64_json;

  if (!imageBase64) {
    throw new Error("이미지 생성 결과를 찾지 못했습니다.");
  }

  return imageBase64;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as SceneImagePayload;
    const apiKey = await resolveOpenAiApiKey(payload.openaiApiKey);
    const sessionId = payload.sessionId?.trim();
    const fileMetas = payload.files ?? [];
    const analysis = payload.analysis?.trim();
    const productionPlan = payload.productionPlan?.trim();
    const duration = payload.duration?.trim();
    const includeIntroImage = payload.includeIntroImage !== false;
    const targetSceneIndex =
      typeof payload.targetSceneIndex === "number" &&
      Number.isInteger(payload.targetSceneIndex)
        ? payload.targetSceneIndex
        : null;
    const regenerationNote = payload.regenerationNote?.trim();
    const targetTextPosition = isTextPosition(payload.targetTextPosition)
      ? payload.targetTextPosition
      : null;
    const formatId: ImageFormatId =
      payload.videoFormat === "horizontal" ? "horizontal" : "vertical";
    const imageFormat = imageFormats[formatId];

    if (!apiKey) {
      return Response.json(
        { ok: false, message: "OpenAI API 키를 먼저 저장해주세요." },
        { status: 400 },
      );
    }

    if (!analysis || !productionPlan) {
      return Response.json(
        { ok: false, message: "분석 결과와 영상 제작안이 필요합니다." },
        { status: 400 },
      );
    }

    const uploadedFiles =
      sessionId && fileMetas.length > 0
        ? getUploadedFiles(sessionId, fileMetas)
        : [];
    const imageFiles = uploadedFiles.filter((file) =>
      ["image/png", "image/jpeg", "image/webp"].includes(file.fileType),
    );

    const sceneVisuals = extractSceneVisualDirections(productionPlan, analysis);
    const sceneCopies = extractDynamicSceneCopies(
      productionPlan,
      duration,
      sceneVisuals.length,
    );
    const styleDirections = extractStyleDirections(productionPlan, analysis);
    const brandMoodRules = extractBrandMoodRules(productionPlan, analysis);
    const images = [];
    const failedScenes: string[] = [];
    const shouldGenerateIntro =
      includeIntroImage &&
      (targetSceneIndex === null || targetSceneIndex === -1);

    if (targetSceneIndex === -1 && !includeIntroImage) {
      return Response.json(
        { ok: false, message: "인트로 후킹 이미지가 꺼져 있습니다." },
        { status: 400 },
      );
    }

    if (shouldGenerateIntro) {
      const introCopy = extractIntroSceneCopy(productionPlan, sceneCopies);
      const introTextPosition: TextPosition =
        formatId === "horizontal" ? "left" : "bottom";
      const regenerationDirection = regenerationNote
        ? `\nRegeneration correction note: ${regenerationNote}. Make the intro hook stronger while keeping it text-free, premium, and faithful to the script.`
        : "";
      const prompt = buildScenePrompt({
        sceneLabel: "인트로 후킹 이미지",
        sceneRole:
          "본편 1컷 전에 들어가는 강력한 첫 장면. 일반 장면보다 대비, 감정, 구도, 시선 집중력이 강해야 한다.",
        sceneNumber: 0,
        sceneCount: sceneCopies.length + 1,
        sceneVisualDirection: `${extractIntroVisualDirection(
          productionPlan,
          analysis,
        )}

Intro hook visual requirements:
- Create one cinematic premium advertising still, not a thumbnail poster and not a collage.
- The first second must feel urgent, emotional, or desirable enough to stop scrolling.
- Use stronger contrast, a bolder subject scale, a more dramatic camera angle, and cleaner negative space than normal scenes.
- Do not add Korean, English, numbers, CTA buttons, logo marks, or internal stage labels inside the image.
- Keep the later Korean caption area visually calm.${regenerationDirection}`,
        formatLabel: imageFormat.label,
        formatLayout: imageFormat.layout,
        textAreaDirection: textAreaDirections[formatId][introTextPosition],
        analysis,
        hasReferenceImages: imageFiles.length > 0,
        styleDirections,
        brandMoodRules,
      });

      try {
        const imageBase64 =
          imageFiles.length > 0
            ? await generateSceneWithImages({
                apiKey,
                imageFiles,
                prompt,
                size: imageFormat.size,
              })
            : await generateSceneWithoutImages({
                apiKey,
                prompt,
                size: imageFormat.size,
              });

        images.push({
          name: "intro-hook",
          sceneIndex: -1,
          isIntro: true,
          mimeType: "image/png",
          base64: imageBase64,
          copy: introCopy,
          textPosition: introTextPosition,
        });
      } catch (error) {
        failedScenes.push(
          `인트로: ${
            error instanceof Error ? error.message : "이미지 생성 실패"
          }`,
        );
      }
    }

    const sceneEntries = sceneCopies
      .map((copy, index) => ({ copy, index }))
      .filter(({ index }) =>
        targetSceneIndex === null ? true : index === targetSceneIndex,
      );

    if (
      targetSceneIndex !== null &&
      targetSceneIndex !== -1 &&
      sceneEntries.length === 0
    ) {
      return Response.json(
        { ok: false, message: "다시 생성할 장면 번호를 찾지 못했습니다." },
        { status: 400 },
      );
    }

    for (const { index, copy } of sceneEntries) {
      const scene = getSceneTemplate(index);
      const visualDirection = sceneVisualDirections[scene.name];
      const textPosition =
        targetSceneIndex === index && targetTextPosition
          ? targetTextPosition
          : visualDirection.textPosition;
      const userVisualDirection = sceneVisuals[index];
      const regenerationDirection = regenerationNote
        ? `\nRegeneration correction note: ${regenerationNote}. Fix this issue while keeping the script meaning, text-free frame, premium card-news style, and scene number ${index + 1}.`
        : "";
      const prompt = buildScenePrompt({
        sceneLabel: userVisualDirection
          ? `${index + 1}컷 사용자 장면`
          : scene.label,
        sceneRole: userVisualDirection ?? scene.role,
        sceneNumber: index + 1,
        sceneCount: sceneCopies.length,
        sceneVisualDirection: userVisualDirection
          ? `Follow this user-provided visual direction exactly: ${userVisualDirection}. Keep the frame text-free and cinematic.${regenerationDirection}`
          : `${visualDirection.direction}${regenerationDirection}`,
        formatLabel: imageFormat.label,
        formatLayout: imageFormat.layout,
        textAreaDirection:
          textAreaDirections[formatId][textPosition],
        analysis,
        hasReferenceImages: imageFiles.length > 0,
        styleDirections,
        brandMoodRules,
      });

      try {
        const imageBase64 =
          imageFiles.length > 0
            ? await generateSceneWithImages({
                apiKey,
                imageFiles,
                prompt,
                size: imageFormat.size,
              })
            : await generateSceneWithoutImages({
                apiKey,
                prompt,
                size: imageFormat.size,
              });

        images.push({
          name: `${scene.name}-${index + 1}`,
          sceneIndex: index,
          mimeType: "image/png",
          base64: imageBase64,
          copy,
          textPosition,
        });
      } catch (error) {
        failedScenes.push(
          `${index + 1}컷: ${
            error instanceof Error ? error.message : "이미지 생성 실패"
          }`,
        );
      }
    }

    if (images.length === 0) {
      return Response.json(
        {
          ok: false,
          message:
            failedScenes[0] ??
            "제품 광고 이미지 생성에 실패했습니다. OpenAI API 키, 조직 인증, 제품 이미지 파일을 확인해주세요.",
        },
        { status: 500 },
      );
    }

    return Response.json({
      ok: true,
      images,
      message:
        failedScenes.length > 0
          ? `${images.length}장은 생성됐고 ${failedScenes.length}장은 실패했습니다. ${failedScenes[0]}`
          : `${images.length}장의 제품 광고 이미지를 생성했습니다.`,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "제품 광고 이미지 생성 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
