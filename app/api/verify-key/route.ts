import { getStoredApiKey } from "../local-api-keys";

type Provider = "openai" | "typecast";

type VerifyPayload = {
  provider?: Provider;
  apiKey?: string;
};

function getErrorMessage(status: number, provider: Provider) {
  if (status === 401 || status === 403) {
    return "키가 올바르지 않거나 권한이 없습니다.";
  }

  if (status === 429) {
    return "요청 제한에 걸렸습니다. 키 형식은 맞을 수 있으니 잠시 후 다시 확인해주세요.";
  }

  return `${provider === "openai" ? "OpenAI" : "Typecast"} 응답 오류: ${status}`;
}

async function verifyOpenAi(apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  return {
    ok: response.ok,
    message: response.ok
      ? "OpenAI 연결 확인 완료"
      : getErrorMessage(response.status, "openai"),
  };
}

async function verifyTypecast(apiKey: string) {
  const response = await fetch("https://api.typecast.ai/v1/voices", {
    headers: {
      "X-API-KEY": apiKey,
    },
  });

  return {
    ok: response.ok,
    message: response.ok
      ? "Typecast 연결 확인 완료"
      : getErrorMessage(response.status, "typecast"),
  };
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as VerifyPayload;
    const provider = payload.provider;
    const apiKey =
      payload.apiKey?.trim() ||
      (provider === "openai"
        ? await getStoredApiKey("openai")
        : provider === "typecast"
          ? await getStoredApiKey("typecast")
          : "");

    if (provider !== "openai" && provider !== "typecast") {
      return Response.json(
        { ok: false, message: "지원하지 않는 API 제공자입니다." },
        { status: 400 },
      );
    }

    if (!apiKey) {
      return Response.json(
        { ok: false, message: "API 키를 입력해주세요." },
        { status: 400 },
      );
    }

    const result =
      provider === "openai"
        ? await verifyOpenAi(apiKey)
        : await verifyTypecast(apiKey);

    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch {
    return Response.json(
      {
        ok: false,
        message: "연결 테스트 중 오류가 발생했습니다. 네트워크 상태를 확인해주세요.",
      },
      { status: 500 },
    );
  }
}
