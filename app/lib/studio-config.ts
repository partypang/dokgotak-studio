export const apiKeyStorageKey = "dokgotak-studio-api-keys";
export const serverStoredKeyToken = "__dokgotak_server_stored_key__";

export const scriptTypes = ["판매 전환형", "바이럴 쇼츠형", "신뢰 설명형"];

export const scriptModes = [
  {
    id: "ai",
    label: "AI 분석 기반",
    description: "제품 분석으로 대본 생성",
  },
  {
    id: "manual",
    label: "직접 대본 기반",
    description: "사용자 대본 그대로 사용",
  },
] as const;

export const durations = ["15초", "30초", "60초"];

export const voiceGenders = [
  {
    id: "female",
    label: "여성",
    typecastGender: "female",
  },
  {
    id: "male",
    label: "남성",
    typecastGender: "male",
  },
  {
    id: "neutral",
    label: "중성",
    typecastGender: "",
  },
] as const;

export const voiceStyles = [
  "밝은 쇼호스트",
  "프리미엄",
  "감성 다큐",
  "빠른 쇼츠",
  "차분한 설명",
];

export const videoFormats = [
  {
    id: "vertical",
    label: "세로형 9:16",
    description: "쇼츠/릴스용",
    width: 720,
    height: 1280,
    previewClass: "aspect-[9/16]",
    fileSuffix: "vertical",
  },
  {
    id: "horizontal",
    label: "가로형 16:9",
    description: "유튜브/웹용",
    width: 1280,
    height: 720,
    previewClass: "aspect-[16/9]",
    fileSuffix: "horizontal",
  },
] as const;

export type VideoFormatId = (typeof videoFormats)[number]["id"];
export type ScriptModeId = (typeof scriptModes)[number]["id"];
export type VoiceGenderId = (typeof voiceGenders)[number]["id"];

export type SceneCopy = {
  main: string;
  sub: string;
};

export type TextPosition = "bottom" | "top" | "left" | "right";

export const textPositionLabels: Record<TextPosition, string> = {
  top: "상단",
  bottom: "하단",
  left: "왼쪽",
  right: "오른쪽",
};

export const uploadChunkSize = 640 * 1024;

export function getDurationSeconds(duration: string) {
  const parsed = Number.parseInt(duration, 10);
  return Number.isFinite(parsed) ? parsed : 15;
}

export function getImageGenerationEstimateSeconds(duration: string) {
  const seconds = getDurationSeconds(duration);

  if (seconds >= 55) {
    return 240;
  }

  if (seconds >= 25) {
    return 210;
  }

  return 180;
}

export function getIntroDurationSeconds(duration: string) {
  const seconds = getDurationSeconds(duration);

  if (seconds >= 55) {
    return 3;
  }

  if (seconds >= 25) {
    return 2;
  }

  return 1.5;
}

export function formatProgressTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));

  if (safeSeconds < 60) {
    return `${safeSeconds}초`;
  }

  const minutes = Math.floor(safeSeconds / 60);
  const restSeconds = safeSeconds % 60;

  return restSeconds > 0 ? `${minutes}분 ${restSeconds}초` : `${minutes}분`;
}

export function getTextPositionOptions(formatId: VideoFormatId): TextPosition[] {
  return formatId === "vertical"
    ? ["bottom", "top"]
    : ["left", "right", "bottom", "top"];
}

export function getVideoFormat(formatId: VideoFormatId) {
  return (
    videoFormats.find((format) => format.id === formatId) ?? videoFormats[0]
  );
}

export function getVoiceGender(genderId: VoiceGenderId) {
  return voiceGenders.find((gender) => gender.id === genderId) ?? voiceGenders[0];
}
