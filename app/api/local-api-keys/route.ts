import {
  clearStoredApiKey,
  getStoredApiKeyStatuses,
  saveStoredApiKey,
  type ApiKeyProvider,
} from "../local-api-keys";

type LocalApiKeyPayload = {
  provider?: ApiKeyProvider;
  apiKey?: string;
  action?: "save" | "clear";
};

function isProvider(value: unknown): value is ApiKeyProvider {
  return value === "openai" || value === "typecast";
}

export async function GET() {
  return Response.json({
    ok: true,
    keys: await getStoredApiKeyStatuses(),
  });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as LocalApiKeyPayload;
    const provider = payload.provider;
    const action = payload.action ?? "save";
    const apiKey = payload.apiKey?.trim() ?? "";

    if (!isProvider(provider)) {
      return Response.json(
        { ok: false, message: "지원하지 않는 API 제공자입니다." },
        { status: 400 },
      );
    }

    if (action === "clear") {
      await clearStoredApiKey(provider);

      return Response.json({
        ok: true,
        message: "API 키를 삭제했습니다.",
        keys: await getStoredApiKeyStatuses(),
      });
    }

    if (!apiKey) {
      return Response.json(
        { ok: false, message: "API 키를 입력해주세요." },
        { status: 400 },
      );
    }

    await saveStoredApiKey(provider, apiKey);
    const keys = await getStoredApiKeyStatuses();

    if (!keys[provider].saved) {
      return Response.json(
        {
          ok: false,
          message:
            "API 키를 저장했지만 다시 확인할 수 없습니다. 로컬 저장 권한을 확인해주세요.",
        },
        { status: 500 },
      );
    }

    return Response.json({
      ok: true,
      message: "API 키를 로컬 설정에 저장했습니다.",
      keys,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? `API 키 저장 중 오류가 발생했습니다: ${error.message}`
            : "API 키 저장 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
