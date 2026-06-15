import {
  clearUploadSession,
  getUploadedFiles,
  type StoredUploadFile,
  type UploadedFileMeta,
} from "../upload-store";
import { resolveOpenAiApiKey } from "../local-api-keys";

type OpenAiContent =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail: "auto";
    }
  | {
      type: "input_file";
      filename: string;
      file_data: string;
    };

type AnalyzePayload = {
  openaiApiKey?: string;
  sessionId?: string;
  files?: UploadedFileMeta[];
};

const maxTotalBytes = 50 * 1024 * 1024;
const supportedImageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function chunksToBase64(file: StoredUploadFile) {
  const orderedChunks = Array.from(file.chunks.entries())
    .sort(([left], [right]) => left - right)
    .map(([, chunk]) => chunk);

  if (typeof Buffer !== "undefined") {
    return Buffer.concat(orderedChunks.map((chunk) => Buffer.from(chunk))).toString(
      "base64",
    );
  }

  let binary = "";
  for (const chunk of orderedChunks) {
    const chunkSize = 0x8000;
    for (let index = 0; index < chunk.length; index += chunkSize) {
      binary += String.fromCharCode(...chunk.subarray(index, index + chunkSize));
    }
  }

  return btoa(binary);
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

function getOpenAiErrorMessage(status: number, data: unknown) {
  const fallback =
    status === 401 || status === 403
      ? "OpenAI API 키가 올바르지 않거나 권한이 없습니다."
      : `OpenAI API 오류가 발생했습니다. 상태 코드: ${status}`;

  if (typeof data !== "object" || data === null) {
    return fallback;
  }

  const error = (data as { error?: { message?: string } }).error;
  return error?.message ?? fallback;
}

function buildInstruction(fileNames: string[]) {
  return `너는 제품 설명을 요약하는 AI가 아니다.
너는 쿠팡과 스마트스토어 판매 전환을 높이는 한국어 쇼츠 대본 기획자다.

업로드된 제품 이미지와 PDF를 분석한 뒤, 보이는 정보와 자료에 있는 사실만 사용하라.
제품 스펙을 단순 나열하지 말고 고객이 왜 이 제품을 사야 하는지 설득하는 판매 대본으로 재구성하라.
첫 3초 안에 고객의 문제, 욕망, 상황을 건드려야 한다.
제품 특징은 반드시 고객 이익으로 바꿔 말하라.
근거 없는 과장, 허위 효능, 확인되지 않은 1위/최고/완벽/무조건/효과 보장 표현은 금지한다.
영상용이므로 짧고 말하기 쉽게 작성하고, 자막으로 봐도 이해되게 작성하라.

업로드 파일명:
${fileNames.map((name, index) => `${index + 1}. ${name}`).join("\n")}

반드시 아래 형식으로 한국어만 출력하라.

1. 제품 한 줄 요약
2. 타깃 고객
3. 핵심 구매 포인트 3-5개
4. 고객 망설임과 해결 문장
5. 판매전환형 15초 대본
6. 바이럴 쇼츠형 15초 대본
7. 신뢰 설명형 15초 대본
8. 자막용 문장 분리
9. Typecast 음성용 나레이션
10. 장면별 영상 구성
11. 이미지 생성 프롬프트
12. 썸네일 문구 5개
13. CTA 문구 5개
14. 확인 필요 정보`;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as AnalyzePayload;
    const apiKey = await resolveOpenAiApiKey(payload.openaiApiKey);
    const sessionId = payload.sessionId?.trim();
    const fileMetas = payload.files ?? [];

    if (!apiKey) {
      return Response.json(
        { ok: false, message: "OpenAI API 키를 먼저 저장해주세요." },
        { status: 400 },
      );
    }

    if (!sessionId || fileMetas.length === 0) {
      return Response.json(
        { ok: false, message: "분석할 이미지 또는 PDF 파일을 넣어주세요." },
        { status: 400 },
      );
    }

    const files = getUploadedFiles(sessionId, fileMetas);
    const totalBytes = files.reduce((sum, file) => sum + file.fileSize, 0);

    if (totalBytes > maxTotalBytes) {
      return Response.json(
        {
          ok: false,
          message: "한 번에 분석할 수 있는 파일 총량은 50MB 이하입니다.",
        },
        { status: 400 },
      );
    }

    const content: OpenAiContent[] = [
      {
        type: "input_text",
        text: buildInstruction(files.map((file) => file.fileName)),
      },
    ];

    for (const file of files) {
      const base64 = chunksToBase64(file);

      if (file.fileType === "application/pdf") {
        content.push({
          type: "input_file",
          filename: file.fileName,
          file_data: base64,
        });
        continue;
      }

      if (supportedImageTypes.has(file.fileType)) {
        content.push({
          type: "input_image",
          image_url: `data:${file.fileType};base64,${base64}`,
          detail: "auto",
        });
      }
    }

    if (content.length === 1) {
      return Response.json(
        {
          ok: false,
          message:
            "지원되는 파일이 없습니다. JPG, PNG, WebP, GIF 이미지 또는 PDF를 넣어주세요.",
        },
        { status: 400 },
      );
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        store: false,
        max_output_tokens: 5000,
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

    const analysis = extractOutputText(data);
    if (!analysis) {
      return Response.json(
        {
          ok: false,
          message: "OpenAI 응답에서 분석 결과를 찾지 못했습니다.",
        },
        { status: 500 },
      );
    }

    clearUploadSession(sessionId);

    return Response.json({
      ok: true,
      analysis,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "분석 중 오류가 발생했습니다. 파일과 네트워크 상태를 확인해주세요.";

    return Response.json(
      {
        ok: false,
        message,
      },
      { status: 500 },
    );
  }
}
