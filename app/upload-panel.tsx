"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import VideoProductionPanel from "./video-production-panel";
import {
  extractBrandMoodRules,
  extractManualSceneVisuals,
  extractManualStyleDirections,
  splitManualScriptLines,
} from "./lib/manual-script";
import {
  durations,
  uploadChunkSize,
  videoFormats,
  type VideoFormatId,
} from "./lib/studio-config";
import { getRequestApiKey } from "./lib/browser-api-keys";

type UploadFile = {
  id: string;
  file: File;
};

const acceptedTypes = ["image/", "application/pdf"];
function isAccepted(file: File) {
  return acceptedTypes.some((type) => file.type.startsWith(type));
}

function formatSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))}KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function buildScriptOnlyAnalysis(options: {
  scriptLines: string[];
  sceneVisuals: string[];
  styleDirections: string[];
  brandMoodRules: string[];
  duration: string;
  videoFormat: VideoFormatId;
}) {
  const formatLabel =
    videoFormats.find((format) => format.id === options.videoFormat)?.label ??
    "세로형 9:16";

  return [
    "SOURCE: USER_SCRIPT_ONLY",
    "NO_REFERENCE_PRODUCT_IMAGE: true",
    "",
    "한글 대본 기반 제작 규칙",
    `- 영상 길이: ${options.duration}`,
    `- 영상 비율: ${formatLabel}`,
    "- 제품 이미지/PDF가 없으므로 제품 형태, 로고, 패키지, 효능, 인증, 가격을 임의로 만들지 않는다.",
    "- 사용자가 입력한 한글 대본만 실제 메시지와 나레이션의 근거로 사용한다.",
    "- 이미지가 필요하면 대본 분위기에 맞는 고급 광고 배경과 라이프스타일 장면으로 만든다.",
    "- 이미지 안에는 한글/영어 문구를 직접 넣지 않고, 영상 렌더러가 한글 폰트로 합성한다.",
    "- 콜라쥬, 여러 사진을 붙인 화면, 상세페이지 캡처형 이미지를 만들지 않는다.",
    "",
    "영상 스타일 디렉션",
    ...(options.styleDirections.length > 0
      ? options.styleDirections.map((line, index) => `${index + 1}. ${line}`)
      : ["- 사용자가 입력한 대본의 분위기를 따른다."]),
    "",
    "브랜드/무드 사용 규칙",
    ...(options.brandMoodRules.length > 0
      ? options.brandMoodRules.map((line, index) => `${index + 1}. ${line}`)
      : ["- 실제 브랜드 로고나 상표를 임의로 만들지 않는다."]),
    "",
    "장면별 화면 지시",
    ...(options.sceneVisuals.length > 0
      ? options.sceneVisuals.map((visual, index) => `${index + 1}. ${visual}`)
      : ["- 입력한 장면표가 없으므로 대본의 감정 흐름에 맞춰 장면을 구성한다."]),
    "",
    "사용자 입력 대본",
    ...options.scriptLines.map((line, index) => `${index + 1}. ${line}`),
  ].join("\n");
}

function getRequestErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("Failed to fetch")) {
    return "로컬 서버 연결이 중간에 끊겼습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.";
  }

  return (
    message ||
    "파일 업로드 또는 로컬 서버 처리 중 문제가 발생했습니다. 파일 용량을 줄이거나 다시 시도해주세요."
  );
}

export default function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [manualScript, setManualScript] = useState("");
  const [duration, setDuration] = useState(durations[0]);
  const [videoFormat, setVideoFormat] = useState<VideoFormatId>("vertical");
  const [isDragging, setIsDragging] = useState(false);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [analysisResult, setAnalysisResult] = useState("");
  const [analysisMessage, setAnalysisMessage] = useState<{
    tone: "success" | "warning" | "error";
    title: string;
    body: string;
  } | null>(null);
  const manualScriptLines = splitManualScriptLines(manualScript);
  const manualSceneVisuals = extractManualSceneVisuals(manualScript);
  const manualStyleDirections = extractManualStyleDirections(manualScript);
  const manualBrandMoodRules = extractBrandMoodRules(manualScript);
  const canStart = files.length > 0 || manualScriptLines.length > 0;

  const counts = useMemo(() => {
    return files.reduce(
      (result, item) => {
        if (item.file.type === "application/pdf") {
          result.pdf += 1;
        } else {
          result.image += 1;
        }
        return result;
      },
      { image: 0, pdf: 0 },
    );
  }, [files]);

  const addFiles = (incomingFiles: FileList | File[]) => {
    const nextFiles = Array.from(incomingFiles);
    const accepted = nextFiles.filter(isAccepted);
    const rejected = nextFiles.length - accepted.length;

    setRejectedCount(rejected);
    setAnalysisMessage(null);
    setAnalysisResult("");
    setFiles((current) => [
      ...current,
      ...accepted.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
      })),
    ]);
  };

  const uploadFileChunks = async (sessionId: string) => {
    let uploadedChunks = 0;
    const totalChunks = files.reduce(
      (sum, item) => sum + Math.ceil(item.file.size / uploadChunkSize),
      0,
    );

    for (const item of files) {
      const fileTotalChunks = Math.ceil(item.file.size / uploadChunkSize);

      for (let chunkIndex = 0; chunkIndex < fileTotalChunks; chunkIndex += 1) {
        const start = chunkIndex * uploadChunkSize;
        const end = Math.min(start + uploadChunkSize, item.file.size);
        const chunk = item.file.slice(start, end, item.file.type);
        const formData = new FormData();

        formData.append("sessionId", sessionId);
        formData.append("fileId", item.id);
        formData.append("fileName", item.file.name);
        formData.append("fileType", item.file.type);
        formData.append("fileSize", String(item.file.size));
        formData.append("chunkIndex", String(chunkIndex));
        formData.append("totalChunks", String(fileTotalChunks));
        formData.append("chunk", chunk, item.file.name);

        const response = await fetch("/api/upload-chunk", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            response.status === 413
              ? "파일 조각이 서버 제한보다 큽니다. 더 작은 파일로 다시 시도해주세요."
              : text || "파일 업로드 중 오류가 발생했습니다.",
          );
        }

        uploadedChunks += 1;
        setUploadProgress(
          `파일 업로드 중 ${uploadedChunks}/${totalChunks} 조각 완료`,
        );
      }
    }
  };

  const getOpenAiKey = () => {
    return getRequestApiKey("openai");
  };

  const handleAnalyzeClick = async () => {
    if (files.length === 0 && manualScriptLines.length > 0) {
      setAnalysisResult(
        buildScriptOnlyAnalysis({
          scriptLines: manualScriptLines,
          sceneVisuals: manualSceneVisuals,
          styleDirections: manualStyleDirections,
          brandMoodRules: manualBrandMoodRules,
          duration,
          videoFormat,
        }),
      );
      setUploadProgress("");
      setAnalysisMessage({
        tone: "success",
        title: "한글 대본으로 시작합니다.",
        body: "이미지/PDF 없이 사용자가 입력한 한글 대본만으로 영상 제작 단계로 넘어갑니다.",
      });
      return;
    }

    if (!canStart) {
      setAnalysisMessage({
        tone: "warning",
        title: "파일 또는 한글 대본이 필요합니다.",
        body: "제품 이미지/PDF를 넣거나 한글 대본을 한 줄 이상 입력해주세요.",
      });
      return;
    }

    const openAiKey = getOpenAiKey();
    if (!openAiKey) {
      setAnalysisMessage({
        tone: "warning",
        title: "OpenAI API 키가 필요합니다.",
        body: "우측 상단 API 설정에서 OpenAI API 키를 저장한 뒤 다시 눌러주세요.",
      });
      return;
    }

    setIsAnalyzing(true);
    setUploadProgress("");
    setAnalysisResult("");
    setAnalysisMessage({
      tone: "success",
      title: "파일 업로드를 시작했습니다.",
      body: "이미지와 PDF를 처리할 수 있도록 작은 조각으로 나눠 업로드합니다.",
    });

    try {
      const sessionId = crypto.randomUUID();
      await uploadFileChunks(sessionId);

      setAnalysisMessage({
        tone: "success",
        title: "OpenAI 분석을 시작했습니다.",
        body: `${files.length}개 파일 업로드가 끝났습니다. PDF 페이지 수에 따라 시간이 걸릴 수 있습니다.`,
      });

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          openaiApiKey: openAiKey,
          sessionId,
          files: files.map((item) => ({
            fileId: item.id,
            fileName: item.file.name,
            fileType: item.file.type,
            fileSize: item.file.size,
            totalChunks: Math.ceil(item.file.size / uploadChunkSize),
          })),
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        analysis?: string;
        message?: string;
      };

      if (!response.ok || !result.ok) {
        setAnalysisMessage({
          tone: "error",
          title: "분석에 실패했습니다.",
          body: result.message ?? "OpenAI 분석 요청이 실패했습니다.",
        });
        return;
      }

      setAnalysisResult(result.analysis ?? "");
      setAnalysisMessage({
        tone: "success",
        title: "분석이 완료되었습니다.",
        body: "아래 결과를 확인하고 쇼츠 대본, 자막, 썸네일 문구를 바로 사용할 수 있습니다.",
      });
    } catch (error) {
      setAnalysisMessage({
        tone: "error",
        title: "분석 요청을 보낼 수 없습니다.",
        body: getRequestErrorMessage(error),
      });
    } finally {
      setIsAnalyzing(false);
      setUploadProgress("");
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      addFiles(event.target.files);
    }
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  };

  return (
    <section
      id="upload"
      className="rounded-lg border border-white/20 bg-white/95 p-5 text-[#161616] shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur lg:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black text-[#e74032]">파일 넣기</p>
          <h2 className="mt-2 text-2xl font-black leading-tight">
            상세페이지 이미지와 PDF를 여기에 올립니다.
          </h2>
        </div>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#ffcf3f] text-xl font-black">
          +
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
      <div className="rounded-lg border border-[#ded7cb] bg-[#fffdf8] p-4">
        <p className="text-sm font-black text-[#e74032]">1. 영상 설정</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-black text-[#6b655c]">
              몇 초짜리 영상인가요?
            </span>
            <select
              className="mt-2 min-h-11 w-full rounded-lg border border-[#ded7cb] bg-white px-3 text-sm font-bold outline-none focus:border-[#e74032]"
              value={duration}
              onChange={(event) => {
                setDuration(event.target.value);
                setAnalysisResult("");
                setAnalysisMessage(null);
              }}
            >
              {durations.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="text-xs font-black text-[#6b655c]">
              가로형/세로형 선택
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {videoFormats.map((format) => (
                <button
                  key={format.id}
                  type="button"
                  className={`min-h-11 rounded-lg border px-3 text-left transition ${
                    videoFormat === format.id
                      ? "border-[#e74032] bg-[#e74032] text-white"
                      : "border-[#ded7cb] bg-white text-[#4a453c] hover:border-[#e74032]"
                  }`}
                  onClick={() => {
                    setVideoFormat(format.id);
                    setAnalysisResult("");
                    setAnalysisMessage(null);
                  }}
                >
                  <span className="block text-sm font-black">
                    {format.label}
                  </span>
                  <span className="mt-1 block text-[0.68rem] font-bold opacity-80">
                    {format.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs font-semibold leading-5 text-[#6b655c]">
          이 설정을 기준으로 AI가 장면 수, 컷 길이, 대본 문장 길이와 이미지 비율을 맞춥니다.
        </p>
      </div>

      <div
        className={`rounded-lg border-2 border-dashed p-5 text-center transition ${
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
          className="sr-only"
          accept="image/*,application/pdf"
          multiple
          onChange={handleInputChange}
        />
        <p className="text-sm font-black text-[#e74032]">
          2. 제품 이미지/PDF 넣기
        </p>
        <p className="text-base font-black">파일을 끌어다 놓거나</p>
        <button
          type="button"
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#111111] px-5 text-sm font-bold text-white transition hover:bg-[#2b2925]"
          onClick={() => inputRef.current?.click()}
        >
          파일 선택
        </button>
        <p className="mt-3 text-sm leading-6 text-[#6b655c]">
          JPG, PNG, WebP 같은 이미지와 PDF를 여러 개 넣을 수 있습니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-[#f6f3ec] px-4 py-3">
          <p className="text-xs font-bold text-[#6b655c]">이미지</p>
          <p className="mt-1 text-2xl font-black">{counts.image}</p>
        </div>
        <div className="rounded-lg bg-[#f6f3ec] px-4 py-3">
          <p className="text-xs font-bold text-[#6b655c]">PDF</p>
          <p className="mt-1 text-2xl font-black">{counts.pdf}</p>
        </div>
      </div>

        </div>

        <div className="space-y-4">
      <div className="rounded-lg border border-[#ded7cb] bg-[#fffdf8] p-4">
        <label className="block">
          <span className="text-sm font-black text-[#e74032]">
            3. 한글 대본 넣기
          </span>
          <span className="mt-2 block text-sm font-bold text-[#2b2925]">
            이미지가 없어도 한글 대본만으로 영상 제작안을 만들 수 있습니다.
          </span>
          <textarea
            className="mt-3 min-h-36 w-full resize-y rounded-lg border border-[#ded7cb] bg-white px-3 py-3 text-sm font-semibold leading-6 text-[#2b2925] outline-none focus:border-[#e74032]"
            placeholder={"한 줄에 한 문장씩 입력하세요.\n예: 다이어트가 매번 힘드셨나요?\n하루 2캡슐로 가볍게 시작하세요.\n지금 바로 확인해보세요."}
            value={manualScript}
            onChange={(event) => {
              setManualScript(event.target.value);
              setAnalysisResult("");
              setAnalysisMessage(null);
            }}
          />
        </label>
        <p className="mt-2 text-xs font-bold leading-5 text-[#6b655c]">
          {manualScriptLines.length > 0
            ? `${manualScriptLines.length}줄 대본 추출 · ${manualSceneVisuals.length}개 화면 지시 · ${manualStyleDirections.length}개 스타일 지시 감지`
            : "긴 기획문을 붙여넣으면 '실제 쇼츠 대본' 또는 '완성 대본' 아래 문장만 실제 나레이션으로 사용합니다."}
        </p>
      </div>

      {rejectedCount > 0 ? (
        <p className="rounded-lg bg-[#fff2ee] px-4 py-3 text-sm font-semibold text-[#b42a20]">
          지원하지 않는 파일 {rejectedCount}개는 제외했습니다.
        </p>
      ) : null}

      {files.length > 0 ? (
        <div className="max-h-44 overflow-auto rounded-lg border border-[#e8e0d4] bg-white">
          {files.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 border-b border-[#eee7dd] px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{item.file.name}</p>
                <p className="mt-1 text-xs text-[#6b655c]">
                  {item.file.type === "application/pdf" ? "PDF" : "이미지"} ·{" "}
                  {formatSize(item.file.size)}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg border border-[#ded7cb] px-3 py-2 text-xs font-bold text-[#5c574f] transition hover:border-[#e74032] hover:text-[#e74032]"
                onClick={() => {
                  setAnalysisMessage(null);
                  setAnalysisResult("");
                  setFiles((current) =>
                    current.filter((file) => file.id !== item.id),
                  );
                }}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <p className="rounded-lg bg-[#f6f3ec] px-4 py-3 text-xs font-bold leading-5 text-[#5c574f]">
        4. 파일이 있으면 AI가 제품을 분석하고, 파일이 없으면 한글 대본만으로 영상 제작 단계로 넘어갑니다.
      </p>

      <button
        type="button"
        className="min-h-12 w-full rounded-lg bg-[#e74032] px-5 text-sm font-black text-white transition disabled:cursor-not-allowed disabled:bg-[#c9c0b4]"
        disabled={!canStart || isAnalyzing}
        onClick={handleAnalyzeClick}
      >
        {isAnalyzing
          ? "분석 중..."
          : files.length > 0
            ? "분석 시작"
            : manualScriptLines.length > 0
              ? "한글 대본으로 시작"
              : "파일 또는 한글 대본을 넣어주세요"}
      </button>
      {analysisMessage ? (
        <div
          className={`rounded-lg px-4 py-3 ${
            analysisMessage.tone === "success"
              ? "bg-[#e8fff9] text-[#126252]"
              : analysisMessage.tone === "warning"
                ? "bg-[#fff8e7] text-[#7c5611]"
                : "bg-[#fff2ee] text-[#b42a20]"
          }`}
        >
          <p className="text-sm font-black">{analysisMessage.title}</p>
          <p className="mt-1 text-xs font-semibold leading-5">
            {analysisMessage.body}
          </p>
        </div>
      ) : null}
      {uploadProgress ? (
        <p className="rounded-lg bg-[#f6f3ec] px-4 py-3 text-sm font-black text-[#5c574f]">
          {uploadProgress}
        </p>
      ) : null}
          <p className="text-xs leading-5 text-[#6b655c]">
            파일이 있을 때만 선택한 파일과 OpenAI API 키가 로컬 서버를 통해 OpenAI
            Responses API로 전송됩니다. 파일 없이 한글 대본만 넣으면 분석 API를
            호출하지 않습니다.
          </p>
        </div>
      </div>
      {analysisResult ? (
        <>
          <div className="mt-5 rounded-lg border border-[#ded7cb] bg-white">
          <div className="border-b border-[#eee7dd] px-4 py-3">
            <p className="text-sm font-black text-[#126252]">
                분석 결과 패키지
            </p>
            </div>
            <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words px-4 py-4 text-sm font-semibold leading-7 text-[#2b2925]">
              {analysisResult}
            </pre>
          </div>
          <VideoProductionPanel
            analysisResult={analysisResult}
            sourceFiles={files.map((item) => item.file)}
            initialDuration={duration}
            initialVideoFormat={videoFormat}
            initialScriptMode={manualScriptLines.length > 0 ? "manual" : "ai"}
            initialManualScript={manualScript}
          />
        </>
      ) : null}
    </section>
  );
}


