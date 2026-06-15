import { resolveOpenAiApiKey } from "../local-api-keys";

type ProductionPayload = {
  openaiApiKey?: string;
  analysis?: string;
  scriptType?: string;
  duration?: string;
  voiceGender?: string;
  voiceStyle?: string;
  videoFormat?: string;
  includeIntroImage?: boolean;
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
      ? "OpenAI API 키가 올바르지 않거나 권한이 없습니다."
      : `OpenAI API 오류가 발생했습니다. 상태 코드: ${status}`;

  if (typeof data !== "object" || data === null) {
    return fallback;
  }

  const error = (data as { error?: { message?: string } }).error;
  return error?.message ?? fallback;
}

function buildPrompt(options: Required<Omit<ProductionPayload, "openaiApiKey">>) {
  const introInstruction = options.includeIntroImage
    ? `인트로 후킹 이미지 규칙:
- 본편 1컷 앞에 1~3초짜리 강력한 인트로 후킹 이미지를 별도로 설계한다.
- 인트로는 "썸네일"이 아니라 실제 영상 첫 장면처럼 보이되, 일반 장면보다 대비, 감정, 구도가 강해야 한다.
- 인트로 카피는 고객이 즉시 멈출 수 있는 한국어 12~18자 메인 문장과 짧은 보조 문장으로 만든다.
- 인트로 이미지도 한 장의 자연스러운 단일 이미지이며, 이미지 안에 글자는 넣지 않는다.
- 이미지 장면 수 N은 본편 장면 수를 의미하고, 인트로는 별도 추가 컷으로 취급한다.`
    : "인트로 후킹 이미지는 사용하지 않는다. 본편 1컷부터 바로 시작한다.";

  return `아래 분석 결과를 바탕으로 실제 쇼츠 영상 제작을 시작할 수 있는 최고의 제작 지시서를 만들어라.

독고탁 스튜디오 제작 철학:
- 대본을 예쁘게 정리하는 것이 아니라 촬영감독이 바로 만들 수 있는 결정서로 바꾼다.
- 사용자의 의도를 먼저 읽고 감정 흐름, 시간, 장면, 자막, 이미지 지시를 결정한다.
- 이미지는 대본의 뜻을 보여주며, 한글 문구는 이미지 안에 만들지 않고 영상 렌더러가 합성한다.
- 사용자가 쓰지 않은 제품 효능, 가격, 인증, 실제 브랜드 로고는 임의로 만들지 않는다.
- 최종 결과물에는 내부 단계명이 아니라 고객에게 보이는 한국어 문장만 남긴다.

독고탁 에이젼시 카드뉴스 이미지 철학:
- 카드뉴스는 상세페이지를 여러 장으로 나눈 것이 아니라 짧은 구매전환 콘텐츠다.
- 읽는 콘텐츠가 아니라 넘기는 콘텐츠이므로 모바일에서 1~2초 안에 이해되어야 한다.
- 한 장면에는 하나의 메시지, 하나의 주인공, 하나의 감정만 담는다.
- 크게 말하고, 적게 설명하고, 여백으로 설득한다.
- 이미지 안에 글자를 만들지 않고, 나중에 한글 자막이 올라갈 고급 여백을 설계한다.
- 평범한 자료 사진이 아니라 조명, 구도, 렌즈감, 배경 깊이가 있는 프리미엄 카드뉴스 컷으로 만든다.
- 대본의 추상 문장을 실제로 보이는 상징, 장소, 행동, 표정, 소품으로 번역한다.
- 각 장면은 배경, 거리, 색감, 조명, 인물 동작이 달라야 한다.

선택한 제작 방향:
- 대본 타입: ${options.scriptType}
- 영상 길이: ${options.duration}
- 음성 톤: ${options.voiceStyle}
- 영상 비율: ${options.videoFormat}
- 인트로 후킹 이미지: ${options.includeIntroImage ? "사용" : "미사용"}

${introInstruction}

분석 결과:
${options.analysis}

장면 수 결정 규칙:
- 무조건 6장으로 만들지 않는다.
- 선택한 영상 길이, 대본 호흡, 제품 복잡도, 필요한 시각 변화량을 보고 이미지 장면 수를 결정한다.
- 권장 범위: 15초 = 3~6장, 30초 = 5~10장, 60초 = 7~12장.
- 사용자가 장면별 화면 지시를 명확히 준 경우 그 장면 수를 우선한다.
- 선택한 장면 수를 지시서 맨 위에 "이미지 장면 수: N" 형식으로 적는다.
- 각 장면은 "장면별 화면 설계", "장면별 제작표", "장면별 자막 카피", "이미지 생성 지시서"에 같은 번호로 모두 존재해야 한다.
- 인트로 후킹 이미지를 사용하는 경우, 본편 장면 번호와 섞지 말고 "인트로 후킹 카피"와 "인트로 이미지 생성 지시"를 별도 항목으로 쓴다.

대본 해석 규칙:
- 장면을 만들기 전에 반드시 "대본 해석 리포트"를 먼저 작성한다.
- 주인공, 고객 문제, 감정 흐름, 핵심 전환점, 해결책 역할, CTA를 명확히 분리한다.
- 대본의 진짜 판매 포인트를 한 문장으로 정리한다.
- 영상에서 반드시 보여줄 것과 만들면 안 되는 것을 분리한다.
- 장면은 대본 문장 순서 복사가 아니라 광고 구조에 맞게 재구성한다.
- 30초 영상은 보통 7~8개 핵심 장면으로 압축한다. 문장이 많다고 장면을 무작정 늘리지 않는다.
- 같은 사무실 인물, 같은 로봇, 같은 대시보드 이미지를 반복하지 않는다.

제작 규칙:
- 한국어만 사용한다.
- 실제 제품 사실을 바꾸거나 과장하지 않는다.
- 영상 제작자가 바로 편집할 수 있게 시간, 화면, 나레이션, 자막, 이미지 지시를 컷 단위로 쓴다.
- 음성 제작용 나레이션 문장을 따로 제공한다.
- 이미지 생성 지시서는 실제 제품 이미지를 유지하고 배경, 분위기, 구도만 연출한다는 조건을 포함한다.
- 아직 실제 영상 파일을 생성하는 단계가 아니라 제작 지시서 단계임을 전제로 한다.
- 실제 영상 편집 캔버스에는 로고, 브랜드 UI, 별도 자막 레이어, 내부 제작 지시문을 표시하지 않는다.
- 각 장면의 고객용 카피는 영상 렌더러가 카드뉴스처럼 안전하게 후처리로 올릴 수 있게 작성한다.
- 내부 단계명, 제작 메모, 영어 라벨은 실제 영상 화면에 절대 표시하지 않는다.
- 장면 이미지는 한 장면 안에 여러 사진을 붙인 콜라쥬가 아니라 하나의 자연스러운 단일 이미지로 기획한다.
- 장면별 자막 카피는 고객에게 보이는 문장으로 작성한다.
- 이미지 카피는 한 장면당 메인 카피 1개와 짧은 보조 카피 1개까지만 허용한다.
- 이미지 카피는 상세페이지 설명문이 아니라 프리미엄 카드뉴스처럼 짧고 크게 읽히는 말투로 작성한다.
- 이미지 안에는 한글, 영어, 숫자, 버튼, 가격표, 설명 박스를 직접 만들지 않는다.

반드시 아래 형식으로 출력하라.

제작 기준: AI 분석 기반
이미지 장면 수: N
인트로 후킹 이미지: ${options.includeIntroImage ? "사용" : "미사용"}

0. 독고탁 스튜디오 제작 철학
1. 대본 해석 리포트
   - 주인공:
   - 고객 문제:
   - 감정 흐름:
   - 핵심 전환점:
   - 해결책 역할:
   - CTA:
   - 영상에서 반드시 보여줄 것:
   - 만들면 안 되는 것:
2. 광고 전략 재구성
   - 핵심 의도:
   - 30초 광고 구조:
   - 장면 설계 원칙:
3. 최종 나레이션 원문
4. 장면별 화면 설계
   - 1컷: 실제 이미지로 만들 화면을 구체적으로 작성
5. 장면별 제작표
   - 1컷 | 0-3초 | 역할=... | 화면=... | 나레이션=... | 자막=...
6. 장면별 자막 카피
   - 1컷: 메인=고객에게 보이는 짧은 문장 / 보조=짧은 보조 문장
7. 인트로 후킹 카피
   - 인트로: 메인=12~18자 강력한 후킹 문장 / 보조=짧은 보조 문장
8. 인트로 이미지 생성 지시
   - 인트로: 메시지=... / 주인공과 장면=... / 배경=... / 조명=강한 대비 / 구도=첫 1초에 멈추게 하는 프리미엄 광고 컷 / 여백=한글 자막 합성 공간 확보 / 금지=콜라쥬, 이미지 속 글자
9. 이미지 생성 지시서
   - 1컷: 메시지=... / 주인공과 장면=... / 배경=... / 조명=... / 구도=... / 여백=... / 금지=...
10. 스타일 및 사운드 방향
11. 브랜드/무드 사용 규칙
12. 금지 규칙
13. 최종 렌더 지시
14. 시간 배치 참고`;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ProductionPayload;
    const openaiApiKey = await resolveOpenAiApiKey(payload.openaiApiKey);
    const analysis = payload.analysis?.trim();
    const scriptType = payload.scriptType?.trim() || "판매전환형";
    const duration = payload.duration?.trim() || "15초";
    const voiceStyle = payload.voiceStyle?.trim() || "밝은 쇼호스트톤";
    const voiceGender = payload.voiceGender?.trim() || "여성";
    const includeIntroImage = payload.includeIntroImage !== false;
    const videoFormat =
      payload.videoFormat === "horizontal" ? "가로형 16:9" : "세로형 9:16";

    if (!openaiApiKey) {
      return Response.json(
        { ok: false, message: "OpenAI API 키를 먼저 저장해주세요." },
        { status: 400 },
      );
    }

    if (!analysis) {
      return Response.json(
        { ok: false, message: "분석 결과가 필요합니다. 먼저 제품 분석을 실행해주세요." },
        { status: 400 },
      );
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        store: false,
        max_output_tokens: 4000,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildPrompt({
                  analysis,
                  scriptType,
                  duration,
                  voiceGender,
                  voiceStyle: `${voiceGender} / ${voiceStyle}`,
                  videoFormat,
                  includeIntroImage,
                }),
              },
            ],
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

    const productionPlan = extractOutputText(data);
    if (!productionPlan) {
      return Response.json(
        { ok: false, message: "영상 제작안 결과를 찾지 못했습니다." },
        { status: 500 },
      );
    }

    return Response.json({
      ok: true,
      productionPlan,
    });
  } catch {
    return Response.json(
      { ok: false, message: "영상 제작안 생성 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
