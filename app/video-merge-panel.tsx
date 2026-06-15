"use client";

import {
  ChangeEvent,
  DragEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { getRequestApiKey } from "./lib/browser-api-keys";

type OutputFormatId = "vertical" | "horizontal";
type FitMode = "contain" | "cover";

type MergeClip = {
  id: string;
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
};

type SubtitleCue = {
  start: number;
  end: number;
  text: string;
  sourceText?: string;
};

type ClipSubtitles = Record<string, SubtitleCue[]>;

type KoreanSubtitleResponse = {
  ok?: boolean;
  cues?: SubtitleCue[];
  message?: string;
};

type CapturedVideoFrame = {
  label: string;
  position: number;
  mimeType: string;
  base64: string;
};

type OrderSuggestionItem = {
  clipId: string;
  order: number;
  role: string;
  reason: string;
  confidence: number;
};

type OrderSuggestion = {
  summary: string;
  confidence: "high" | "medium" | "low";
  spellingNote: string;
  items: OrderSuggestionItem[];
};

type VideoOrderResponse = Partial<OrderSuggestion> & {
  ok?: boolean;
  message?: string;
};

type SubtitleUploadResponse = {
  ok: boolean;
  status: number;
  result?: KoreanSubtitleResponse;
  message: string;
};

const directSubtitleUploadLimitBytes = 8 * 1024 * 1024;

const outputFormats = {
  vertical: {
    label: "9:16 세로형",
    description: "쇼츠/릴스용",
    width: 720,
    height: 1280,
    previewClass: "aspect-[9/16]",
  },
  horizontal: {
    label: "16:9 가로형",
    description: "유튜브/웹용",
    width: 1280,
    height: 720,
    previewClass: "aspect-[16/9]",
  },
} satisfies Record<
  OutputFormatId,
  {
    label: string;
    description: string;
    width: number;
    height: number;
    previewClass: string;
  }
>;

function formatSeconds(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const restSeconds = safeSeconds % 60;

  return `${minutes}:${String(restSeconds).padStart(2, "0")}`;
}

function getVideoFileLabel(file: File) {
  const sizeMb = file.size / 1024 / 1024;
  return `${file.name} · ${sizeMb.toFixed(sizeMb >= 10 ? 0 : 1)}MB`;
}

function getFileStem(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

function getAudioContextConstructor() {
  return (
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function downmixToMono(audioBuffer: AudioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleCount = audioBuffer.length;
  const mono = new Float32Array(sampleCount);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      mono[sampleIndex] += channelData[sampleIndex] / channelCount;
    }
  }

  return mono;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeWav(audioBuffer: AudioBuffer) {
  const samples = downmixToMono(audioBuffer);
  const headerBytes = 44;
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const wavBuffer = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(wavBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = headerBytes;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      offset,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
    offset += bytesPerSample;
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}

async function extractAudioWithDecode(clip: MergeClip) {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new Error("이 브라우저에서 오디오 추출을 지원하지 않습니다.");
  }

  const audioContext = new AudioContextConstructor({ sampleRate: 16000 });

  try {
    const audioBuffer = await audioContext.decodeAudioData(
      await clip.file.arrayBuffer(),
    );
    const wavBlob = encodeWav(audioBuffer);

    return new File(
      [wavBlob],
      `${getFileStem(clip.file.name)}-subtitle-audio.wav`,
      { type: "audio/wav" },
    );
  } finally {
    await audioContext.close();
  }
}

function readVideoMetadata(file: File): Promise<MergeClip> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");

  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      resolve({
        id: crypto.randomUUID(),
        file,
        url,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} 영상 정보를 읽지 못했습니다.`));
    };
  });
}

function waitForVideoMetadata(video: HTMLVideoElement) {
  if (video.readyState >= 1) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("영상 파일을 읽지 못했습니다."));
  });
}

function seekVideo(video: HTMLVideoElement, seconds: number) {
  const safeSeconds = Math.max(
    0,
    Math.min(seconds, Math.max(0, (video.duration || 0) - 0.08)),
  );

  return new Promise<void>((resolve, reject) => {
    let fallbackTimer = 0;
    const cleanup = () => {
      window.clearTimeout(fallbackTimer);
      video.onseeked = null;
      video.onerror = null;
    };

    if (Math.abs(video.currentTime - safeSeconds) < 0.01 && video.readyState >= 2) {
      requestAnimationFrame(() => resolve());
      return;
    }

    video.onseeked = () => {
      cleanup();
      resolve();
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("영상 프레임을 읽지 못했습니다."));
    };
    fallbackTimer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 1800);
    video.currentTime = safeSeconds;
  });
}

function getFramePoints(duration: number) {
  const safeDuration = Math.max(0.1, duration);
  const points = [
    {
      label: "앞부분",
      position: 0.12,
      seconds: Math.min(0.8, safeDuration * 0.12),
    },
    {
      label: "중간",
      position: 0.5,
      seconds: safeDuration * 0.5,
    },
    {
      label: "끝부분",
      position: 0.88,
      seconds: Math.max(0, safeDuration - Math.min(0.8, safeDuration * 0.12)),
    },
  ];
  const usedSeconds: number[] = [];

  return points.filter((point) => {
    if (usedSeconds.some((usedSecond) => Math.abs(usedSecond - point.seconds) < 0.25)) {
      return false;
    }

    usedSeconds.push(point.seconds);
    return true;
  });
}

async function captureClipFrames(clip: MergeClip): Promise<CapturedVideoFrame[]> {
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return [];
  }

  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = clip.url;

  await waitForVideoMetadata(video);

  const sourceWidth = video.videoWidth || clip.width || 720;
  const sourceHeight = video.videoHeight || clip.height || 1280;
  const scale = Math.min(1, 520 / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const frames: CapturedVideoFrame[] = [];

  for (const point of getFramePoints(clip.duration || video.duration || 1)) {
    await seekVideo(video, point.seconds);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.68);
    const [, base64 = ""] = dataUrl.split(",");

    if (base64) {
      frames.push({
        label: point.label,
        position: point.position,
        mimeType: "image/jpeg",
        base64,
      });
    }
  }

  video.removeAttribute("src");
  video.load();
  return frames;
}

function getAudioRecorderMimeType() {
  return (
    [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ].find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
  );
}

async function extractAudioWithRecorder(
  clip: MergeClip,
  onProgress: (currentTime: number, duration: number) => void,
) {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor || typeof MediaRecorder === "undefined") {
    throw new Error("이 브라우저에서 자막용 오디오 추출을 지원하지 않습니다.");
  }

  const video = document.createElement("video");
  const audioContext = new AudioContextConstructor();
  let audioSource: MediaElementAudioSourceNode | null = null;
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];

  video.preload = "auto";
  video.playsInline = true;
  video.muted = false;
  video.volume = 1;
  video.src = clip.url;
  video.style.position = "fixed";
  video.style.left = "-10px";
  video.style.top = "-10px";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.append(video);

  try {
    await waitForVideoMetadata(video);
    await audioContext.resume();

    audioSource = audioContext.createMediaElementSource(video);
    const destination = audioContext.createMediaStreamDestination();
    audioSource.connect(destination);

    const mimeType = getAudioRecorderMimeType();
    const recorderOptions: MediaRecorderOptions = {
      audioBitsPerSecond: 48_000,
    };
    if (mimeType) {
      recorderOptions.mimeType = mimeType;
    }

    recorder = new MediaRecorder(destination.stream, recorderOptions);
    const finished = new Promise<Blob>((resolve, reject) => {
      if (!recorder) {
        reject(new Error("자막용 오디오 녹음기를 만들지 못했습니다."));
        return;
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => reject(new Error("자막용 오디오 녹음에 실패했습니다."));
      recorder.onstop = () =>
        resolve(
          new Blob(chunks, {
            type: recorder?.mimeType || mimeType || "audio/webm",
          }),
        );
    });
    const ended = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("자막용 오디오 추출 시간이 초과됐습니다.")),
        Math.max(15_000, (clip.duration + 8) * 1000),
      );

      video.ontimeupdate = () => onProgress(video.currentTime, video.duration || clip.duration);
      video.onended = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("영상에서 오디오를 읽지 못했습니다."));
      };
    });

    recorder.start(1000);
    await video.play();
    await ended;
    recorder.stop();

    const audioBlob = await finished;
    if (audioBlob.size === 0) {
      throw new Error("영상에서 자막용 오디오를 추출하지 못했습니다.");
    }

    const extension = audioBlob.type.includes("mp4")
      ? "m4a"
      : audioBlob.type.includes("ogg")
        ? "ogg"
        : "webm";

    return new File(
      [audioBlob],
      `${getFileStem(clip.file.name)}-subtitle-audio.${extension}`,
      { type: audioBlob.type || "audio/webm" },
    );
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();

    if (audioSource) {
      audioSource.disconnect();
    }

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    await audioContext.close();
  }
}

async function createSubtitleAudioFile(
  clip: MergeClip,
  onProgress: (currentTime: number, duration: number) => void,
) {
  try {
    return await extractAudioWithDecode(clip);
  } catch {
    return extractAudioWithRecorder(clip, onProgress);
  }
}

function getDrawRect(options: {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  fitMode: FitMode;
}) {
  const sourceRatio = options.sourceWidth / options.sourceHeight;
  const targetRatio = options.targetWidth / options.targetHeight;
  const shouldFitWidth =
    options.fitMode === "contain"
      ? sourceRatio > targetRatio
      : sourceRatio < targetRatio;
  const width = shouldFitWidth
    ? options.targetWidth
    : options.targetHeight * sourceRatio;
  const height = shouldFitWidth
    ? options.targetWidth / sourceRatio
    : options.targetHeight;

  return {
    x: (options.targetWidth - width) / 2,
    y: (options.targetHeight - height) / 2,
    width,
    height,
  };
}

function drawVideoFrame(options: {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  fitMode: FitMode;
}) {
  const { canvas, context, video, fitMode } = options;

  context.fillStyle = "#111111";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (!video.videoWidth || !video.videoHeight) {
    return;
  }

  const rect = getDrawRect({
    sourceWidth: video.videoWidth,
    sourceHeight: video.videoHeight,
    targetWidth: canvas.width,
    targetHeight: canvas.height,
    fitMode,
  });

  context.drawImage(video, rect.x, rect.y, rect.width, rect.height);
}

function getActiveSubtitle(cues: SubtitleCue[], currentTime: number) {
  return cues.find(
    (cue) => currentTime >= cue.start && currentTime <= cue.end,
  );
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
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height,
  );
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function fitTextToWidth(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  let fitted = text;

  while (fitted.length > 1 && context.measureText(`${fitted}…`).width > maxWidth) {
    fitted = fitted.slice(0, -1);
  }

  return `${fitted}…`;
}

function wrapSubtitleLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2,
) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const hasWordBreaks = normalized.includes(" ");
  const tokens = hasWordBreaks ? normalized.split(" ") : Array.from(normalized);
  const lines: string[] = [];
  let currentLine = "";

  tokens.forEach((token) => {
    const nextLine = hasWordBreaks
      ? currentLine
        ? `${currentLine} ${token}`
        : token
      : `${currentLine}${token}`;

    if (context.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine;
      return;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = token;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = fitTextToWidth(
    context,
    visible[maxLines - 1],
    maxWidth,
  );
  return visible;
}

function drawSubtitle(options: {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  text: string;
}) {
  const { canvas, context, text } = options;
  const fontSize = Math.max(28, Math.round(canvas.height * 0.036));
  const lineHeight = Math.round(fontSize * 1.32);
  const maxTextWidth = Math.round(canvas.width * 0.84);
  const paddingX = Math.round(fontSize * 0.78);
  const paddingY = Math.round(fontSize * 0.46);

  context.save();
  context.font = `800 ${fontSize}px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  const lines = wrapSubtitleLines(context, text, maxTextWidth);
  if (lines.length === 0) {
    context.restore();
    return;
  }

  const textWidth = Math.max(...lines.map((line) => context.measureText(line).width));
  const boxWidth = Math.min(
    Math.round(canvas.width * 0.92),
    Math.ceil(textWidth + paddingX * 2),
  );
  const boxHeight = lines.length * lineHeight + paddingY * 2;
  const x = (canvas.width - boxWidth) / 2;
  const y = canvas.height - Math.round(canvas.height * 0.08) - boxHeight;

  context.fillStyle = "rgba(0, 0, 0, 0.72)";
  drawRoundedRect(context, x, y, boxWidth, boxHeight, Math.round(fontSize * 0.4));
  context.fill();

  context.strokeStyle = "rgba(255, 255, 255, 0.16)";
  context.lineWidth = Math.max(2, Math.round(fontSize * 0.06));
  context.stroke();

  context.shadowColor = "rgba(0, 0, 0, 0.75)";
  context.shadowBlur = Math.round(fontSize * 0.14);
  context.fillStyle = "#ffffff";

  lines.forEach((line, index) => {
    context.fillText(
      line,
      canvas.width / 2,
      y + paddingY + lineHeight / 2 + index * lineHeight,
      maxTextWidth,
    );
  });

  context.restore();
}

function createRecorder(stream: MediaStream) {
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

  return {
    mimeType,
    recorder: new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    }),
  };
}

function isPayloadTooLargeError(response: SubtitleUploadResponse) {
  return (
    response.status === 413 ||
    /payload\s+too\s+large|업로드.*크|용량/i.test(response.message)
  );
}

async function readSubtitleUploadResponse(
  response: Response,
): Promise<SubtitleUploadResponse> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const result = (await response.json().catch(() => ({}))) as KoreanSubtitleResponse;
    return {
      ok: response.ok && result.ok === true,
      status: response.status,
      result,
      message:
        result.message ??
        (response.ok
          ? "한국어 자막 응답을 읽지 못했습니다."
          : `한국어 자막 요청이 실패했습니다. 상태 코드: ${response.status}`),
    };
  }

  const text = (await response.text().catch(() => "")).trim();
  const message =
    response.status === 413 || /payload\s+too\s+large/i.test(text)
      ? "영상 파일이 로컬 서버 업로드 제한보다 큽니다. 자막용 오디오만 추출해서 다시 시도합니다."
      : text || `한국어 자막 요청이 실패했습니다. 상태 코드: ${response.status}`;

  return {
    ok: false,
    status: response.status,
    message,
  };
}

async function postKoreanSubtitleFile(options: {
  openAiApiKey: string;
  file: File;
}) {
  const formData = new FormData();
  formData.append("openaiApiKey", options.openAiApiKey);
  formData.append("file", options.file, options.file.name);

  const response = await fetch("/api/korean-subtitles", {
    method: "POST",
    body: formData,
  });

  return readSubtitleUploadResponse(response);
}

export default function VideoMergePanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [clips, setClips] = useState<MergeClip[]>([]);
  const [outputFormat, setOutputFormat] = useState<OutputFormatId>("vertical");
  const [fitMode, setFitMode] = useState<FitMode>("contain");
  const [targetSeconds, setTargetSeconds] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [isGeneratingSubtitles, setIsGeneratingSubtitles] = useState(false);
  const [isRecommendingOrder, setIsRecommendingOrder] = useState(false);
  const [includeKoreanSubtitles, setIncludeKoreanSubtitles] = useState(false);
  const [clipSubtitles, setClipSubtitles] = useState<ClipSubtitles>({});
  const [orderSuggestion, setOrderSuggestion] = useState<OrderSuggestion | null>(
    null,
  );
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "error";
    title: string;
    body: string;
  } | null>(null);
  const [mergedUrl, setMergedUrl] = useState("");
  const [mergedExtension, setMergedExtension] = useState("webm");
  const selectedFormat = outputFormats[outputFormat];
  const totalSeconds = useMemo(
    () => clips.reduce((sum, clip) => sum + clip.duration, 0),
    [clips],
  );
  const subtitleCueCount = useMemo(
    () =>
      clips.reduce(
        (sum, clip) => sum + (clipSubtitles[clip.id]?.length ?? 0),
        0,
      ),
    [clipSubtitles, clips],
  );
  const parsedTargetSeconds = Number(targetSeconds);
  const finalSeconds =
    Number.isFinite(parsedTargetSeconds) && parsedTargetSeconds > 0
      ? parsedTargetSeconds
      : totalSeconds;
  const isBusy = isReading || isRendering || isGeneratingSubtitles || isRecommendingOrder;

  const clearMergedOutput = () => {
    setMergedUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }

      return "";
    });
  };

  const addFiles = async (incomingFiles: FileList | File[]) => {
    if (isBusy) {
      return;
    }

    const videoFiles = Array.from(incomingFiles).filter((file) =>
      file.type.startsWith("video/"),
    );

    if (videoFiles.length === 0) {
      setMessage({
        tone: "warning",
        title: "영상 파일이 필요합니다.",
        body: "MP4, WebM, MOV 같은 브라우저에서 재생 가능한 영상 파일을 넣어주세요.",
      });
      return;
    }

    setIsReading(true);
    setMessage({
      tone: "success",
      title: "영상 정보를 읽고 있습니다.",
      body: `${videoFiles.length}개 파일의 길이와 비율을 확인합니다.`,
    });
    clearMergedOutput();
    setOrderSuggestion(null);

    try {
      const nextClips = await Promise.all(videoFiles.map(readVideoMetadata));

      setClips((current) => [...current, ...nextClips]);
      setMessage({
        tone: "success",
        title: "영상이 추가됐습니다.",
        body: "파일 목록의 순서대로 이어붙입니다. 필요하면 위/아래 버튼으로 순서를 바꿔주세요.",
      });
    } catch (error) {
      setMessage({
        tone: "error",
        title: "영상 정보를 읽지 못했습니다.",
        body:
          error instanceof Error
            ? error.message
            : "지원하지 않는 영상 파일이 포함되어 있습니다.",
      });
    } finally {
      setIsReading(false);
    }
  };

  const removeClip = (clipId: string) => {
    setClips((current) => {
      const clip = current.find((item) => item.id === clipId);
      if (clip) {
        URL.revokeObjectURL(clip.url);
      }

      return current.filter((item) => item.id !== clipId);
    });
    setClipSubtitles((current) => {
      const next = { ...current };
      delete next[clipId];
      return next;
    });
    clearMergedOutput();
    setOrderSuggestion(null);
  };

  const moveClip = (clipId: string, direction: -1 | 1) => {
    setClips((current) => {
      const index = current.findIndex((clip) => clip.id === clipId);
      const nextIndex = index + direction;

      if (index === -1 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const nextClips = [...current];
      const [clip] = nextClips.splice(index, 1);
      nextClips.splice(nextIndex, 0, clip);
      return nextClips;
    });
    clearMergedOutput();
    setOrderSuggestion(null);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      void addFiles(event.target.files);
    }
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void addFiles(event.dataTransfer.files);
  };

  const generateKoreanSubtitles = async () => {
    if (clips.length === 0) {
      setMessage({
        tone: "warning",
        title: "자막을 만들 영상이 없습니다.",
        body: "먼저 영어 음성이 들어 있는 영상 파일을 넣어주세요.",
      });
      return;
    }

    setIsGeneratingSubtitles(true);
    setIncludeKoreanSubtitles(true);
    setMessage({
      tone: "success",
      title: "한국어 자막을 만들고 있습니다.",
      body: "OpenAI가 영어 음성을 듣고 한국어 자막 타임코드를 생성합니다.",
    });
    clearMergedOutput();

    try {
      const openAiApiKey = getRequestApiKey("openai");
      const nextSubtitles: ClipSubtitles = { ...clipSubtitles };

      for (const [index, clip] of clips.entries()) {
        setProgress(
          `한국어 자막 생성 중 ${index + 1}/${clips.length} · ${clip.file.name}`,
        );

        let subtitleFile = clip.file;

        if (clip.file.size > directSubtitleUploadLimitBytes) {
          setProgress(
            `영상이 커서 자막용 음성만 추출 중 ${index + 1}/${clips.length} · ${clip.file.name}`,
          );
          subtitleFile = await createSubtitleAudioFile(clip, (currentTime, duration) => {
            setProgress(
              `자막용 음성 추출 중 ${index + 1}/${clips.length} · ${formatSeconds(
                currentTime,
              )} / ${formatSeconds(duration || clip.duration)}`,
            );
          });
        }

        setProgress(
          `한국어 자막 생성 요청 중 ${index + 1}/${clips.length} · ${subtitleFile.name}`,
        );

        let subtitleResponse = await postKoreanSubtitleFile({
          openAiApiKey,
          file: subtitleFile,
        });

        if (
          !subtitleResponse.ok &&
          subtitleFile === clip.file &&
          isPayloadTooLargeError(subtitleResponse)
        ) {
          setProgress(
            `영상이 커서 자막용 음성만 추출 중 ${index + 1}/${clips.length} · ${clip.file.name}`,
          );
          subtitleFile = await createSubtitleAudioFile(clip, (currentTime, duration) => {
            setProgress(
              `자막용 음성 추출 중 ${index + 1}/${clips.length} · ${formatSeconds(
                currentTime,
              )} / ${formatSeconds(duration || clip.duration)}`,
            );
          });
          setProgress(
            `추출한 음성으로 한국어 자막 생성 중 ${index + 1}/${clips.length}`,
          );
          subtitleResponse = await postKoreanSubtitleFile({
            openAiApiKey,
            file: subtitleFile,
          });
        }

        const result = subtitleResponse.result;

        if (!subtitleResponse.ok || !result?.ok || !Array.isArray(result.cues)) {
          throw new Error(
            subtitleResponse.message ??
              result?.message ??
              `${clip.file.name} 자막 생성에 실패했습니다.`,
          );
        }

        nextSubtitles[clip.id] = result.cues;
        setClipSubtitles({ ...nextSubtitles });
      }

      const nextCueCount = clips.reduce(
        (sum, clip) => sum + (nextSubtitles[clip.id]?.length ?? 0),
        0,
      );

      setProgress("");
      setMessage({
        tone: "success",
        title: "한국어 자막이 준비됐습니다.",
        body: `${clips.length}개 영상에서 ${nextCueCount}개 자막을 만들었습니다. 이제 영상 이어붙이기를 누르면 자막이 함께 들어갑니다.`,
      });
    } catch (error) {
      setProgress("");
      setMessage({
        tone: "error",
        title: "한국어 자막 생성에 실패했습니다.",
        body:
          error instanceof Error
            ? error.message
            : "OpenAI 자막 생성 요청을 처리하지 못했습니다.",
      });
    } finally {
      setIsGeneratingSubtitles(false);
    }
  };

  const recommendVideoOrder = async () => {
    if (clips.length < 2) {
      setMessage({
        tone: "warning",
        title: "순서를 추천할 영상이 부족합니다.",
        body: "AI가 흐름을 비교하려면 영상이 2개 이상 필요합니다.",
      });
      return;
    }

    setIsRecommendingOrder(true);
    setOrderSuggestion(null);
    setMessage({
      tone: "success",
      title: "영상 순서를 분석하고 있습니다.",
      body: "대표 프레임과 자막 단서를 보고 자연스러운 흐름을 추천합니다.",
    });
    clearMergedOutput();

    try {
      const openAiApiKey = getRequestApiKey("openai");
      const payloadClips = [];

      for (const [index, clip] of clips.entries()) {
        setProgress(
          `AI 순서 추천 준비 중 ${index + 1}/${clips.length} · ${clip.file.name}`,
        );

        const frames = await captureClipFrames(clip);
        if (frames.length === 0) {
          throw new Error(`${clip.file.name} 대표 프레임을 만들지 못했습니다.`);
        }

        payloadClips.push({
          id: clip.id,
          fileName: clip.file.name,
          duration: clip.duration,
          width: clip.width,
          height: clip.height,
          subtitles: (clipSubtitles[clip.id] ?? []).slice(0, 12),
          frames,
        });
      }

      setProgress("AI가 영상 흐름과 맞춤법을 검토하는 중");

      const response = await fetch("/api/video-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          openaiApiKey: openAiApiKey,
          clips: payloadClips,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as VideoOrderResponse;

      if (
        !response.ok ||
        !result.ok ||
        !result.summary ||
        !result.spellingNote ||
        !Array.isArray(result.items)
      ) {
        throw new Error(result.message ?? "영상 순서 추천 결과를 읽지 못했습니다.");
      }

      setOrderSuggestion({
        summary: result.summary,
        confidence: result.confidence ?? "medium",
        spellingNote: result.spellingNote,
        items: result.items,
      });
      setProgress("");
      setMessage({
        tone: "success",
        title: "AI 순서 추천이 준비됐습니다.",
        body: "추천 이유의 맞춤법까지 검토했습니다. 확인 후 추천 순서 적용을 눌러주세요.",
      });
    } catch (error) {
      setProgress("");
      setMessage({
        tone: "error",
        title: "AI 순서 추천에 실패했습니다.",
        body:
          error instanceof Error
            ? error.message
            : "영상 흐름을 분석하지 못했습니다.",
      });
    } finally {
      setIsRecommendingOrder(false);
    }
  };

  const applyOrderSuggestion = () => {
    if (!orderSuggestion) {
      return;
    }

    const orderMap = new Map(
      orderSuggestion.items.map((item, index) => [item.clipId, index]),
    );

    setClips((current) =>
      [...current].sort((left, right) => {
        const leftOrder = orderMap.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = orderMap.get(right.id) ?? Number.MAX_SAFE_INTEGER;

        return leftOrder - rightOrder;
      }),
    );
    clearMergedOutput();
    setMessage({
      tone: "success",
      title: "추천 순서를 적용했습니다.",
      body: "AI가 추천한 흐름대로 영상 목록을 재정렬했습니다.",
    });
  };

  const renderMergedVideo = async () => {
    if (clips.length === 0) {
      setMessage({
        tone: "warning",
        title: "이어붙일 영상이 없습니다.",
        body: "먼저 영상 파일을 1개 이상 넣어주세요.",
      });
      return;
    }

    if (includeKoreanSubtitles && subtitleCueCount === 0) {
      setMessage({
        tone: "warning",
        title: "한국어 자막이 아직 없습니다.",
        body: "먼저 한국어 자막 생성을 눌러 자막 타임코드를 만들어주세요.",
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

    const renderSeconds = Math.max(1, finalSeconds);
    const renderMs = renderSeconds * 1000;
    const video = document.createElement("video");
    let audioContext: AudioContext | null = null;
    let audioSource: MediaElementAudioSourceNode | null = null;
    let audioNotice = "";
    let renderedMs = 0;
    let lastProgressUpdate = 0;

    setIsRendering(true);
    setProgress("렌더링 준비 중");
    setMessage({
      tone: "success",
      title: "영상을 이어붙이고 있습니다.",
      body: `${selectedFormat.label} ${formatSeconds(renderSeconds)} 영상으로 렌더링합니다.${
        includeKoreanSubtitles ? " 한국어 자막도 함께 넣습니다." : ""
      }`,
    });
    clearMergedOutput();

    video.playsInline = true;
    video.preload = "auto";
    video.volume = 1;
    video.muted = false;
    video.style.position = "fixed";
    video.style.left = "-10px";
    video.style.top = "-10px";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    document.body.append(video);

    try {
      audioContext = new AudioContext();
      await audioContext.resume();

      try {
        audioSource = audioContext.createMediaElementSource(video);
      } catch {
        audioNotice = " 오디오 연결이 제한되어 무음 영상으로 저장될 수 있습니다.";
      }

      const destination = audioContext.createMediaStreamDestination();
      if (audioSource) {
        audioSource.connect(destination);
      }

      const canvasStream = canvas.captureStream(30);
      const recordStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);
      const { mimeType, recorder } = createRecorder(recordStream);
      const chunks: Blob[] = [];
      const finished = new Promise<Blob>((resolve) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });
      const updateProgress = (elapsedMs: number) => {
        const now = performance.now();

        if (now - lastProgressUpdate < 300 && elapsedMs < renderMs) {
          return;
        }

        lastProgressUpdate = now;
        setProgress(
          `${Math.min(100, Math.round((elapsedMs / renderMs) * 100))}% · ${formatSeconds(
            elapsedMs / 1000,
          )} / ${formatSeconds(renderSeconds)}`,
        );
      };
      const drawFor = (durationMs: number, clipId?: string) =>
        new Promise<void>((resolve) => {
          const segmentStart = performance.now();
          const draw = (now: number) => {
            const elapsed = Math.min(durationMs, now - segmentStart);
            const subtitle = clipId
              ? getActiveSubtitle(clipSubtitles[clipId] ?? [], video.currentTime)
              : null;

            drawVideoFrame({
              canvas,
              context,
              video,
              fitMode,
            });
            if (includeKoreanSubtitles && subtitle) {
              drawSubtitle({
                canvas,
                context,
                text: subtitle.text,
              });
            }
            updateProgress(renderedMs + elapsed);

            if (elapsed >= durationMs) {
              resolve();
              return;
            }

            requestAnimationFrame(draw);
          };

          requestAnimationFrame(draw);
        });

      recorder.start(250);

      for (const clip of clips) {
        if (renderedMs >= renderMs) {
          break;
        }

        const clipMs = Math.min(clip.duration * 1000, renderMs - renderedMs);
        if (clipMs <= 0) {
          continue;
        }

        video.src = clip.url;
        await waitForVideoMetadata(video);
        video.currentTime = 0;

        try {
          await video.play();
        } catch {
          video.muted = true;
          audioNotice = " 브라우저 자동재생 제한으로 오디오는 제외됐습니다.";
          await video.play();
        }

        await drawFor(clipMs, clip.id);
        renderedMs += clipMs;
        video.pause();
      }

      if (renderedMs < renderMs) {
        await drawFor(renderMs - renderedMs);
        renderedMs = renderMs;
      }

      recorder.stop();
      const blob = await finished;
      const nextUrl = URL.createObjectURL(blob);

      setMergedUrl(nextUrl);
      setMergedExtension(mimeType.includes("mp4") ? "mp4" : "webm");
      setProgress("100% · 렌더링 완료");
      setMessage({
        tone: "success",
        title: "영상 이어붙이기가 완료됐습니다.",
        body: `총 ${clips.length}개 영상을 ${formatSeconds(renderSeconds)} 길이로 저장했습니다.${
          includeKoreanSubtitles ? ` 한국어 자막 ${subtitleCueCount}개를 넣었습니다.` : ""
        }${audioNotice}`,
      });
    } catch (error) {
      setProgress("");
      setMessage({
        tone: "error",
        title: "영상 렌더링에 실패했습니다.",
        body:
          error instanceof Error
            ? error.message
            : "브라우저가 이 영상 파일을 처리하지 못했습니다.",
      });
    } finally {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();

      if (audioSource) {
        audioSource.disconnect();
      }

      if (audioContext) {
        await audioContext.close();
      }

      setIsRendering(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-[#ded7cb] bg-white shadow-[0_18px_50px_rgba(24,24,24,0.07)]">
      <div className="border-b border-[#eee7dd] px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black text-[#007f8a]">VIDEO MERGE</p>
            <h2 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">
              영상 이어붙이기
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[26rem]">
            <div className="rounded-lg bg-[#f6f3ec] px-3 py-2">
              <p className="text-[0.68rem] font-black text-[#6b655c]">클립</p>
              <p className="mt-1 text-lg font-black">{clips.length}</p>
            </div>
            <div className="rounded-lg bg-[#f6f3ec] px-3 py-2">
              <p className="text-[0.68rem] font-black text-[#6b655c]">원본</p>
              <p className="mt-1 text-lg font-black">
                {formatSeconds(totalSeconds)}
              </p>
            </div>
            <div className="rounded-lg bg-[#f6f3ec] px-3 py-2">
              <p className="text-[0.68rem] font-black text-[#6b655c]">출력</p>
              <p className="mt-1 text-lg font-black">
                {formatSeconds(finalSeconds)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="border-b border-[#eee7dd] p-5 lg:border-b-0 lg:border-r">
          <div
            className={`rounded-lg border-2 border-dashed px-5 py-8 text-center transition ${
              isDragging
                ? "border-[#e74032] bg-[#fff2ee]"
                : "border-[#ded7cb] bg-[#fffdf8]"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              multiple
              className="sr-only"
              onChange={handleInputChange}
            />
            <p className="text-sm font-black text-[#e74032]">1. 영상 넣기</p>
            <p className="mt-2 text-xl font-black">
              파일을 선택하거나 끌어다 놓으세요.
            </p>
            <button
              type="button"
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#111111] px-5 text-sm font-bold text-white transition hover:bg-[#2b2925] disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
              disabled={isBusy}
              onClick={() => inputRef.current?.click()}
            >
              {isReading ? "읽는 중" : "영상 선택"}
            </button>
          </div>

          {clips.length > 0 ? (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-black text-[#2b2925]">2. 순서 정리</p>
                <button
                  type="button"
                  className="min-h-9 rounded-lg bg-[#111111] px-3 text-xs font-black text-white transition hover:bg-[#2b2925] disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
                  disabled={clips.length < 2 || isBusy}
                  onClick={() => void recommendVideoOrder()}
                >
                  {isRecommendingOrder ? "분석 중" : "AI 추천"}
                </button>
              </div>

              <div className="max-h-80 overflow-auto rounded-lg border border-[#e8e0d4] bg-white">
                {clips.map((clip, index) => (
                  <div
                    key={clip.id}
                    className="grid gap-3 border-b border-[#eee7dd] px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black">
                        {index + 1}. {clip.file.name}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-[#6b655c]">
                        {formatSeconds(clip.duration)} · {clip.width}x
                        {clip.height} · {getVideoFileLabel(clip.file)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="min-h-9 rounded-md border border-[#ded7cb] px-3 text-xs font-black text-[#4a453c] transition hover:border-[#e74032] disabled:cursor-not-allowed disabled:text-[#b8afa4]"
                        disabled={index === 0 || isBusy}
                        onClick={() => moveClip(clip.id, -1)}
                      >
                        위
                      </button>
                      <button
                        type="button"
                        className="min-h-9 rounded-md border border-[#ded7cb] px-3 text-xs font-black text-[#4a453c] transition hover:border-[#e74032] disabled:cursor-not-allowed disabled:text-[#b8afa4]"
                        disabled={index === clips.length - 1 || isBusy}
                        onClick={() => moveClip(clip.id, 1)}
                      >
                        아래
                      </button>
                      <button
                        type="button"
                        className="min-h-9 rounded-md bg-[#e74032] px-3 text-xs font-black text-white transition hover:bg-[#c84d42] disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
                        disabled={isBusy}
                        onClick={() => removeClip(clip.id)}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {orderSuggestion ? (
            <div className="mt-4 rounded-lg border border-[#ded7cb] bg-[#fffdf8] p-4">
              <div className="rounded-lg bg-white px-4 py-3">
                <p className="text-sm font-black text-[#2b2925]">
                  {orderSuggestion.summary}
                </p>
                <p className="mt-1 text-xs font-semibold leading-5 text-[#6b655c]">
                  확신도: {orderSuggestion.confidence} ·{" "}
                  {orderSuggestion.spellingNote}
                </p>
              </div>
              <div className="mt-3 space-y-2">
                {orderSuggestion.items.map((item) => {
                  const clip = clips.find(
                    (currentClip) => currentClip.id === item.clipId,
                  );

                  return (
                    <div
                      key={item.clipId}
                      className="rounded-lg border border-[#eee7dd] bg-white px-4 py-3"
                    >
                      <p className="truncate text-sm font-black">
                        {item.order}. {clip?.file.name ?? "알 수 없는 영상"}
                      </p>
                      <p className="mt-1 text-xs font-bold text-[#e74032]">
                        {item.role} · 확신도 {item.confidence}%
                      </p>
                      <p className="mt-2 text-xs font-semibold leading-5 text-[#4a453c]">
                        {item.reason}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  className="min-h-11 rounded-lg bg-[#e74032] px-4 text-sm font-black text-white transition hover:bg-[#c84d42] disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
                  disabled={isBusy}
                  onClick={applyOrderSuggestion}
                >
                  추천 순서 적용
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-lg border border-[#ded7cb] px-4 text-sm font-black text-[#2b2925] transition hover:border-[#e74032] disabled:cursor-not-allowed disabled:text-[#b8afa4]"
                  disabled={isBusy}
                  onClick={() => setOrderSuggestion(null)}
                >
                  추천 지우기
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="p-5">
          <div>
            <p className="text-sm font-black text-[#2b2925]">출력 설정</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(Object.keys(outputFormats) as OutputFormatId[]).map((formatId) => {
                const format = outputFormats[formatId];

                return (
                  <button
                    key={formatId}
                    type="button"
                    aria-pressed={outputFormat === formatId}
                    className={`min-h-14 rounded-lg border px-4 text-left transition ${
                      outputFormat === formatId
                        ? "border-[#e74032] bg-[#e74032] text-white"
                        : "border-[#ded7cb] bg-[#fffdf8] text-[#2b2925] hover:border-[#e74032]"
                    }`}
                    disabled={isBusy}
                    onClick={() => {
                      setOutputFormat(formatId);
                      clearMergedOutput();
                    }}
                  >
                    <span className="block text-sm font-black">
                      {format.label}
                    </span>
                    <span className="mt-1 block text-xs font-bold opacity-80">
                      {format.description}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-black text-[#6b655c]">
                  목표 길이(초)
                </span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={targetSeconds}
                  placeholder={totalSeconds ? String(Math.round(totalSeconds)) : "자동"}
                  className="mt-2 min-h-11 w-full rounded-lg border border-[#ded7cb] bg-white px-3 text-sm font-bold outline-none focus:border-[#e74032]"
                  disabled={isBusy}
                  onChange={(event) => {
                    setTargetSeconds(event.target.value);
                    clearMergedOutput();
                  }}
                />
              </label>
              <label className="block">
                <span className="text-xs font-black text-[#6b655c]">
                  화면 맞춤
                </span>
                <select
                  className="mt-2 min-h-11 w-full rounded-lg border border-[#ded7cb] bg-white px-3 text-sm font-bold outline-none focus:border-[#e74032]"
                  value={fitMode}
                  disabled={isBusy}
                  onChange={(event) => {
                    setFitMode(event.target.value as FitMode);
                    clearMergedOutput();
                  }}
                >
                  <option value="contain">전체 보이게</option>
                  <option value="cover">화면 꽉 차게</option>
                </select>
              </label>
            </div>
          </div>

          {clips.length > 0 ? (
            <div className="mt-5 rounded-lg border border-[#ded7cb] bg-[#fffdf8] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-start gap-3 text-sm font-bold text-[#4a453c]">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[#e74032]"
                    checked={includeKoreanSubtitles}
                    disabled={isBusy}
                    onChange={(event) => {
                      setIncludeKoreanSubtitles(event.target.checked);
                      clearMergedOutput();
                    }}
                  />
                  <span>
                    한국어 자막
                    <span className="mt-1 block text-xs font-semibold leading-5 text-[#6b655c]">
                      {subtitleCueCount > 0
                        ? `${subtitleCueCount}개 문장 준비됨`
                        : "영어 음성 기준"}
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  className="min-h-11 rounded-lg bg-[#111111] px-4 text-sm font-black text-white transition hover:bg-[#2b2925] disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
                  disabled={isBusy}
                  onClick={() => void generateKoreanSubtitles()}
                >
                  {isGeneratingSubtitles ? "생성 중" : "자막 생성"}
                </button>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            className="mt-5 min-h-12 w-full rounded-lg bg-[#e74032] px-5 text-sm font-black text-white transition hover:bg-[#c84d42] disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
            disabled={clips.length === 0 || isBusy}
            onClick={() => void renderMergedVideo()}
          >
            {isRendering ? "이어붙이는 중..." : "3. 영상 이어붙이기"}
          </button>

          {progress ? (
            <p className="mt-3 rounded-lg bg-[#f6f3ec] px-4 py-3 text-sm font-black text-[#5c574f]">
              {progress}
            </p>
          ) : null}

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
              <p className="mt-1 text-xs font-semibold leading-5">
                {message.body}
              </p>
            </div>
          ) : null}

          {mergedUrl ? (
            <div className="mt-4 rounded-lg border border-[#ded7cb] bg-[#fffdf8] p-4">
              <video
                src={mergedUrl}
                controls
                className={`mx-auto ${selectedFormat.previewClass} max-h-[30rem] rounded-lg bg-black`}
              />
              <a
                href={mergedUrl}
                download={`dokgotak-merged-${outputFormat}.${mergedExtension}`}
                className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#ffcf3f] px-5 text-sm font-black text-[#111111] transition hover:bg-[#ffe07b]"
              >
                이어붙인 영상 다운로드
              </a>
            </div>
          ) : null}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={selectedFormat.width}
        height={selectedFormat.height}
        className="hidden"
      />
    </section>
  );
}
