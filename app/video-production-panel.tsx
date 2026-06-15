"use client";

import { useRef, useState } from "react";
import {
  durations,
  formatProgressTime,
  getDurationSeconds,
  getImageGenerationEstimateSeconds,
  getIntroDurationSeconds,
  getTextPositionOptions,
  getVideoFormat,
  getVoiceGender,
  scriptModes,
  scriptTypes,
  textPositionLabels,
  uploadChunkSize,
  videoFormats,
  voiceGenders,
  voiceStyles,
  type SceneCopy,
  type ScriptModeId,
  type TextPosition,
  type VideoFormatId,
  type VoiceGenderId,
} from "./lib/studio-config";
import { getRequestApiKey } from "./lib/browser-api-keys";
import {
  extractBrandMoodRules,
  extractManualSceneVisuals,
  extractManualStoryboardRows,
  extractManualStyleDirections,
  splitManualScriptLines,
  type ManualStoryboardRow,
} from "./lib/manual-script";

type GeneratedSceneImage = {
  name: string;
  mimeType: string;
  base64: string;
  copy?: SceneCopy;
  textPosition?: TextPosition;
  sceneIndex?: number;
  isIntro?: boolean;
};

type SceneImageReview = {
  sceneIndex: number;
  score: number;
  status: "pass" | "warning" | "fail";
  shouldRegenerate: boolean;
  issue: string;
  fix: string;
  strength?: string;
};

type ManualScriptInterpretation = {
  protagonist: string;
  customerProblem: string;
  emotionalFlow: string;
  turningPoint: string;
  solutionRole: string;
  cta: string;
  mustShow: string[];
  avoid: string[];
};

type ManualSceneRow = {
  time: string;
  role: string;
  visual: string;
  narration: string;
  caption: string;
  mainCopy: string;
  subCopy: string;
  reason: string;
};

type ImageGenerationProgress = {
  percent: number;
  label: string;
  detail: string;
  elapsedSeconds: number;
  estimatedSeconds: number;
};

const bannedVisiblePhrases = [
  "Typecast 붙여넣기용 나레이션",
  "각 컷의 길이 조정",
  "자막 위치 및 크기 조정",
  "나레이션 음성 톤 강조",
  "배경 음악 추가",
  "효과음 추가",
  "Pain Point",
  "Solution",
  "Benefit",
  "Proof",
  "CTA",
  "Hook",
  "타임라인 컷 구성",
  "편집 체크리스트",
  "썸네일 시작안",
  "Runway",
  "영상 생성용 프롬프트",
  "다음 실행 버튼 안내",
  "Typecast",
];

const internalStageLabels = [
  "후킹",
  "문제 공감",
  "해결",
  "혜택",
  "신뢰",
  "확인 유도",
  "구매 유도",
];

const dokgotakProductionPhilosophy = [
  "대본을 예쁘게 정리하는 것이 아니라 촬영감독이 바로 만들 수 있는 결정서로 바꾼다.",
  "사용자의 의도를 먼저 읽고 감정 흐름, 시간, 장면, 자막, 이미지 지시를 결정한다.",
  "이미지는 대본의 뜻을 보여주며, 한글 문구는 이미지 안에 만들지 않고 영상 렌더러가 합성한다.",
  "사용자가 쓰지 않은 제품 효능, 가격, 인증, 실제 브랜드 로고는 임의로 만들지 않는다.",
  "최종 결과물에는 내부 단계명이 아니라 고객에게 보이는 한국어 문장만 남긴다.",
];

const dokgotakCardNewsImagePhilosophy = [
  "카드뉴스는 상세페이지를 여러 장으로 나눈 것이 아니라 짧은 구매전환 콘텐츠다.",
  "읽는 콘텐츠가 아니라 넘기는 콘텐츠이므로 모바일에서 1~2초 안에 이해되어야 한다.",
  "한 장면에는 하나의 메시지, 하나의 주인공, 하나의 감정만 담는다.",
  "크게 말하고, 적게 설명하고, 여백으로 설득한다.",
  "한글 문구는 이미지 안에 만들지 않고, 나중에 자막이 올라갈 고급 여백을 설계한다.",
  "대본의 추상 문장을 실제로 보이는 장소, 행동, 표정, 소품으로 번역한다.",
  "각 장면은 배경, 거리, 색감, 조명, 인물 동작이 달라야 한다.",
];

function getOpenAiKey() {
  return getRequestApiKey("openai");
}

function getTypecastKey() {
  return getRequestApiKey("typecast");
}

function getSceneLabel(sceneIndex: number, isIntro = false) {
  if (isIntro || sceneIndex < 0) {
    return "인트로";
  }

  return `${sceneIndex + 1}컷`;
}

function buildSceneDurations(
  totalMs: number,
  sceneCount: number,
  sceneIntroFlags: boolean[],
  duration: string,
) {
  if (sceneCount <= 0) {
    return [totalMs];
  }

  const hasIntro = sceneIntroFlags[0] === true;
  if (!hasIntro || sceneCount === 1) {
    return Array.from({ length: sceneCount }, () => totalMs / sceneCount);
  }

  const desiredIntroMs = getIntroDurationSeconds(duration) * 1000;
  const introMs = Math.min(
    desiredIntroMs,
    Math.max(900, Math.floor(totalMs * 0.22)),
  );
  const restMs = Math.max(1, totalMs - introMs);
  const restSceneCount = Math.max(1, sceneCount - 1);

  return [
    introMs,
    ...Array.from({ length: restSceneCount }, () => restMs / restSceneCount),
  ];
}

function getSceneTiming(elapsed: number, sceneDurations: number[]) {
  let accumulatedMs = 0;

  for (let index = 0; index < sceneDurations.length; index += 1) {
    const durationMs = sceneDurations[index] ?? 1;

    if (elapsed < accumulatedMs + durationMs || index === sceneDurations.length - 1) {
      return {
        index,
        elapsedMs: Math.max(0, elapsed - accumulatedMs),
        durationMs,
      };
    }

    accumulatedMs += durationMs;
  }

  return {
    index: 0,
    elapsedMs: elapsed,
    durationMs: sceneDurations[0] ?? 1,
  };
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function getCurrentTimestampMs() {
  return Date.now();
}

function getReviewBadgeClass(review?: SceneImageReview) {
  if (!review) {
    return "bg-black/72 text-white";
  }

  if (review.status === "pass" && !review.shouldRegenerate) {
    return "bg-[#126252] text-white";
  }

  if (review.status === "warning" && !review.shouldRegenerate) {
    return "bg-[#ffcf3f] text-[#2b2925]";
  }

  return "bg-[#e74032] text-white";
}

function getReviewBadgeLabel(review?: SceneImageReview) {
  if (!review) {
    return "검수 전";
  }

  if (review.status === "pass" && !review.shouldRegenerate) {
    return `통과 ${review.score}`;
  }

  if (review.status === "warning" && !review.shouldRegenerate) {
    return `주의 ${review.score}`;
  }

  return `재생성 권장 ${review.score}`;
}

function cleanLine(line: string) {
  return line
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[\).\s-]+/, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\d+\s*(?:컷|장면|scene)?\s*[:：-]?\s*/i, "")
    .replace(
      /^(후킹|문제 공감|해결|혜택|신뢰|확인 유도|구매 유도|CTA|Pain Point|Solution|Benefit|Proof)\s*[:：-]?\s*/i,
      "",
    )
    .replace(/^(자막|나레이션|화면|컷 번호|시간|필요 소재)\s*[:：-]?\s*/i, "")
    .trim();
}

function isInternalLine(line: string) {
  const normalized = line.trim();

  if (!normalized) {
    return true;
  }

  if (bannedVisiblePhrases.some((phrase) => normalized.includes(phrase))) {
    return true;
  }

  if (internalStageLabels.includes(normalized.replace(/[:：]$/, ""))) {
    return true;
  }

  if (/^(Scene|Cut|컷|장면)\s*\d+/i.test(normalized)) {
    return true;
  }

  if (/^\[?\d+\s*[-~]\s*\d+\s*초]?/.test(normalized)) {
    return true;
  }

  if (/^(화면|자막|나레이션|필요 소재|시간|컷 번호)\s*[:：]/.test(normalized)) {
    return true;
  }

  return false;
}

function normalizeCaption(line: string) {
  const cleaned = cleanLine(line)
    .replace(/["'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (cleaned.length <= 35) {
    return cleaned;
  }

  return `${cleaned.slice(0, 34)}...`;
}

function normalizeIntroCaption(line: string, fallback: string, maxLength = 18) {
  const cleaned = normalizeCaption(line || fallback)
    .replace(/\.\.\.$/, "")
    .trim();
  const safeText = cleaned || fallback;

  return safeText.length > maxLength
    ? `${safeText.slice(0, Math.max(1, maxLength - 1))}…`
    : safeText;
}

function getManualSceneLimit(duration: string) {
  const seconds = getDurationSeconds(duration);

  if (seconds >= 55) {
    return 12;
  }

  if (seconds >= 25) {
    return 10;
  }

  return 6;
}

function getManualSceneCount(
  scriptLines: string[],
  duration: string,
  sceneVisualCount = 0,
) {
  if (scriptLines.length === 0 && sceneVisualCount === 0) {
    return 0;
  }

  if (sceneVisualCount > 0) {
    return Math.min(getManualSceneLimit(duration), sceneVisualCount);
  }

  const seconds = getDurationSeconds(duration);

  if (seconds >= 55) {
    return Math.min(12, Math.max(8, scriptLines.length));
  }

  if (seconds >= 25) {
    return Math.min(8, Math.max(6, Math.ceil(scriptLines.length * 0.75)));
  }

  return Math.min(5, Math.max(3, Math.ceil(scriptLines.length * 0.7)));
}

function findManualLine(
  scriptLines: string[],
  patterns: RegExp[],
  fallbackIndex = 0,
) {
  return (
    scriptLines.find((line) => patterns.some((pattern) => pattern.test(line))) ??
    scriptLines[fallbackIndex] ??
    ""
  );
}

function collectManualLines(scriptLines: string[], patterns: RegExp[]) {
  return scriptLines.filter((line) =>
    patterns.some((pattern) => pattern.test(line)),
  );
}

function uniqueNonEmpty(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function buildManualScriptInterpretation(
  scriptLines: string[],
): ManualScriptInterpretation {
  const joined = scriptLines.join(" ");
  const protagonistLine = findManualLine(scriptLines, [
    /CEO|대표|사장|창업자|가장|엄마|아빠|여성|남성|주인공/,
  ]);
  const problemLine = findManualLine(scriptLines, [
    /막막|힘들|어렵|부족|고민|문제|몰라|직접|해야|시간/,
  ], 1);
  const workloadLines = collectManualLines(scriptLines, [
    /상세페이지|대표이미지|카드뉴스|광고|콘텐츠|문구|디자인|업로드/,
  ]);
  const turningPoint = findManualLine(scriptLines, [
    /그러다|만났|발견|알게|시작|이제는/,
  ], Math.max(0, Math.floor(scriptLines.length / 2)));
  const solutionLines = collectManualLines(scriptLines, [
    /AI|로봇|로보트|자동|정리|한 번에|제품 사진|만들어|해줍/,
  ]);
  const ctaLines = collectManualLines(scriptLines, [
    /댓글|DM|사이트|무료|선착순|시작|남겨|보내/,
  ]);
  const protagonist =
    /30대.*여성.*CEO|여성.*CEO/.test(joined)
      ? "30대 여성 CEO이자 나홀로 창업자"
      : protagonistLine || "대본 속 주인공 고객";
  const customerProblem =
    workloadLines.length > 0
      ? `${problemLine} ${workloadLines.slice(0, 2).join(" ")}`
      : problemLine || "혼자 해결해야 하는 일이 많아 막막한 상황";
  const emotionalFlow = [
    "막막함",
    customerProblem ? "업무 과부하" : "",
    turningPoint ? "해결책 발견" : "",
    solutionLines.length > 0 ? "안도감" : "",
    ctaLines.length > 0 ? "행동 유도" : "결심",
  ]
    .filter(Boolean)
    .join(" → ");
  const solutionRole =
    solutionLines.join(" ") ||
    "사용자의 문제를 줄이고 결과물을 한 번에 정리해주는 해결책";
  const cta =
    ctaLines.join(" ") ||
    scriptLines[scriptLines.length - 1] ||
    "지금 확인해보라는 행동 유도";
  const mustShow = uniqueNonEmpty([
    protagonist.includes("여성 CEO")
      ? "30대 여성 CEO가 혼자 창업을 준비하거나 일하는 장면"
      : `${protagonist}가 실제 문제를 겪는 장면`,
    workloadLines.length > 0
      ? "상세페이지, 대표이미지, 카드뉴스, 광고 문구 업무가 한꺼번에 쌓인 화면"
      : "대본 속 문제를 상징하는 업무 장면",
    /좋은 제품|제품 사진|제품/.test(joined)
      ? "좋은 제품 또는 제품 사진을 업로드하는 장면"
      : "",
    /AI|로봇|로보트/.test(joined)
      ? "AI 로봇 또는 자동화 시스템이 콘텐츠를 정리하는 장면"
      : "",
    /독고탁/.test(joined)
      ? "독고탁 에이젼시가 해결책으로 등장하는 전환 장면"
      : "",
    ctaLines.length > 0 ? "댓글, 사이트, DM, 무료 이용 CTA가 읽히는 엔딩" : "",
  ]);
  const avoid = [
    "대본과 관계없는 일반 사무실 인물 사진 반복",
    "의미 없는 로봇 단독 이미지 반복",
    "독고탁 에이젼시와 무관한 팀 회의나 추상 AI 화면",
    "이미지 안에 깨진 한글, 내부 제작 단계명, 영어 라벨 노출",
    "상세페이지처럼 많은 정보 박스와 문장을 한 장면에 넣는 구성",
  ];

  return {
    protagonist,
    customerProblem,
    emotionalFlow,
    turningPoint,
    solutionRole,
    cta,
    mustShow,
    avoid,
  };
}

function findManualLineIndex(scriptLines: string[], patterns: RegExp[]) {
  return scriptLines.findIndex((line) =>
    patterns.some((pattern) => pattern.test(line)),
  );
}

function buildManualBeatScenes(options: {
  scriptLines: string[];
  sceneVisuals: string[];
  storyboardRows: ManualStoryboardRow[];
  sceneCount: number;
  duration: string;
  interpretation: ManualScriptInterpretation;
}) {
  const { scriptLines, sceneVisuals, storyboardRows, sceneCount, interpretation } =
    options;
  const seconds = getDurationSeconds(options.duration);
  const secondsPerScene =
    sceneCount > 0 ? Math.max(1, seconds / sceneCount) : seconds;
  const hasExplicitVisuals = sceneVisuals.length > 0 || storyboardRows.length > 0;
  const usedLineIndexes = new Set<number>();
  const getLineByPatterns = (patterns: RegExp[], fallbackIndex: number) => {
    const matchedIndex = findManualLineIndex(scriptLines, patterns);
    const index =
      matchedIndex !== -1
        ? matchedIndex
        : Math.min(scriptLines.length - 1, Math.max(0, fallbackIndex));
    usedLineIndexes.add(index);
    return scriptLines[index] ?? "";
  };
  const makeTime = (index: number) => {
    const start = Math.round(index * secondsPerScene);
    const end =
      index === sceneCount - 1
        ? seconds
        : Math.round((index + 1) * secondsPerScene);

    return `${start}-${end}초`;
  };

  if (hasExplicitVisuals) {
    return Array.from({ length: sceneCount }, (_, index): ManualSceneRow => {
      const row = storyboardRows[index];
      const narration =
        row?.narration ||
        scriptLines[index] ||
        scriptLines[scriptLines.length - 1] ||
        "";
      const caption =
        row?.caption ||
        scriptLines[index] ||
        scriptLines[scriptLines.length - 1] ||
        "";
      const visual =
        sceneVisuals[index] ||
        row?.visual ||
        `대본 "${normalizeCaption(narration)}"의 감정과 상황이 바로 보이는 단일 장면`;
      const sub = scriptLines[index + 1] || narration || caption;

      return {
        time: row?.time || makeTime(index),
        role: `${index + 1}번째 사용자 지정 장면`,
        visual,
        narration,
        caption,
        mainCopy: normalizeCaption(caption || narration),
        subCopy: normalizeCaption(sub),
        reason: "사용자가 지정한 화면 지시를 우선 반영한다.",
      };
    });
  }

  const lineAt = (index: number) =>
    scriptLines[Math.min(scriptLines.length - 1, Math.max(0, index))] ?? "";
  const beats = [
    {
      role: "주인공 소개",
      narration: getLineByPatterns(
        [/CEO|대표|사장|창업자|나홀로|혼자|여성|남성/],
        0,
      ),
      visual: `${interpretation.protagonist}가 혼자 일하는 첫 장면. 노트북, 제품 샘플, 작업 노트가 보이고 표정에는 시작의 긴장감이 있다.`,
      reason: "누가 이 이야기를 겪는지 첫 2초 안에 보여준다.",
    },
    {
      role: "핵심 문제",
      narration: getLineByPatterns([/막막|콘텐츠|제품보다|제일|문제/], 1),
      visual:
        "제품보다 콘텐츠가 더 막막한 상황. 빈 상세페이지 화면, 촬영해야 할 제품, 열려 있는 편집 툴을 한 공간에 배치한다.",
      reason: "대본의 진짜 갈등인 콘텐츠 제작 부담을 명확히 만든다.",
    },
    {
      role: "업무 과부하",
      narration: getLineByPatterns(
        [/상세페이지|대표이미지|카드뉴스|광고 문구|직접 써야/],
        2,
      ),
      visual:
        "상세페이지, 대표이미지, 카드뉴스, 광고 문구 작업이 동시에 쌓인 책상과 모니터. 정보는 많지만 화면은 한 장의 광고 스틸처럼 정돈한다.",
      reason: "고객이 왜 시간이 부족한지 구체적인 업무 목록으로 보여준다.",
    },
    {
      role: "시간 부족과 좌절",
      narration: getLineByPatterns([/좋은 제품|보여주는 방법|시간이 부족|몰라/], 3),
      visual:
        "좋은 제품은 책상 위에 있지만 보여주는 방법을 몰라 멈춰 있는 장면. 인물은 고민하고, 제품은 선명하게 보인다.",
      reason: "좋은 제품이 있어도 콘텐츠가 없으면 팔리지 않는 문제를 시각화한다.",
    },
    {
      role: "해결책 등장",
      narration: getLineByPatterns([/그러다|독고탁|에이젼시|만났/], 4),
      visual:
        "어두운 작업 화면에서 독고탁 에이젼시 대시보드가 켜지는 전환 장면. 서비스가 희망의 전환점처럼 보인다.",
      reason: "문제에서 해결책으로 넘어가는 감정의 전환점을 만든다.",
    },
    {
      role: "작동 방식",
      narration: getLineByPatterns([/제품 사진|AI|로봇|로보트|한 번에|정리/], 5),
      visual:
        "제품 사진을 업로드하자 AI 로봇/자동화 화면이 상세페이지, 대표이미지, 카드뉴스, 판매 포인트를 정리하는 장면.",
      reason: "서비스가 무엇을 해주는지 한 장면 안에서 이해시킨다.",
    },
    {
      role: "결과와 안도감",
      narration: getLineByPatterns([/혼자가 아닙|혼자 창업|이제는|아닙니다/], 6),
      visual:
        "완성된 콘텐츠 결과물을 보며 여성 CEO가 안도하고 자신감을 되찾는 장면. 따뜻한 빛과 정돈된 화면을 사용한다.",
      reason: "기능 설명을 넘어 사용자가 얻게 되는 감정적 결과를 보여준다.",
    },
    {
      role: "행동 유도",
      narration: getLineByPatterns([/나홀로|시작해보세요|댓글|사이트|DM|무료|선착순/], 7),
      visual:
        "쇼츠 엔딩용 CTA 장면. 스마트폰 댓글창, DM 사용가이드, 선착순 무료 이용 메시지를 상징적으로 보여주되 이미지 안에는 글자를 직접 만들지 않는다.",
      reason: "시청자가 바로 댓글 행동으로 넘어가도록 마지막 장면을 설계한다.",
    },
  ];

  const fallbackLines = scriptLines.filter((_, index) => !usedLineIndexes.has(index));
  return Array.from({ length: sceneCount }, (_, index): ManualSceneRow => {
    const beat = beats[index] ?? {
      role: `${index + 1}번째 보강 장면`,
      narration: fallbackLines[index - beats.length] ?? lineAt(index),
      visual: `${interpretation.protagonist}의 문제 해결 여정을 보강하는 프리미엄 카드뉴스 광고 장면`,
      reason: "대본 호흡을 영상 길이에 맞게 보강한다.",
    };
    const nextNarration =
      beats[index + 1]?.narration ||
      fallbackLines[index - beats.length + 1] ||
      beat.narration;

    return {
      time: makeTime(index),
      role: beat.role,
      visual: beat.visual,
      narration: beat.narration,
      caption: beat.narration,
      mainCopy: normalizeCaption(beat.narration),
      subCopy: normalizeCaption(nextNarration),
      reason: beat.reason,
    };
  });
}

function extractExplicitSceneCopies(plan: string): SceneCopy[] {
  const lines = plan.split(/\n+/);
  const startIndex = lines.findIndex((line) => {
    const lower = line.toLowerCase();
    return (
      lower.includes("scene copy") ||
      line.includes("장면별 자막 카피") ||
      line.includes("장면별 소리 멘트/이미지 카피")
    );
  });
  const nextLines = startIndex === -1 ? lines : lines.slice(startIndex + 1);
  const nextSectionIndex =
    startIndex === -1 ? -1 : nextLines.findIndex((line) => /^\s*\d+\./.test(line));
  const sourceLines =
    nextSectionIndex === -1 ? nextLines : nextLines.slice(0, nextSectionIndex);

  return sourceLines
    .map((line) => {
      if (startIndex !== -1 && /^\s*\d+\./.test(line)) {
        return null;
      }

      if (!/(?:^|\s)(?:-\s*)?(?:Scene\s*\d{1,2}|\d{1,2}\s*컷)/i.test(line)) {
        return null;
      }

      const main = line.match(/(?:main|메인)\s*=\s*([^/|]+)/i)?.[1] ?? "";
      const sub = line.match(/(?:sub|보조)\s*=\s*([^/|]+)/i)?.[1] ?? "";
      const fallback = cleanLine(
        line.replace(
          /(?:^|\s)(?:-\s*)?(?:Scene\s*\d{1,2}|\d{1,2}\s*컷)\s*[:：-]?/i,
          "",
        ),
      );

      return {
        main: normalizeCaption(main || fallback),
        sub: normalizeCaption(sub),
      };
    })
    .filter((copy): copy is SceneCopy => Boolean(copy?.main));
}

function buildManualProductionPlan(options: {
  script: string;
  duration: string;
  voiceGender: VoiceGenderId;
  voiceStyle: string;
  videoFormat: VideoFormatId;
  includeIntroImage: boolean;
}) {
  const scriptLines = splitManualScriptLines(options.script);
  const storyboardRows = extractManualStoryboardRows(options.script);
  const sceneVisuals = extractManualSceneVisuals(options.script);
  const styleDirections = extractManualStyleDirections(options.script);
  const brandMoodRules = extractBrandMoodRules(options.script);
  const sceneCount = getManualSceneCount(
    scriptLines,
    options.duration,
    sceneVisuals.length,
  );
  const interpretation = buildManualScriptInterpretation(scriptLines);
  const seconds = getDurationSeconds(options.duration);
  const secondsPerLine =
    scriptLines.length > 0 ? Math.max(1, seconds / scriptLines.length) : seconds;
  const sceneRows = buildManualBeatScenes({
    scriptLines,
    sceneVisuals,
    storyboardRows,
    sceneCount,
    duration: options.duration,
    interpretation,
  });
  const stylePlan =
    styleDirections.length > 0
      ? styleDirections
      : [
          "감정 흐름은 초반의 현실감에서 후반의 희망과 결심으로 상승시킨다.",
          "각 장면은 한 장의 단일 시네마틱 이미지로 만들고 콜라쥬처럼 구성하지 않는다.",
          "한글 문구는 이미지 안에 직접 만들지 않고 최종 영상에서 한글 폰트로 합성한다.",
        ];
  const brandRules =
    brandMoodRules.length > 0
      ? brandMoodRules
      : ["실제 브랜드 로고, 상표, 캐릭터, 패키지 디자인은 임의로 만들지 않는다."];
  const intention =
    `${interpretation.protagonist}가 ${interpretation.customerProblem}을 겪다가 ${interpretation.solutionRole}로 해결되는 흐름` ||
    scriptLines[0] ||
    "사용자가 입력한 대본의 핵심 감정과 메시지를 쇼츠 영상으로 전달한다.";
  const introMain = normalizeIntroCaption(
    sceneRows[0]?.mainCopy || scriptLines[0],
    "지금 멈춰볼 순간",
    18,
  );
  const introSub = normalizeIntroCaption(
    sceneRows[0]?.subCopy || interpretation.customerProblem,
    "첫 장면에서 바로 이유를 보여줍니다.",
    28,
  );
  const timeline = scriptLines.map((line, index) => {
    const start = Math.round(index * secondsPerLine);
    const end = Math.round((index + 1) * secondsPerLine);

    return `- ${index + 1}컷 ${start}-${end}초: ${line}`;
  });

  return [
    "제작 기준: 사용자 직접 대본",
    `이미지 장면 수: ${sceneCount}`,
    `인트로 후킹 이미지: ${options.includeIntroImage ? "사용" : "미사용"}`,
    "",
    "0. 독고탁 스튜디오 제작 철학",
    ...dokgotakProductionPhilosophy.map((line) => `- ${line}`),
    "",
    "1. 대본 해석 리포트",
    `- 주인공: ${interpretation.protagonist}`,
    `- 고객 문제: ${interpretation.customerProblem}`,
    `- 감정 흐름: ${interpretation.emotionalFlow}`,
    `- 핵심 전환점: ${interpretation.turningPoint}`,
    `- 해결책 역할: ${interpretation.solutionRole}`,
    `- CTA: ${interpretation.cta}`,
    "- 영상에서 반드시 보여줄 것:",
    ...interpretation.mustShow.map((line) => `  - ${line}`),
    "- 만들면 안 되는 것:",
    ...interpretation.avoid.map((line) => `  - ${line}`),
    "",
    "2. 광고 전략 재구성",
    `- 영상 길이: ${options.duration}`,
    `- 영상 비율: ${getVideoFormat(options.videoFormat).label}`,
    `- 성별/음색: ${getVoiceGender(options.voiceGender).label}`,
    `- 말투: ${options.voiceStyle}`,
    `- 핵심 의도: ${intention}`,
    "- 30초 광고 구조: 주인공 소개 → 문제 공감 → 고통 구체화 → 해결책 등장 → 작동 방식 → 결과와 안도감 → 댓글 CTA",
    "- 장면 설계 원칙: 같은 사무실 인물 사진을 반복하지 않고, 각 컷마다 문제와 해결의 역할을 다르게 부여한다.",
    "- 제목 후보와 스타일 메모는 참고만 하고 실제 영상 문구로 섞지 않는다.",
    "",
    "3. 최종 나레이션 원문",
    ...scriptLines.map((line) => `- ${line}`),
    "",
    "4. 장면별 화면 설계",
    ...sceneRows.map(
      (scene, index) =>
        `- ${index + 1}컷 ${scene.role}: ${scene.visual} / 이유=${scene.reason}`,
    ),
    "",
    "5. 장면별 제작표",
    ...sceneRows.map(
      (scene, index) =>
        `- ${index + 1}컷 | ${scene.time} | 역할=${scene.role} | 화면=${scene.visual} | 나레이션=${scene.narration} | 자막=${scene.caption}`,
    ),
    "",
    "6. 장면별 자막 카피",
    ...sceneRows.map(
      (scene, index) =>
        `- ${index + 1}컷: 메인=${scene.mainCopy} / 보조=${scene.subCopy}`,
    ),
    "",
    "7. 인트로 후킹 카피",
    options.includeIntroImage
      ? `- 인트로: 메인=${introMain} / 보조=${introSub}`
      : "- 인트로: 사용하지 않음",
    "",
    "8. 인트로 이미지 생성 지시",
    options.includeIntroImage
      ? `- 인트로: 메시지=${introMain} / 주인공과 장면=${sceneRows[0]?.visual || intention} / 배경=대본의 가장 강한 고민이나 욕망이 첫 1초에 보이는 실제 장소 / 조명=강한 대비와 깊이감 있는 프리미엄 조명 / 구도=첫 장면에서 스크롤을 멈추게 하는 단일 시네마틱 광고 컷 / 여백=한글 자막 합성 공간 확보 / 금지=콜라쥬, 이미지 속 글자, 내부 제작 용어`
      : "- 인트로: 사용하지 않음",
    "",
    "9. 이미지 생성 지시서",
    ...dokgotakCardNewsImagePhilosophy.map(
      (line) => `- 카드뉴스 기준: ${line}`,
    ),
    ...sceneRows.map(
      (scene, index) =>
        `- ${index + 1}컷: 메시지=${scene.mainCopy} / 주인공과 장면=${scene.visual} / 배경=대본 맥락에 맞는 실제 장소 / 조명=${index < Math.ceil(sceneRows.length / 2) ? "막막함이 느껴지는 차분한 조명" : "해결과 안도감이 느껴지는 밝고 따뜻한 조명"} / 구도=모바일에서 바로 읽히는 프리미엄 카드뉴스 광고 컷 / 여백=한글 자막 합성 공간 확보 / 금지=콜라쥬, 이미지 속 글자, 반복 배경`,
    ),
    "",
    "10. 스타일 및 사운드 방향",
    ...stylePlan.map((line) => `- ${line}`),
    "",
    "11. 브랜드/무드 사용 규칙",
    ...brandRules.map((line) => `- ${line}`),
    "",
    "12. 금지 규칙",
    "- 내부 단계명, 제작 메모, 영어 라벨은 최종 영상 화면에 표시하지 않는다.",
    "- 이미지 안에 한글, 영어, 숫자, 카피, 버튼, 가격표, 설명 박스를 만들지 않는다.",
    "- 사용자가 쓰지 않은 효능, 인증, 가격, 수상, 리뷰, 실제 브랜드 로고를 만들지 않는다.",
    "- 한 장면에 여러 사진을 붙인 콜라쥬, 분할 화면, 상세페이지 캡처형 구성을 만들지 않는다.",
    "",
    "13. 최종 렌더 지시",
    "- 앱의 한글 폰트로 메인 카피와 보조 카피를 영상 위에 합성한다.",
    "- 자막은 최대 2줄로 제한하고, 장면 속 주인공과 제품을 가리지 않는다.",
    "- 장면마다 배경, 카메라 거리, 조명, 인물 포즈가 반복되지 않게 구성한다.",
    "",
    "14. 시간 배치 참고",
    ...timeline,
  ].join("\n");
}

function extractCustomerCaptionLines(plan: string) {
  const lines = plan.split(/\n+/);
  const collected: string[] = [];

  for (const rawLine of lines) {
    const line = cleanLine(rawLine)
      .replace(/^\d+\s*(?:컷|장면|scene)?\s*[:：-]?\s*/i, "")
      .replace(/^(후킹|문제 공감|해결|혜택|신뢰|CTA|구매 유도)\s*[:：-]?\s*/i, "")
      .trim();

    if (!line || isInternalLine(line)) {
      continue;
    }

    collected.push(line);
  }

  return collected.map(normalizeCaption).filter(Boolean);
}

function buildRenderScenes(plan: string) {
  const explicitCopies = extractExplicitSceneCopies(plan);

  if (explicitCopies.length > 0) {
    return explicitCopies.map((copy) => ({
      caption: normalizeCaption(copy.main),
    }));
  }

  const customerCaptions = extractCustomerCaptionLines(plan);
  const preferredLines = plan
    .split(/\n+/)
    .map(cleanLine)
    .filter((line) => {
      if (isInternalLine(line)) {
        return false;
      }

      if (line.length < 8 || line.length > 48) {
        return false;
      }

      return /[가-힣]/.test(line);
    });

  const fallbackLines = [
    "준비가 번거롭게 느껴지시나요?",
    "필요한 걸 따로 고르기 어렵나요?",
    "한 번에 정리된 구성으로 준비하세요.",
    "시간은 줄이고 분위기는 고급스럽게.",
    "이미지와 구성 특징을 기준으로 보여드려요.",
    "지금 상세페이지에서 바로 확인해보세요.",
  ];

  const pool =
    customerCaptions.length >= 6
      ? customerCaptions
      : preferredLines.length >= 4
        ? preferredLines
        : fallbackLines;

  return Array.from({ length: 6 }, (_, index) => ({
    caption: normalizeCaption(pool[index % pool.length] ?? fallbackLines[index]),
  }));
}

function buildSceneCopies(plan: string): SceneCopy[] {
  const explicitCopies = extractExplicitSceneCopies(plan);

  if (explicitCopies.length > 0) {
    return explicitCopies;
  }

  const renderScenes = buildRenderScenes(plan);
  const fallbackSubs = [
    "고객의 고민을 첫 장면으로 보여줍니다.",
    "불편한 상황을 짧고 선명하게 전달합니다.",
    "제품이 돕는 방식을 바로 보여줍니다.",
    "작은 변화가 만족을 만듭니다.",
    "확인 가능한 특징만 담았습니다.",
    "내 상황에 맞는지 확인해보세요.",
  ];

  return Array.from({ length: 6 }, (_, index) => ({
    main: renderScenes[index]?.caption || "고객을 멈추는 첫 장면",
    sub: fallbackSubs[index] ?? "고객의 고민을 첫 장면으로 보여줍니다.",
  }));
}

function splitCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
) {
  const source = text.trim();
  const tokens = source.includes(" ") ? source.split(/\s+/) : Array.from(source);
  const lines: string[] = [];
  let currentLine = "";

  for (const token of tokens) {
    const separator = source.includes(" ") ? " " : "";
    const nextLine = currentLine ? `${currentLine}${separator}${token}` : token;

    if (context.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = token;

    if (lines.length === maxLines) {
      break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  return lines;
}

function fitCanvasText(options: {
  context: CanvasRenderingContext2D;
  text: string;
  maxWidth: number;
  maxLines: number;
  maxFontSize: number;
  minFontSize: number;
  weight: number;
}) {
  const { context, text, maxWidth, maxLines, maxFontSize, minFontSize, weight } =
    options;

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 2) {
    context.font = `${weight} ${fontSize}px Pretendard, "Gmarket Sans", "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
    const lines = splitCanvasText(context, text, maxWidth, maxLines);
    const isWithinWidth = lines.every(
      (line) => context.measureText(line).width <= maxWidth,
    );

    if (isWithinWidth && lines.length <= maxLines) {
      return {
        fontSize,
        lineHeight: Math.round(fontSize * 1.18),
        lines,
      };
    }
  }

  context.font = `${weight} ${minFontSize}px Pretendard, "Gmarket Sans", "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
  return {
    fontSize: minFontSize,
    lineHeight: Math.round(minFontSize * 1.18),
    lines: splitCanvasText(context, text, maxWidth, maxLines),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value: number) {
  const progress = clamp(value, 0, 1);
  return 1 - (1 - progress) ** 3;
}

function easeInOutCubic(value: number) {
  const progress = clamp(value, 0, 1);
  return progress < 0.5
    ? 4 * progress ** 3
    : 1 - (-2 * progress + 2) ** 3 / 2;
}

function getTextRegion(
  width: number,
  height: number,
  position: TextPosition,
  isVertical: boolean,
) {
  if (isVertical) {
    return position === "top"
      ? { x: 0, y: 0, width, height: Math.round(height * 0.38) }
      : {
          x: 0,
          y: Math.round(height * 0.6),
          width,
          height: Math.round(height * 0.4),
        };
  }

  if (position === "right") {
    return {
      x: Math.round(width * 0.52),
      y: 0,
      width: Math.round(width * 0.48),
      height,
    };
  }

  if (position === "top") {
    return { x: 0, y: 0, width, height: Math.round(height * 0.38) };
  }

  if (position === "bottom") {
    return {
      x: 0,
      y: Math.round(height * 0.62),
      width,
      height: Math.round(height * 0.38),
    };
  }

  return { x: 0, y: 0, width: Math.round(width * 0.48), height };
}

function sampleRegionLuminance(
  context: CanvasRenderingContext2D,
  region: { x: number; y: number; width: number; height: number },
) {
  try {
    const sampleWidth = Math.max(1, Math.min(32, region.width));
    const sampleHeight = Math.max(1, Math.min(32, region.height));
    const sampleX = clamp(
      Math.round(region.x + region.width / 2 - sampleWidth / 2),
      0,
      context.canvas.width - sampleWidth,
    );
    const sampleY = clamp(
      Math.round(region.y + region.height / 2 - sampleHeight / 2),
      0,
      context.canvas.height - sampleHeight,
    );
    const imageData = context.getImageData(
      sampleX,
      sampleY,
      sampleWidth,
      sampleHeight,
    );
    const { data } = imageData;
    let luminanceTotal = 0;

    for (let index = 0; index < data.length; index += 4) {
      luminanceTotal +=
        data[index] * 0.299 +
        data[index + 1] * 0.587 +
        data[index + 2] * 0.114;
    }

    return luminanceTotal / (data.length / 4);
  } catch {
    return 96;
  }
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function createCardNewsPalette(luminance: number) {
  if (luminance >= 150) {
    return {
      mode: "light",
      main: "#071b3d",
      sub: "#ffffff",
      accentBackground: "#1f6fff",
      shadow: "rgba(255,255,255,0.46)",
      overlayStart: "rgba(255,255,255,0.86)",
      overlayMid: "rgba(255,255,255,0.52)",
      overlayEnd: "rgba(255,255,255,0)",
    };
  }

  if (luminance >= 102) {
    return {
      mode: "mixed",
      main: "#ffffff",
      sub: "#071b3d",
      accentBackground: "#ffcf3f",
      shadow: "rgba(0,0,0,0.58)",
      overlayStart: "rgba(0,0,0,0.7)",
      overlayMid: "rgba(0,0,0,0.34)",
      overlayEnd: "rgba(0,0,0,0)",
    };
  }

  return {
    mode: "dark",
    main: "#ffffff",
    sub: "#f7d76f",
    accentBackground: "",
    shadow: "rgba(0,0,0,0.62)",
    overlayStart: "rgba(0,0,0,0.82)",
    overlayMid: "rgba(0,0,0,0.42)",
    overlayEnd: "rgba(0,0,0,0)",
  };
}

function drawCardNewsCopy(options: {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  copy: SceneCopy;
  formatId: VideoFormatId;
  position?: TextPosition;
  animationProgress?: number;
}) {
  const { context, width, height, copy, formatId } = options;
  const isVertical = formatId === "vertical";
  const requestedPosition = options.position ?? (isVertical ? "bottom" : "left");
  const position: TextPosition =
    isVertical &&
    (requestedPosition === "left" || requestedPosition === "right")
      ? "bottom"
      : requestedPosition;
  const safeMargin = isVertical ? 56 : 78;
  const isHorizontalBand =
    !isVertical && (position === "top" || position === "bottom");
  const maxWidth =
    isVertical || isHorizontalBand
      ? width - safeMargin * 2
      : Math.round(width * 0.46);
  const x =
    !isVertical && position === "right"
      ? width - safeMargin - maxWidth
      : safeMargin;
  const mainMaxSize = isVertical ? 74 : 62;
  const mainMinSize = isVertical ? 40 : 34;
  const subMaxSize = isVertical ? 30 : 28;
  const subMinSize = isVertical ? 22 : 20;
  const mainText = copy.main || "고객을 멈추는 첫 장면";
  const subText = copy.sub || "고객의 고민을 첫 장면으로 보여줍니다.";
  const animation = easeOutCubic(options.animationProgress ?? 1);
  const textRegion = getTextRegion(width, height, position, isVertical);
  const luminance = sampleRegionLuminance(context, textRegion);
  const palette = createCardNewsPalette(luminance);

  context.save();

  if (isVertical && position === "top") {
    const overlay = context.createLinearGradient(0, 0, 0, height * 0.46);
    overlay.addColorStop(0, palette.overlayStart);
    overlay.addColorStop(0.58, palette.overlayMid);
    overlay.addColorStop(1, palette.overlayEnd);
    context.fillStyle = overlay;
    context.fillRect(0, 0, width, Math.round(height * 0.46));
  } else if (isVertical) {
    const overlay = context.createLinearGradient(0, height * 0.48, 0, height);
    overlay.addColorStop(0, palette.overlayEnd);
    overlay.addColorStop(0.38, palette.overlayMid);
    overlay.addColorStop(1, palette.overlayStart);
    context.fillStyle = overlay;
    context.fillRect(0, Math.round(height * 0.45), width, Math.round(height * 0.55));
  } else if (position === "right") {
    const overlay = context.createLinearGradient(width, 0, width * 0.42, 0);
    overlay.addColorStop(0, palette.overlayStart);
    overlay.addColorStop(0.72, palette.overlayMid);
    overlay.addColorStop(1, palette.overlayEnd);
    context.fillStyle = overlay;
    context.fillRect(Math.round(width * 0.36), 0, Math.round(width * 0.64), height);
  } else if (position === "top") {
    const overlay = context.createLinearGradient(0, 0, 0, height * 0.46);
    overlay.addColorStop(0, palette.overlayStart);
    overlay.addColorStop(0.68, palette.overlayMid);
    overlay.addColorStop(1, palette.overlayEnd);
    context.fillStyle = overlay;
    context.fillRect(0, 0, width, Math.round(height * 0.46));
  } else if (position === "bottom") {
    const overlay = context.createLinearGradient(0, height * 0.54, 0, height);
    overlay.addColorStop(0, palette.overlayEnd);
    overlay.addColorStop(0.42, palette.overlayMid);
    overlay.addColorStop(1, palette.overlayStart);
    context.fillStyle = overlay;
    context.fillRect(0, Math.round(height * 0.5), width, Math.round(height * 0.5));
  } else {
    const overlay = context.createLinearGradient(0, 0, width * 0.58, 0);
    overlay.addColorStop(0, palette.overlayStart);
    overlay.addColorStop(0.72, palette.overlayMid);
    overlay.addColorStop(1, palette.overlayEnd);
    context.fillStyle = overlay;
    context.fillRect(0, 0, Math.round(width * 0.64), height);
  }

  const mainBlock = fitCanvasText({
    context,
    text: mainText,
    maxWidth,
    maxLines: 2,
    maxFontSize: mainMaxSize,
    minFontSize: mainMinSize,
    weight: 900,
  });
  const subBlock = fitCanvasText({
    context,
    text: subText,
    maxWidth,
    maxLines: 2,
    maxFontSize: subMaxSize,
    minFontSize: subMinSize,
    weight: 800,
  });
  const totalTextHeight =
    mainBlock.lines.length * mainBlock.lineHeight +
    28 +
    subBlock.lines.length * subBlock.lineHeight;
  const yStart = (() => {
    if (position === "top") {
      return safeMargin;
    }

    if (position === "bottom") {
      return Math.max(
        safeMargin,
        isVertical
          ? Math.min(
              height - safeMargin - totalTextHeight,
              Math.round(height * 0.66),
            )
          : height - safeMargin - totalTextHeight,
      );
    }

    return Math.max(
      safeMargin,
      Math.round((height - totalTextHeight) * 0.56),
    );
  })() + Math.round((1 - animation) * 22);

  context.textBaseline = "top";
  context.globalAlpha *= animation;
  context.shadowColor = palette.shadow;
  context.shadowBlur = palette.mode === "light" ? 4 : 18;
  context.shadowOffsetY = palette.mode === "light" ? 1 : 4;

  context.fillStyle = palette.main;
  context.font = `900 ${mainBlock.fontSize}px Pretendard, "Gmarket Sans", "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
  mainBlock.lines.forEach((line, index) => {
    context.fillText(line, x, yStart + index * mainBlock.lineHeight);
  });

  context.shadowBlur = 10;
  context.font = `800 ${subBlock.fontSize}px Pretendard, "Gmarket Sans", "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
  const subY = yStart + mainBlock.lines.length * mainBlock.lineHeight + 28;
  if (palette.accentBackground) {
    const subWidths = subBlock.lines.map((line) => context.measureText(line).width);
    const pillWidth = Math.min(maxWidth, Math.max(...subWidths, 1) + 34);
    const pillHeight = subBlock.lines.length * subBlock.lineHeight + 18;

    context.shadowBlur = 14;
    context.shadowColor =
      palette.mode === "light" ? "rgba(31,111,255,0.24)" : "rgba(0,0,0,0.35)";
    context.fillStyle = palette.accentBackground;
    drawRoundedRect(
      context,
      x - 14,
      subY - 9,
      pillWidth,
      pillHeight,
      Math.round(pillHeight * 0.32),
    );
    context.fill();
    context.shadowBlur = 0;
  }

  context.fillStyle = palette.sub;
  subBlock.lines.forEach((line, index) => {
    context.fillText(line, x, subY + index * subBlock.lineHeight);
  });

  context.restore();
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  width: number,
  height: number,
  motionProgress = 1,
) {
  const zoom = 1.018 + easeOutCubic(motionProgress) * 0.035;
  const scale = Math.max(width / image.width, height / image.height) * zoom;
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const x = (width - scaledWidth) / 2;
  const y = (height - scaledHeight) / 2;

  context.drawImage(image, x, y, scaledWidth, scaledHeight);
}

function drawScene(options: {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  image?: ImageBitmap;
  copy: SceneCopy;
  formatId: VideoFormatId;
  position?: TextPosition;
  sceneProgress?: number;
}) {
  const { canvas, context, image, copy, formatId, position } = options;
  const { width, height } = canvas;
  const sceneProgress = clamp(options.sceneProgress ?? 1, 0, 1);

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#101010");
  gradient.addColorStop(1, "#1b1b1b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  if (image) {
    drawCoverImage(context, image, width, height, sceneProgress);
  }

  drawCardNewsCopy({
    context,
    width,
    height,
    copy,
    formatId,
    position,
    animationProgress: sceneProgress,
  });
}

function getPreviewCopyClass(
  position: TextPosition | undefined,
  formatId: VideoFormatId,
) {
  const resolved = position ?? (formatId === "horizontal" ? "left" : "bottom");

  if (formatId === "vertical" && resolved === "top") {
    return "dokgotak-cardnews-copy absolute inset-x-0 top-0 bg-gradient-to-b from-black/82 via-black/42 to-transparent px-4 pb-12 pt-4";
  }

  if (formatId === "horizontal" && resolved === "right") {
    return "dokgotak-cardnews-copy absolute inset-y-0 right-0 flex w-[66%] flex-col justify-center bg-gradient-to-l from-black/82 via-black/44 to-transparent px-4 py-4";
  }

  if (formatId === "horizontal" && resolved === "top") {
    return "dokgotak-cardnews-copy absolute inset-x-0 top-0 bg-gradient-to-b from-black/82 via-black/44 to-transparent px-4 pb-12 pt-4";
  }

  if (formatId === "horizontal" && resolved === "bottom") {
    return "dokgotak-cardnews-copy absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 via-black/44 to-transparent px-4 pb-4 pt-12";
  }

  if (formatId === "horizontal") {
    return "dokgotak-cardnews-copy absolute inset-y-0 left-0 flex w-[66%] flex-col justify-center bg-gradient-to-r from-black/82 via-black/44 to-transparent px-4 py-4";
  }

  return "dokgotak-cardnews-copy absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 via-black/44 to-transparent px-4 pb-4 pt-12";
}

function downloadTextFile(fileName: string, contents: string) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function dataUrlToBlob(dataUrl: string) {
  return fetch(dataUrl).then((response) => response.blob());
}

function readEbmlVint(bytes: Uint8Array, offset: number) {
  const firstByte = bytes[offset];
  if (firstByte === undefined) {
    return null;
  }

  let mask = 0x80;
  let length = 1;
  while (length <= 8 && (firstByte & mask) === 0) {
    mask >>= 1;
    length += 1;
  }

  if (length > 8 || offset + length > bytes.length) {
    return null;
  }

  let value = firstByte & (mask - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
  }

  return { length, value };
}

function readEbmlId(bytes: Uint8Array, offset: number) {
  const firstByte = bytes[offset];
  if (firstByte === undefined) {
    return null;
  }

  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (firstByte & mask) === 0) {
    mask >>= 1;
    length += 1;
  }

  if (length > 4 || offset + length > bytes.length) {
    return null;
  }

  let id = "";
  for (let index = 0; index < length; index += 1) {
    id += bytes[offset + index].toString(16).padStart(2, "0");
  }

  return { length, id };
}

function encodeEbmlVint(value: number) {
  for (let length = 1; length <= 8; length += 1) {
    const maxValue = 2 ** (7 * length) - 2;
    if (value <= maxValue) {
      const encoded = value + 2 ** (7 * length);
      const bytes = new Uint8Array(length);
      for (let index = length - 1; index >= 0; index -= 1) {
        bytes[index] = encoded >> (8 * (length - 1 - index));
      }
      return bytes;
    }
  }

  return new Uint8Array([0xff]);
}

function removeEbmlDuration(infoPayload: Uint8Array) {
  const chunks: Uint8Array[] = [];
  let offset = 0;

  while (offset < infoPayload.length) {
    const id = readEbmlId(infoPayload, offset);
    if (!id) {
      chunks.push(infoPayload.slice(offset));
      break;
    }

    const size = readEbmlVint(infoPayload, offset + id.length);
    if (!size) {
      chunks.push(infoPayload.slice(offset));
      break;
    }

    const elementStart = offset;
    const elementEnd = offset + id.length + size.length + size.value;
    if (elementEnd > infoPayload.length) {
      chunks.push(infoPayload.slice(offset));
      break;
    }

    if (id.id !== "4489") {
      chunks.push(infoPayload.slice(elementStart, elementEnd));
    }

    offset = elementEnd;
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let writeOffset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, writeOffset);
    writeOffset += chunk.length;
  });
  return output;
}

async function fixWebmDuration(blob: Blob, durationMs: number) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const infoId = new Uint8Array([0x15, 0x49, 0xa9, 0x66]);
  let infoOffset = -1;

  for (let offset = 0; offset <= bytes.length - infoId.length; offset += 1) {
    if (infoId.every((value, index) => bytes[offset + index] === value)) {
      infoOffset = offset;
      break;
    }
  }

  if (infoOffset === -1) {
    return blob;
  }

  const size = readEbmlVint(bytes, infoOffset + infoId.length);
  if (!size) {
    return blob;
  }

  const payloadStart = infoOffset + infoId.length + size.length;
  const payloadEnd = payloadStart + size.value;
  if (payloadEnd > bytes.length) {
    return blob;
  }

  const durationBytes = new Uint8Array(11);
  durationBytes.set([0x44, 0x89, 0x88], 0);
  new DataView(durationBytes.buffer).setFloat64(3, durationMs, false);

  const originalPayload = bytes.slice(payloadStart, payloadEnd);
  const cleanedPayload = removeEbmlDuration(originalPayload);
  const nextPayload = new Uint8Array(cleanedPayload.length + durationBytes.length);
  nextPayload.set(cleanedPayload, 0);
  nextPayload.set(durationBytes, cleanedPayload.length);

  const nextInfoSize = encodeEbmlVint(nextPayload.length);
  const nextInfo = new Uint8Array(infoId.length + nextInfoSize.length + nextPayload.length);
  nextInfo.set(infoId, 0);
  nextInfo.set(nextInfoSize, infoId.length);
  nextInfo.set(nextPayload, infoId.length + nextInfoSize.length);

  return new Blob(
    [bytes.slice(0, infoOffset), nextInfo, bytes.slice(payloadEnd)],
    { type: blob.type },
  );
}

function extractNarrationText(plan: string) {
  const lines = plan.split(/\n+/);
  const startIndex = lines.findIndex(
    (line) =>
      line.includes("최종 나레이션 원문") ||
      line.includes("나레이션 원문") ||
      line.includes("Typecast"),
  );

  if (startIndex === -1) {
    return buildRenderScenes(plan)
      .map((scene) => scene.caption)
      .join("\n");
  }

  const collected: string[] = [];

  for (const line of lines.slice(startIndex + 1)) {
    if (
      /^\s*\d+\./.test(line) ||
      line.includes("장면별 화면 설계") ||
      line.includes("편집 체크리스트")
    ) {
      break;
    }

    const cleaned = cleanLine(line);
    if (cleaned) {
      collected.push(cleaned);
    }
  }

  return (collected.length > 0 ? collected : lines.slice(startIndex + 1))
    .join("\n")
    .trim();
}

export default function VideoProductionPanel({
  analysisResult,
  sourceFiles,
  initialDuration = durations[0],
  initialVideoFormat = "vertical",
  initialScriptMode = "ai",
  initialManualScript = "",
}: {
  analysisResult: string;
  sourceFiles: File[];
  initialDuration?: string;
  initialVideoFormat?: VideoFormatId;
  initialScriptMode?: ScriptModeId;
  initialManualScript?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scriptMode, setScriptMode] =
    useState<ScriptModeId>(initialScriptMode);
  const [scriptType, setScriptType] = useState(scriptTypes[0]);
  const [manualScript, setManualScript] = useState(initialManualScript);
  const duration = initialDuration;
  const [voiceGender, setVoiceGender] = useState<VoiceGenderId>("female");
  const [voiceStyle, setVoiceStyle] = useState(voiceStyles[0]);
  const videoFormat = initialVideoFormat;
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [includeVoice, setIncludeVoice] = useState(false);
  const [includeIntroImage, setIncludeIntroImage] = useState(true);
  const [renderProgress, setRenderProgress] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoFileExtension, setVideoFileExtension] = useState("webm");
  const [imageProgress, setImageProgress] =
    useState<ImageGenerationProgress | null>(null);
  const [generatedSceneImages, setGeneratedSceneImages] = useState<
    GeneratedSceneImage[]
  >([]);
  const [sceneImageReviews, setSceneImageReviews] = useState<
    SceneImageReview[]
  >([]);
  const [sceneImageReviewSummary, setSceneImageReviewSummary] = useState("");
  const [isReviewingImages, setIsReviewingImages] = useState(false);
  const [regeneratingSceneIndex, setRegeneratingSceneIndex] = useState<
    number | null
  >(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "error";
    title: string;
    body: string;
  } | null>(null);
  const [productionPlan, setProductionPlan] = useState("");
  const selectedFormat = getVideoFormat(videoFormat);
  const manualScriptLines = splitManualScriptLines(manualScript);
  const manualSceneVisuals = extractManualSceneVisuals(manualScript);
  const manualStyleDirections = extractManualStyleDirections(manualScript);
  const manualSceneCount = getManualSceneCount(
    manualScriptLines,
    duration,
    manualSceneVisuals.length,
  );
  const isImageActionBusy =
    isGeneratingImages || isReviewingImages || regeneratingSceneIndex !== null;
  const getSceneImageReview = (sceneIndex: number) =>
    sceneImageReviews.find((review) => review.sceneIndex === sceneIndex);

  const updateImageProgress = (
    percent: number,
    label: string,
    detail: string,
    startedAt: number,
    estimatedSeconds: number,
  ) => {
    const elapsedSeconds = Math.floor(
      (getCurrentTimestampMs() - startedAt) / 1000,
    );

    setImageProgress((currentProgress) => ({
      percent: Math.min(
        100,
        Math.max(1, percent, currentProgress?.percent ?? 0),
      ),
      label,
      detail,
      elapsedSeconds,
      estimatedSeconds,
    }));
  };

  const startProduction = async () => {
    if (scriptMode === "manual") {
      if (manualScriptLines.length === 0) {
        setMessage({
          tone: "warning",
          title: "직접 대본이 필요합니다.",
          body: "영상에 사용할 한글 대본을 한 줄에 한 문장씩 입력해주세요.",
        });
        return;
      }

      const nextProductionPlan = buildManualProductionPlan({
        script: manualScript,
        duration,
        voiceGender,
        voiceStyle,
        videoFormat,
        includeIntroImage,
      });

      setProductionPlan(nextProductionPlan);
      setVideoUrl("");
      setGeneratedSceneImages([]);
      setSceneImageReviews([]);
      setSceneImageReviewSummary("");
      setImageProgress(null);
      setRenderProgress("");
      setMessage({
        tone: "success",
        title: "직접 대본 제작안이 준비됐습니다.",
        body: `${manualScriptLines.length}줄 대본을 ${manualSceneCount}개 본편 장면으로 배치했습니다.${
          includeIntroImage ? " 앞부분에는 강한 인트로 이미지를 추가합니다." : ""
        } 이제 제품 광고 이미지 생성과 Typecast 음성 포함 영상 제작을 진행할 수 있습니다.`,
      });
      return;
    }

    const openAiKey = getOpenAiKey();

    if (!openAiKey) {
      setMessage({
        tone: "warning",
        title: "OpenAI API 키가 필요합니다.",
        body: "우측 상단 API 설정에서 OpenAI API 키를 저장한 뒤 다시 시작해주세요.",
      });
      return;
    }

    setIsGenerating(true);
    setProductionPlan("");
    setGeneratedSceneImages([]);
    setSceneImageReviews([]);
    setSceneImageReviewSummary("");
    setMessage({
      tone: "success",
      title: "영상 제작안을 생성 중입니다.",
      body: "분석 결과를 컷 구성, 나레이션, 장면 이미지 지시서로 변환하고 있습니다.",
    });

    try {
      const response = await fetch("/api/production-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          openaiApiKey: openAiKey,
          analysis: analysisResult,
          scriptType,
          duration,
          voiceGender: getVoiceGender(voiceGender).label,
          voiceStyle,
          videoFormat,
          includeIntroImage,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        productionPlan?: string;
        message?: string;
      };

      if (!response.ok || !result.ok) {
        setMessage({
          tone: "error",
          title: "영상 제작안 생성에 실패했습니다.",
          body: result.message ?? "OpenAI 요청이 실패했습니다.",
        });
        return;
      }

      setProductionPlan(result.productionPlan ?? "");
      setVideoUrl("");
      setGeneratedSceneImages([]);
      setSceneImageReviews([]);
      setSceneImageReviewSummary("");
      setMessage({
        tone: "success",
        title: "영상 제작안이 준비됐습니다.",
        body: "아래 지시서를 기준으로 Typecast 음성, 장면 이미지, 편집 작업을 시작하면 됩니다.",
      });
    } catch {
      setMessage({
        tone: "error",
        title: "영상 제작안을 요청할 수 없습니다.",
        body: "로컬 서버 또는 네트워크 상태를 확인한 뒤 다시 시도해주세요.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const uploadSourceImageChunks = async (
    sessionId: string,
    progressStartedAt: number,
    progressEstimatedSeconds: number,
  ) => {
    const imageFiles = sourceFiles.filter((file) =>
      ["image/png", "image/jpeg", "image/webp"].includes(file.type),
    );
    const totalChunks = imageFiles.reduce(
      (sum, file) => sum + Math.ceil(file.size / uploadChunkSize),
      0,
    );
    let uploadedChunks = 0;

    if (totalChunks === 0) {
      updateImageProgress(
        20,
        "첨부 파일 확인 완료",
        "업로드할 제품 이미지 조각 없이 다음 단계로 넘어갑니다.",
        progressStartedAt,
        progressEstimatedSeconds,
      );
    }

    for (const file of imageFiles) {
      const fileTotalChunks = Math.ceil(file.size / uploadChunkSize);
      const fileId = `${file.name}-${file.size}-${file.lastModified}`;

      for (let chunkIndex = 0; chunkIndex < fileTotalChunks; chunkIndex += 1) {
        const start = chunkIndex * uploadChunkSize;
        const end = Math.min(start + uploadChunkSize, file.size);
        const formData = new FormData();

        formData.append("sessionId", sessionId);
        formData.append("fileId", fileId);
        formData.append("fileName", file.name);
        formData.append("fileType", file.type);
        formData.append("fileSize", String(file.size));
        formData.append("chunkIndex", String(chunkIndex));
        formData.append("totalChunks", String(fileTotalChunks));
        formData.append("chunk", file.slice(start, end, file.type), file.name);

        const response = await fetch("/api/upload-chunk", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error("제품 이미지 업로드 중 오류가 발생했습니다.");
        }

        uploadedChunks += 1;
        const uploadPercent = Math.min(
          20,
          5 + Math.round((uploadedChunks / totalChunks) * 15),
        );

        updateImageProgress(
          uploadPercent,
          "제품 이미지 업로드 중",
          `${uploadedChunks}/${totalChunks} 조각 업로드 완료`,
          progressStartedAt,
          progressEstimatedSeconds,
        );
        setRenderProgress(
          `제품 이미지 업로드 중 ${uploadedChunks}/${totalChunks} 조각 완료`,
        );
      }
    }

    return imageFiles.map((file) => ({
      fileId: `${file.name}-${file.size}-${file.lastModified}`,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      totalChunks: Math.ceil(file.size / uploadChunkSize),
    }));
  };

  const reviewGeneratedSceneImages = async (
    imagesToReview = generatedSceneImages,
  ) => {
    const openAiKey = getOpenAiKey();

    if (!openAiKey) {
      setMessage({
        tone: "warning",
        title: "OpenAI API 키가 필요합니다.",
        body: "이미지 검수를 위해 OpenAI API 키를 저장한 뒤 다시 시도해주세요.",
      });
      return;
    }

    if (!productionPlan) {
      setMessage({
        tone: "warning",
        title: "제작안이 필요합니다.",
        body: "먼저 영상 제작 지시서를 생성해주세요.",
      });
      return;
    }

    if (imagesToReview.length === 0) {
      setMessage({
        tone: "warning",
        title: "검수할 이미지가 없습니다.",
        body: "먼저 장면별 광고 이미지를 생성해주세요.",
      });
      return;
    }

    setIsReviewingImages(true);
    setMessage({
      tone: "success",
      title: "장면 이미지를 검수 중입니다.",
      body: "대본, 제작 지시서, 생성 이미지를 비교해 문제 컷과 수정 방향을 찾고 있습니다.",
    });

    try {
      const response = await fetch("/api/review-scene-images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          openaiApiKey: openAiKey,
          analysis: analysisResult,
          productionPlan,
          videoFormat,
          duration,
          images: imagesToReview.map((image, index) => ({
            ...image,
            sceneIndex: image.sceneIndex ?? index,
          })),
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        summary?: string;
        reviews?: SceneImageReview[];
        message?: string;
      };

      if (!response.ok || !result.ok || !result.reviews) {
        setMessage({
          tone: "error",
          title: "이미지 검수에 실패했습니다.",
          body: result.message ?? "이미지 검수 요청이 실패했습니다.",
        });
        return;
      }

      const reviews = result.reviews;
      const problemCount = reviews.filter(
        (review) => review.shouldRegenerate || review.status === "fail",
      ).length;

      setSceneImageReviews(reviews);
      setSceneImageReviewSummary(result.summary ?? "");
      setMessage({
        tone: problemCount > 0 ? "warning" : "success",
        title:
          problemCount > 0
            ? `문제 컷 ${problemCount}개를 찾았습니다.`
            : "이미지 검수가 완료됐습니다.",
        body:
          result.summary ??
          (problemCount > 0
            ? "재생성 권장 컷만 골라 다시 만들 수 있습니다."
            : "현재 이미지를 영상 제작에 사용할 수 있습니다."),
      });
    } catch {
      setMessage({
        tone: "error",
        title: "이미지 검수를 요청할 수 없습니다.",
        body: "로컬 서버 또는 네트워크 상태를 확인한 뒤 다시 시도해주세요.",
      });
    } finally {
      setIsReviewingImages(false);
    }
  };

  const updateSceneTextPosition = (
    sceneIndex: number,
    textPosition: TextPosition,
  ) => {
    setGeneratedSceneImages((currentImages) =>
      currentImages.map((image, index) =>
        (image.sceneIndex ?? index) === sceneIndex
          ? { ...image, sceneIndex, textPosition }
          : image,
      ),
    );
  };

  const regenerateSceneImage = async (sceneIndex: number) => {
    const openAiKey = getOpenAiKey();
    const currentImage = generatedSceneImages.find(
      (image, index) => (image.sceneIndex ?? index) === sceneIndex,
    );
    const sceneLabel = getSceneLabel(sceneIndex, currentImage?.isIntro);
    const review = getSceneImageReview(sceneIndex);
    const targetTextPosition =
      currentImage?.textPosition ??
      (videoFormat === "horizontal" ? "left" : "bottom");

    if (!openAiKey) {
      setMessage({
        tone: "warning",
        title: "OpenAI API 키가 필요합니다.",
        body: "문제 컷을 다시 생성하려면 OpenAI API 키를 저장해주세요.",
      });
      return;
    }

    if (!productionPlan) {
      setMessage({
        tone: "warning",
        title: "제작안이 필요합니다.",
        body: "먼저 영상 제작 지시서를 생성해주세요.",
      });
      return;
    }

    setRegeneratingSceneIndex(sceneIndex);
    setIsGeneratingImages(true);
    setVideoUrl("");
    const progressStartedAt = getCurrentTimestampMs();
    const progressEstimatedSeconds = Math.max(
      60,
      Math.round(getImageGenerationEstimateSeconds(duration) / 3),
    );

    setImageProgress({
      percent: 1,
      label: `${sceneLabel} 재생성 준비 중`,
      detail: "수정 방향과 자막 위치를 반영해 다시 만들 준비를 하고 있습니다.",
      elapsedSeconds: 0,
      estimatedSeconds: progressEstimatedSeconds,
    });
    setRenderProgress(`${sceneLabel} 광고 이미지 재생성 준비 중`);
    setMessage({
      tone: "success",
      title: `${sceneLabel}을 다시 생성 중입니다.`,
      body:
        review?.fix ??
        "대본 의미가 더 잘 보이도록 장면 구도와 분위기를 다시 잡고 있습니다.",
    });

    try {
      const sessionId = crypto.randomUUID();
      const fileMetas = await uploadSourceImageChunks(
        sessionId,
        progressStartedAt,
        progressEstimatedSeconds,
      );

      updateImageProgress(
        35,
        `${sceneLabel} 재생성 요청 중`,
        "문제 컷만 다시 생성하도록 요청하고 있습니다.",
        progressStartedAt,
        progressEstimatedSeconds,
      );

      const response = await fetch("/api/generate-scene-images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          openaiApiKey: openAiKey,
          sessionId,
          files: fileMetas,
          analysis: analysisResult,
          productionPlan,
          videoFormat,
          duration,
          includeIntroImage,
          targetSceneIndex: sceneIndex,
          targetTextPosition,
          regenerationNote:
            review?.fix ??
            "대본과 더 잘 맞는 장면으로 다시 생성하고, 같은 배경과 같은 구도 반복을 피한다.",
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        images?: GeneratedSceneImage[];
        message?: string;
      };
      const nextImage = result.images?.[0];

      if (!response.ok || !result.ok || !nextImage) {
        updateImageProgress(
          100,
          "컷 재생성 실패",
          result.message ?? "장면 이미지 재생성 요청이 실패했습니다.",
          progressStartedAt,
          progressEstimatedSeconds,
        );
        setMessage({
          tone: "error",
          title: `${sceneLabel} 재생성에 실패했습니다.`,
          body: result.message ?? "장면 이미지 재생성 요청이 실패했습니다.",
        });
        return;
      }

      const normalizedImage = {
        ...nextImage,
        sceneIndex,
        textPosition: nextImage.textPosition ?? targetTextPosition,
      };

      setGeneratedSceneImages((currentImages) => {
        let replaced = false;
        const nextImages = currentImages.map((image, index) => {
          if ((image.sceneIndex ?? index) !== sceneIndex) {
            return image;
          }

          replaced = true;
          return normalizedImage;
        });

        return replaced ? nextImages : [...nextImages, normalizedImage];
      });
      setSceneImageReviews((currentReviews) =>
        currentReviews.filter((reviewItem) => reviewItem.sceneIndex !== sceneIndex),
      );
      setSceneImageReviewSummary("");
      updateImageProgress(
        100,
        `${sceneLabel} 재생성 완료`,
        "새 이미지로 교체했습니다. 필요하면 다시 이미지 검수를 실행해주세요.",
        progressStartedAt,
        progressEstimatedSeconds,
      );
      setRenderProgress(`${sceneLabel} 광고 이미지 재생성 완료`);
      setMessage({
        tone: "success",
        title: `${sceneLabel}을 교체했습니다.`,
        body: "새 장면을 미리보고 필요하면 이미지 검수를 다시 실행해주세요.",
      });
    } catch (error) {
      updateImageProgress(
        100,
        "컷 재생성 실패",
        error instanceof Error ? error.message : "장면 이미지 재생성 중 오류가 발생했습니다.",
        progressStartedAt,
        progressEstimatedSeconds,
      );
      setMessage({
        tone: "error",
        title: `${sceneLabel}을 다시 만들 수 없습니다.`,
        body:
          error instanceof Error
            ? error.message
            : "장면 이미지 재생성 중 오류가 발생했습니다.",
      });
    } finally {
      setRegeneratingSceneIndex(null);
      setIsGeneratingImages(false);
    }
  };

  const generateProductSceneImages = async () => {
    const openAiKey = getOpenAiKey();

    if (!openAiKey) {
      setMessage({
        tone: "warning",
        title: "OpenAI API 키가 필요합니다.",
        body: "제품 광고 이미지 생성을 위해 OpenAI API 키를 저장해주세요.",
      });
      return;
    }

    if (!productionPlan) {
      setMessage({
        tone: "warning",
        title: "제작안이 필요합니다.",
        body: "먼저 영상 제작 시작을 눌러 제작 지시서를 생성해주세요.",
      });
      return;
    }

    setIsGeneratingImages(true);
    setGeneratedSceneImages([]);
    setSceneImageReviews([]);
    setSceneImageReviewSummary("");
    setVideoUrl("");
    const progressStartedAt = getCurrentTimestampMs();
    const progressEstimatedSeconds = getImageGenerationEstimateSeconds(duration);
    let progressTimer: ReturnType<typeof window.setInterval> | null = null;

    setImageProgress({
      percent: 1,
      label: "생성 준비 중",
      detail: "대본과 제품 자료를 확인하고 있습니다.",
      elapsedSeconds: 0,
      estimatedSeconds: progressEstimatedSeconds,
    });
    setRenderProgress("제품 광고 이미지 생성 준비 중");
    setMessage({
      tone: "success",
      title: "제품 광고 이미지를 생성 중입니다.",
      body: `대본과 ${duration} ${selectedFormat.label} 설정에 맞춰 필요한 장면 수만큼 이미지를 생성합니다.${
        includeIntroImage ? " 본편 앞에는 강한 인트로 이미지를 1장 추가합니다." : ""
      } 제품이 화면의 주인공으로 보이도록 요청합니다.`,
    });

    try {
      const sessionId = crypto.randomUUID();
      updateImageProgress(
        3,
        "업로드 준비 중",
        "원본 제품 이미지를 서버로 보낼 준비를 하고 있습니다.",
        progressStartedAt,
        progressEstimatedSeconds,
      );
      const fileMetas = await uploadSourceImageChunks(
        sessionId,
        progressStartedAt,
        progressEstimatedSeconds,
      );

      updateImageProgress(
        22,
        "생성 요청 전송 중",
        includeIntroImage
          ? "GPT Image에 인트로와 장면별 광고 이미지 생성을 요청하고 있습니다."
          : "GPT Image에 장면별 광고 이미지 생성을 요청하고 있습니다.",
        progressStartedAt,
        progressEstimatedSeconds,
      );
      setRenderProgress(
        includeIntroImage
          ? "GPT Image로 인트로와 제품 광고 이미지 생성 중"
          : "GPT Image로 제품 광고 이미지 생성 중",
      );
      progressTimer = window.setInterval(() => {
        const elapsedSeconds = Math.floor(
          (getCurrentTimestampMs() - progressStartedAt) / 1000,
        );
        const expectedPercent = Math.min(
          95,
          22 + Math.round((elapsedSeconds / progressEstimatedSeconds) * 73),
        );

        updateImageProgress(
          expectedPercent,
          "GPT Image 생성 중",
          includeIntroImage
            ? "인트로와 장면별 광고 이미지를 생성하고 있습니다."
            : "장면별 광고 이미지를 생성하고 있습니다.",
          progressStartedAt,
          progressEstimatedSeconds,
        );
      }, 1000);

      const response = await fetch("/api/generate-scene-images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          openaiApiKey: openAiKey,
          sessionId,
          files: fileMetas,
          analysis: analysisResult,
          productionPlan,
          videoFormat,
          duration,
          includeIntroImage,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        images?: GeneratedSceneImage[];
        message?: string;
      };

      if (!response.ok || !result.ok || !result.images) {
        updateImageProgress(
          100,
          "이미지 생성 실패",
          result.message ?? "OpenAI 이미지 생성 요청이 실패했습니다.",
          progressStartedAt,
          progressEstimatedSeconds,
        );
        setMessage({
          tone: "error",
          title: "제품 광고 이미지 생성에 실패했습니다.",
          body: result.message ?? "OpenAI 이미지 생성 요청이 실패했습니다.",
        });
        return;
      }

      setGeneratedSceneImages(result.images);
      const generatedImageCount = result.images.length;
      const generatedIntroCount = result.images.filter(
        (image) => image.isIntro || (image.sceneIndex ?? 0) < 0,
      ).length;
      updateImageProgress(
        100,
        "이미지 생성 완료",
        `${generatedImageCount}장의 광고 이미지가 준비됐습니다.${
          generatedIntroCount > 0 ? ` 인트로 ${generatedIntroCount}장 포함.` : ""
        }`,
        progressStartedAt,
        progressEstimatedSeconds,
      );
      setRenderProgress("제품 광고 이미지 생성 완료");
      setMessage({
        tone: "success",
        title: "제품 광고 이미지가 생성됐습니다.",
        body:
          result.message ??
          `생성된 ${generatedImageCount}장의 이미지를 ${selectedFormat.label} 영상 장면으로 순서대로 사용합니다.${
            generatedIntroCount > 0 ? " 첫 장면은 인트로로 짧게 재생됩니다." : ""
          }`,
      });
    } catch (error) {
      updateImageProgress(
        100,
        "이미지 생성 실패",
        error instanceof Error ? error.message : "이미지 생성 중 오류가 발생했습니다.",
        progressStartedAt,
        progressEstimatedSeconds,
      );
      setMessage({
        tone: "error",
        title: "제품 광고 이미지를 만들 수 없습니다.",
        body:
          error instanceof Error
            ? error.message
            : "이미지 생성 중 오류가 발생했습니다.",
      });
    } finally {
      if (progressTimer) {
        window.clearInterval(progressTimer);
      }
      setIsGeneratingImages(false);
    }
  };

  const createVideo = async () => {
    if (!productionPlan) {
      setMessage({
        tone: "warning",
        title: "제작안이 필요합니다.",
        body: "먼저 영상 제작 시작을 눌러 제작 지시서를 생성해주세요.",
      });
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.width = selectedFormat.width;
    canvas.height = selectedFormat.height;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    setIsRendering(true);
    setVideoUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      return "";
    });
    setRenderProgress("영상 렌더링 준비 중");

    if (document.fonts) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => window.setTimeout(resolve, 1600)),
      ]);
    }

    const imageBitmaps: ImageBitmap[] = [];
    const fallbackCopies = buildSceneCopies(productionPlan);
    const sceneCopies: SceneCopy[] = [];
    const sceneTextPositions: TextPosition[] = [];
    const sceneIntroFlags: boolean[] = [];
    let decodedAudio: AudioBuffer | null = null;
    let audioNotice = "";

    if (generatedSceneImages.length > 0) {
      for (const [index, image] of generatedSceneImages.entries()) {
        try {
          const blob = await dataUrlToBlob(
            `data:${image.mimeType};base64,${image.base64}`,
          );
          imageBitmaps.push(await createImageBitmap(blob));
          sceneCopies.push(image.copy ?? fallbackCopies[index % fallbackCopies.length]);
          sceneTextPositions.push(
            image.textPosition ?? (videoFormat === "horizontal" ? "left" : "bottom"),
          );
          sceneIntroFlags.push(Boolean(image.isIntro || (image.sceneIndex ?? index) < 0));
        } catch {
          // Invalid generated images are skipped.
        }
      }
    } else {
      const imageFiles = sourceFiles.filter((file) => file.type.startsWith("image/"));
      for (const file of imageFiles.slice(0, 1)) {
        try {
          imageBitmaps.push(await createImageBitmap(file));
          sceneCopies.push(fallbackCopies[0]);
          sceneTextPositions.push(videoFormat === "horizontal" ? "left" : "bottom");
          sceneIntroFlags.push(false);
        } catch {
          // Unsupported image files are skipped and the renderer falls back to a blank frame.
        }
      }
    }

    if (sceneCopies.length === 0) {
      sceneCopies.push(...fallbackCopies);
      sceneIntroFlags.push(...fallbackCopies.map(() => false));
    }

    try {
      if (includeVoice) {
        const typecastKey = getTypecastKey();

        if (!typecastKey) {
          throw new Error(
            "Typecast 키가 없어 음성 포함 영상을 만들 수 없습니다. API 키를 저장한 뒤 다시 시도해주세요.",
          );
        } else {
          const narrationText = extractNarrationText(productionPlan);

          if (!narrationText) {
            throw new Error("음성으로 만들 나레이션 문장이 없습니다.");
          }

          setRenderProgress("Typecast 나레이션 음성 생성 중");
          const speechResponse = await fetch("/api/typecast-speech", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              typecastApiKey: typecastKey,
              text: narrationText,
              voiceGender,
              voiceStyle,
            }),
          });
          const speechResult = (await speechResponse.json()) as {
            ok?: boolean;
            audioBase64?: string;
            audioMime?: string;
            voiceName?: string;
            textLength?: number;
            wasTrimmed?: boolean;
            message?: string;
          };

          if (speechResponse.ok && speechResult.ok && speechResult.audioBase64) {
            const audioContext = new AudioContext();
            decodedAudio = await audioContext.decodeAudioData(
              base64ToArrayBuffer(speechResult.audioBase64),
            );
            await audioContext.close();
            if (decodedAudio.duration <= 0) {
              throw new Error("Typecast 음성 파일 길이가 0초입니다.");
            }

            audioNotice = ` Typecast 음성 포함: ${speechResult.voiceName ?? "voice"}.${
              speechResult.wasTrimmed
                ? " 나레이션이 길어 앞부분 2000자 기준으로 음성을 만들었습니다."
                : ""
            }`;
          } else {
            throw new Error(
              `Typecast 음성 생성 실패: ${
                speechResult.message ?? "알 수 없는 오류"
              }`,
            );
          }
        }
      }

      const stream = canvas.captureStream(30);
      let recordStream = stream;
      let audioContext: AudioContext | null = null;
      let audioSource: AudioBufferSourceNode | null = null;

      if (decodedAudio) {
        audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        audioSource = audioContext.createBufferSource();
        audioSource.buffer = decodedAudio;
        audioSource.connect(destination);
        recordStream = new MediaStream([
          ...stream.getVideoTracks(),
          ...destination.stream.getAudioTracks(),
        ]);

        if (recordStream.getAudioTracks().length === 0) {
          throw new Error("브라우저가 음성 트랙을 영상 녹화 스트림에 연결하지 못했습니다.");
        }
      }

      const mimeType =
        [
          "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
          "video/mp4;codecs=h264,aac",
          "video/mp4",
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm",
        ].find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
      const nextVideoFileExtension = mimeType.includes("mp4") ? "mp4" : "webm";
      const recorder = new MediaRecorder(recordStream, {
        mimeType,
        videoBitsPerSecond: 4_000_000,
      });
      const chunks: Blob[] = [];
      const finished = new Promise<Blob>((resolve) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        recorder.onstop = () => {
          resolve(new Blob(chunks, { type: mimeType }));
        };
      });
      const totalMs = Math.max(
        getDurationSeconds(duration) * 1000,
        decodedAudio ? Math.ceil(decodedAudio.duration * 1000) : 0,
        1000,
      );
      const sceneCount = Math.max(imageBitmaps.length, sceneCopies.length, 1);
      const sceneDurations = buildSceneDurations(
        totalMs,
        sceneCount,
        sceneIntroFlags,
        duration,
      );
      const startTime = performance.now();
      let lastProgressUpdate = 0;

      recorder.start(250);
      if (audioSource && audioContext) {
        await audioContext.resume();
        audioSource.start();
      }

      await new Promise<void>((resolve) => {
        const renderFrame = (now: number) => {
          const elapsed = Math.min(now - startTime, totalMs);
          const overallProgress = elapsed / totalMs;
          const sceneTiming = getSceneTiming(elapsed, sceneDurations);
          const sceneIndex = sceneTiming.index;
          const sceneDuration = sceneTiming.durationMs;
          const sceneElapsed = sceneTiming.elapsedMs;
          const sceneProgress =
            sceneDuration > 0 ? clamp(sceneElapsed / sceneDuration, 0, 1) : 1;
          const transitionProgress = easeInOutCubic(
            sceneIndex > 0
              ? sceneElapsed / Math.min(520, sceneDuration * 0.28)
              : 1,
          );
          const drawSceneAtIndex = (
            index: number,
            nextSceneProgress: number,
          ) => {
            const image = imageBitmaps[index];
            const copy =
              sceneCopies[index] ?? fallbackCopies[index % fallbackCopies.length];
            const position =
              sceneTextPositions[index] ??
              (videoFormat === "horizontal" ? "left" : "bottom");

            drawScene({
              canvas,
              context,
              image,
              copy,
              formatId: videoFormat,
              position,
              sceneProgress: nextSceneProgress,
            });
          };

          if (sceneIndex > 0 && transitionProgress < 1) {
            drawSceneAtIndex(sceneIndex - 1, 1);
            context.save();
            context.globalAlpha = transitionProgress;
            drawSceneAtIndex(sceneIndex, sceneProgress);
            context.restore();
          } else {
            drawSceneAtIndex(sceneIndex, sceneProgress);
          }

          if (now - lastProgressUpdate > 500 || elapsed >= totalMs) {
            setRenderProgress(
              `영상 렌더링 중 ${Math.round(overallProgress * 100)}%`,
            );
            lastProgressUpdate = now;
          }

          if (elapsed >= totalMs) {
            resolve();
            return;
          }

          requestAnimationFrame(renderFrame);
        };

        requestAnimationFrame(renderFrame);
      });

      recorder.stop();
      const videoBlob = await finished;
      if (audioContext) {
        await audioContext.close();
      }
      const finalVideoBlob =
        nextVideoFileExtension === "webm"
          ? await fixWebmDuration(videoBlob, totalMs)
          : videoBlob;
      const nextUrl = URL.createObjectURL(finalVideoBlob);
      setVideoUrl(nextUrl);
      setVideoFileExtension(nextVideoFileExtension);
      setRenderProgress("영상 파일 생성 완료");
      setMessage({
        tone: "success",
        title: "다운로드용 영상이 생성되었습니다.",
        body: `아래 미리보기에서 확인하고 ${nextVideoFileExtension.toUpperCase()} 파일로 다운로드할 수 있습니다.${audioNotice}`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        title: "영상 렌더링에 실패했습니다.",
        body:
          error instanceof Error
            ? error.message
            : "브라우저가 MediaRecorder를 지원하지 않거나 렌더링 중 오류가 발생했습니다.",
      });
    } finally {
      imageBitmaps.forEach((image) => image.close());
      setIsRendering(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-[#ded7cb] bg-[#fffdf8] p-4">
      <div>
        <p className="text-sm font-black text-[#e74032]">영상 제작</p>
        <h3 className="mt-2 text-2xl font-black leading-tight">
          분석 결과 또는 직접 대본으로 쇼츠를 제작합니다
        </h3>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#6b655c]">
          직접 쓴 대본은 문장을 바꾸지 않고 장면 이미지와 Typecast 음성 제작에 사용합니다.
        </p>
      </div>

      <div className="mt-4 grid gap-3">
        <div>
          <p className="text-xs font-black text-[#6b655c]">제작 방식</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {scriptModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`min-h-14 rounded-lg border px-3 text-left transition ${
                  scriptMode === mode.id
                    ? "border-[#e74032] bg-[#e74032] text-white"
                    : "border-[#ded7cb] bg-white text-[#4a453c] hover:border-[#e74032]"
                }`}
                onClick={() => {
                  setScriptMode(mode.id);
                  setMessage(null);
                }}
              >
                <span className="block text-sm font-black">{mode.label}</span>
                <span className="mt-1 block text-xs font-bold opacity-80">
                  {mode.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {scriptMode === "manual" ? (
          <div>
            <label className="block">
              <span className="text-xs font-black text-[#6b655c]">
                직접 쓴 한글 대본
              </span>
              <textarea
                className="mt-2 min-h-40 w-full resize-y rounded-lg border border-[#ded7cb] bg-white px-3 py-3 text-sm font-semibold leading-6 text-[#2b2925] outline-none focus:border-[#e74032]"
                placeholder={"한 줄에 한 문장씩 입력하세요.\n예: 다이어트가 매번 힘드셨나요?\n하루 2캡슐로 가볍게 시작하세요.\n지금 바로 확인해보세요."}
                value={manualScript}
                onChange={(event) => setManualScript(event.target.value)}
              />
            </label>
            <p className="mt-2 text-xs font-bold leading-5 text-[#6b655c]">
              {manualScriptLines.length > 0
                ? `${manualScriptLines.length}줄 대본 · ${manualSceneCount}개 이미지 장면 예정 · ${manualSceneVisuals.length}개 화면 지시 · ${manualStyleDirections.length}개 스타일 지시`
                : "긴 기획문을 붙여넣으면 '실제 쇼츠 대본' 또는 '완성 대본' 아래 문장만 실제 나레이션으로 사용합니다."}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-xs font-black text-[#6b655c]">대본 톤</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {scriptTypes.map((type) => (
              <button
                key={type}
                type="button"
                className={`min-h-11 rounded-lg border px-2 text-xs font-black transition ${
                  scriptType === type
                    ? "border-[#e74032] bg-[#e74032] text-white"
                    : "border-[#ded7cb] bg-white text-[#4a453c] hover:border-[#e74032]"
                }`}
                onClick={() => setScriptType(type)}
              >
                {type}
              </button>
            ))}
          </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-black text-[#6b655c]">영상 길이</span>
            <select
              className="mt-2 min-h-11 w-full rounded-lg border border-[#ded7cb] bg-white px-3 text-sm font-bold outline-none focus:border-[#e74032]"
              value={duration}
              disabled
              onChange={() => undefined}
            >
              {durations.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-black text-[#6b655c]">
              성별/음색
            </span>
            <select
              className="mt-2 min-h-11 w-full rounded-lg border border-[#ded7cb] bg-white px-3 text-sm font-bold outline-none focus:border-[#e74032]"
              value={voiceGender}
              onChange={(event) =>
                setVoiceGender(event.target.value as VoiceGenderId)
              }
            >
              {voiceGenders.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-black text-[#6b655c]">말투</span>
            <select
              className="mt-2 min-h-11 w-full rounded-lg border border-[#ded7cb] bg-white px-3 text-sm font-bold outline-none focus:border-[#e74032]"
              value={voiceStyle}
              onChange={(event) => setVoiceStyle(event.target.value)}
            >
              {voiceStyles.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <p className="text-xs font-black text-[#6b655c]">영상 비율</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {videoFormats.map((format) => (
              <button
                key={format.id}
                type="button"
                className={`min-h-14 rounded-lg border px-3 text-left transition ${
                  videoFormat === format.id
                    ? "border-[#e74032] bg-[#e74032] text-white"
                    : "border-[#ded7cb] bg-white text-[#4a453c] hover:border-[#e74032]"
                }`}
                disabled
              >
                <span className="block text-sm font-black">
                  {format.label}
                </span>
                <span className="mt-1 block text-xs font-bold opacity-80">
                  {format.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-[#ded7cb] bg-white px-4 py-3 text-sm font-bold text-[#4a453c]">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[#e74032]"
            checked={includeIntroImage}
            onChange={(event) => {
              setIncludeIntroImage(event.target.checked);
              setProductionPlan("");
              setGeneratedSceneImages([]);
              setSceneImageReviews([]);
              setSceneImageReviewSummary("");
              setVideoUrl("");
              setMessage(null);
            }}
          />
          <span>
            강력한 인트로 이미지 자동 생성
            <span className="mt-1 block text-xs font-semibold leading-5 text-[#6b655c]">
              첫 {getIntroDurationSeconds(duration)}초 동안 본편 앞에 들어갈
              후킹 이미지를 별도로 만듭니다.
            </span>
          </span>
        </label>
      </div>

      <button
        type="button"
        className="mt-4 min-h-12 w-full rounded-lg bg-[#111111] px-5 text-sm font-black text-white transition hover:bg-[#2b2925] disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
        disabled={isGenerating}
        onClick={startProduction}
      >
        {isGenerating
          ? "제작안 생성 중..."
          : scriptMode === "manual"
            ? "직접 대본으로 제작안 만들기"
            : "영상 제작 시작"}
      </button>

      {message ? (
        <div
          className={`mt-3 rounded-lg px-4 py-3 ${
            message.tone === "success"
              ? "bg-[#e8fff9] text-[#126252]"
              : message.tone === "warning"
                ? "bg-[#fff8e7] text-[#7c5611]"
                : "bg-[#fff2ee] text-[#b42a20]"
          }`}
        >
          <p className="text-sm font-black">{message.title}</p>
          <p className="mt-1 text-xs font-semibold leading-5">{message.body}</p>
        </div>
      ) : null}

      {productionPlan ? (
        <div className="mt-4 rounded-lg border border-[#ded7cb] bg-white">
          <div className="border-b border-[#eee7dd] px-4 py-3">
            <p className="text-sm font-black text-[#126252]">
              영상 제작 지시서
            </p>
          </div>
          <pre className="max-h-[30rem] overflow-auto whitespace-pre-wrap break-words px-4 py-4 text-sm font-semibold leading-7 text-[#2b2925]">
            {productionPlan}
          </pre>
        </div>
      ) : null}

      {productionPlan ? (
        <div className="mt-4 rounded-lg border border-[#ded7cb] bg-white p-4">
          <p className="text-sm font-black text-[#e74032]">제품 이미지 생성</p>
          <h4 className="mt-2 text-xl font-black">
            원본 제품 이미지로 장면별 광고 이미지 만들기
          </h4>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#6b655c]">
            GPT Image가 대본과 {duration} {selectedFormat.label} 설정을 보고 필요한 장면 수만큼 이미지를 만듭니다. 제품이 크게 돋보이는 장면별 광고 이미지로 생성합니다.
          </p>

          <button
            type="button"
            className={`mt-4 min-h-12 w-full rounded-lg px-5 py-3 text-sm font-black text-white transition disabled:cursor-not-allowed ${
              isGeneratingImages
                ? "bg-[#e74032]"
                : "bg-[#111111] hover:bg-[#2b2925]"
            }`}
            disabled={isImageActionBusy}
            onClick={generateProductSceneImages}
          >
            {isGeneratingImages && imageProgress ? (
              <span className="block">
                <span className="block">
                  {imageProgress.percent}% {imageProgress.label}
                </span>
                <span className="mt-1 block text-xs font-bold opacity-85">
                  경과 {formatProgressTime(imageProgress.elapsedSeconds)} / 예상{" "}
                  {formatProgressTime(imageProgress.estimatedSeconds)}
                </span>
              </span>
            ) : (
              "제품 광고 이미지 생성"
            )}
          </button>

          {imageProgress ? (
            <div className="mt-3 rounded-lg bg-[#f6f3ec] px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-xs font-black text-[#4a453c]">
                <span>
                  {imageProgress.percent}% {imageProgress.label}
                </span>
                <span>
                  {formatProgressTime(imageProgress.elapsedSeconds)} 경과
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#ded7cb]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    imageProgress.label.includes("실패")
                      ? "bg-[#b42a20]"
                      : "bg-[#e74032]"
                  }`}
                  style={{ width: `${imageProgress.percent}%` }}
                />
              </div>
              <p className="mt-2 text-xs font-semibold leading-5 text-[#6b655c]">
                {imageProgress.detail}
              </p>
            </div>
          ) : null}

          {generatedSceneImages.length > 0 ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg bg-[#f6f3ec] px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-[#126252]">
                      이미지 검수
                    </p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-[#6b655c]">
                      대본과 이미지가 맞는지 확인하고, 문제 컷만 다시 생성할 수 있습니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="min-h-10 rounded-lg bg-[#111111] px-4 text-sm font-black text-white transition hover:bg-[#2b2925] disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
                    disabled={isImageActionBusy}
                    onClick={() => void reviewGeneratedSceneImages()}
                  >
                    {isReviewingImages ? "검수 중..." : "이미지 검수 실행"}
                  </button>
                </div>
                {sceneImageReviewSummary ? (
                  <p className="mt-3 rounded-md bg-white px-3 py-2 text-xs font-bold leading-5 text-[#4a453c]">
                    {sceneImageReviewSummary}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {generatedSceneImages.map((image, index) => {
                  const sceneIndex = image.sceneIndex ?? index;
                  const sceneLabel = getSceneLabel(sceneIndex, image.isIntro);
                  const review = getSceneImageReview(sceneIndex);
                  const textPosition =
                    image.textPosition ??
                    (videoFormat === "horizontal" ? "left" : "bottom");
                  const isRegeneratingThisScene =
                    regeneratingSceneIndex === sceneIndex;

                  return (
                    <div key={`${image.name}-${sceneIndex}`} className="space-y-2">
                      <div
                        aria-label={`${image.name} generated scene`}
                        className={`relative overflow-hidden ${selectedFormat.previewClass} rounded-lg bg-cover bg-center`}
                        style={{
                          backgroundImage: `url(data:${image.mimeType};base64,${image.base64})`,
                        }}
                      >
                        <span
                          className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[0.68rem] font-black ${getReviewBadgeClass(
                            review,
                          )}`}
                        >
                          {getReviewBadgeLabel(review)}
                        </span>
                        <div
                          className={getPreviewCopyClass(
                            textPosition,
                            videoFormat,
                          )}
                        >
                          <p className="dokgotak-cardnews-main">
                            {image.copy?.main ?? "고객을 멈추는 첫 장면"}
                          </p>
                          <p className="dokgotak-cardnews-sub">
                            {image.copy?.sub ??
                              "고객의 고민을 첫 장면으로 보여줍니다."}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-lg bg-[#f6f3ec] px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-black text-[#2b2925]">
                            {sceneLabel} 편집
                          </p>
                          <button
                            type="button"
                            className="min-h-9 rounded-md bg-[#e74032] px-3 text-xs font-black text-white transition hover:bg-[#c84d42] disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
                            disabled={isImageActionBusy}
                            onClick={() => void regenerateSceneImage(sceneIndex)}
                          >
                            {isRegeneratingThisScene
                              ? "다시 생성 중..."
                              : "이 컷 다시 생성"}
                          </button>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-1">
                          {getTextPositionOptions(videoFormat).map((position) => (
                            <button
                              key={position}
                              type="button"
                              aria-pressed={textPosition === position}
                              className={`min-h-8 rounded-md border px-2 text-xs font-black transition ${
                                textPosition === position
                                  ? "border-[#e74032] bg-[#e74032] text-white"
                                  : "border-[#ded7cb] bg-white text-[#4a453c] hover:border-[#e74032]"
                              }`}
                              disabled={isImageActionBusy}
                              onClick={() =>
                                updateSceneTextPosition(sceneIndex, position)
                              }
                            >
                              {textPositionLabels[position]}
                            </button>
                          ))}
                        </div>

                        {review ? (
                          <div className="mt-2 rounded-md bg-white px-3 py-2 text-xs font-semibold leading-5 text-[#4a453c]">
                            <p>
                              <span className="font-black text-[#b42a20]">
                                문제
                              </span>{" "}
                              {review.issue}
                            </p>
                            <p className="mt-1">
                              <span className="font-black text-[#126252]">
                                수정
                              </span>{" "}
                              {review.fix}
                            </p>
                          </div>
                        ) : (
                          <p className="mt-2 text-xs font-semibold leading-5 text-[#6b655c]">
                            검수 전입니다. 필요하면 이미지 검수를 실행해주세요.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {productionPlan ? (
        <div className="mt-4 rounded-lg border border-[#ded7cb] bg-white p-4">
          <p className="text-sm font-black text-[#e74032]">다운로드</p>
          <h4 className="mt-2 text-xl font-black">쇼츠 영상 파일 만들기</h4>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#6b655c]">
            브라우저에서 {selectedFormat.label} 영상을 렌더링합니다. 제품 광고 이미지를 생성한 경우 장면별 이미지를 순서대로 사용합니다.
          </p>
          <label className="mt-4 flex items-start gap-3 rounded-lg bg-[#f6f3ec] px-4 py-3 text-sm font-bold text-[#4a453c]">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[#e74032]"
              checked={includeVoice}
              onChange={(event) => setIncludeVoice(event.target.checked)}
            />
            <span>
              Typecast 나레이션 음성 포함
              <span className="mt-1 block text-xs font-semibold leading-5 text-[#6b655c]">
                Typecast 키가 저장되어 있으면 나레이션 WAV를 생성해 영상에 함께 삽입합니다. 음성 생성에 실패하면 무음 영상으로 넘어가지 않고 이유를 알려줍니다.
              </span>
            </span>
          </label>

          <button
            type="button"
            className="mt-4 min-h-12 w-full rounded-lg bg-[#e74032] px-5 text-sm font-black text-white transition hover:bg-[#c84d42] disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
            disabled={isRendering}
            onClick={createVideo}
          >
            {isRendering ? "영상 만드는 중..." : "다운로드용 영상 만들기"}
          </button>

          {renderProgress ? (
            <p className="mt-3 rounded-lg bg-[#f6f3ec] px-4 py-3 text-sm font-black text-[#5c574f]">
              {renderProgress}
            </p>
          ) : null}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="min-h-11 rounded-lg border border-[#ded7cb] px-4 text-sm font-black text-[#2b2925] transition hover:border-[#e74032]"
              onClick={() =>
                downloadTextFile("dokgotak-production-plan.txt", productionPlan)
              }
            >
              제작안 TXT 다운로드
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-[#ded7cb] px-4 text-sm font-black text-[#2b2925] transition hover:border-[#e74032]"
              onClick={() =>
                downloadTextFile(
                  "dokgotak-typecast-narration.txt",
                  extractNarrationText(productionPlan),
                )
              }
            >
              나레이션 TXT 다운로드
            </button>
          </div>

          {videoUrl ? (
            <div className="mt-4">
              <video
                src={videoUrl}
                controls
                className={`mx-auto ${selectedFormat.previewClass} max-h-[28rem] rounded-lg bg-black`}
              />
              <a
                href={videoUrl}
                download={`dokgotak-shorts-video-${selectedFormat.fileSuffix}.${videoFileExtension}`}
                className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#ffcf3f] px-5 text-sm font-black text-[#111111] transition hover:bg-[#f2ba17]"
              >
                영상 {videoFileExtension.toUpperCase()} 다운로드
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      <canvas
        ref={canvasRef}
        width={selectedFormat.width}
        height={selectedFormat.height}
        className="hidden"
      />
    </div>
  );
}

