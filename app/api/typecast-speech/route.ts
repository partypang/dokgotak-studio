import { resolveTypecastApiKey } from "../local-api-keys";

type TypecastVoice = {
  voice_id?: string;
  voice_name?: string;
};

type TypecastSpeechPayload = {
  typecastApiKey?: string;
  text?: string;
  voiceGender?: "female" | "male" | "neutral";
  voiceStyle?: string;
};

function getVoiceListUrl(voiceGender?: TypecastSpeechPayload["voiceGender"]) {
  const params = new URLSearchParams({
    model: "ssfm-v21",
  });

  if (voiceGender === "female" || voiceGender === "male") {
    params.set("gender", voiceGender);
  }

  return `https://api.typecast.ai/v2/voices?${params.toString()}`;
}

function extractVoices(data: unknown): TypecastVoice[] {
  if (Array.isArray(data)) {
    return data as TypecastVoice[];
  }

  if (typeof data !== "object" || data === null) {
    return [];
  }

  const item = data as {
    result?: unknown;
    voices?: unknown;
    data?: unknown;
  };

  if (Array.isArray(item.result)) {
    return item.result as TypecastVoice[];
  }

  if (Array.isArray(item.voices)) {
    return item.voices as TypecastVoice[];
  }

  if (Array.isArray(item.data)) {
    return item.data as TypecastVoice[];
  }

  return [];
}

function getVoiceTempo(voiceStyle?: string) {
  const style = voiceStyle ?? "";

  if (style.includes("빠른")) {
    return 1.12;
  }

  if (style.includes("차분")) {
    return 0.94;
  }

  if (style.includes("감성") || style.includes("다큐")) {
    return 0.96;
  }

  if (style.includes("프리미엄")) {
    return 0.98;
  }

  if (style.includes("쇼호스트")) {
    return 1.05;
  }

  return 1;
}

function getTypecastErrorMessage(status: number, data: unknown) {
  const fallback =
    status === 401 || status === 403
      ? "Typecast API 키가 올바르지 않거나 권한이 없습니다."
      : `Typecast API 오류가 발생했습니다. 상태 코드: ${status}`;

  if (typeof data !== "object" || data === null) {
    return fallback;
  }

  const message = (data as { message?: string; error?: string }).message;
  const error = (data as { message?: string; error?: string }).error;
  return message ?? error ?? fallback;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as TypecastSpeechPayload;
    const apiKey = await resolveTypecastApiKey(payload.typecastApiKey);
    const rawText = payload.text?.trim() ?? "";
    const text = rawText.slice(0, 2000);
    const voiceGender = payload.voiceGender ?? "female";
    const voiceStyle = payload.voiceStyle?.trim() ?? "";

    if (!apiKey) {
      return Response.json(
        { ok: false, message: "Typecast API 키를 먼저 저장해주세요." },
        { status: 400 },
      );
    }

    if (!text) {
      return Response.json(
        { ok: false, message: "음성으로 만들 나레이션 문장이 없습니다." },
        { status: 400 },
      );
    }

    let voicesResponse = await fetch(getVoiceListUrl(voiceGender), {
      headers: {
        "X-API-KEY": apiKey,
      },
    });
    let voicesData = await voicesResponse.json();

    if (!voicesResponse.ok) {
      return Response.json(
        {
          ok: false,
          message: getTypecastErrorMessage(voicesResponse.status, voicesData),
        },
        { status: 400 },
      );
    }

    let voices = extractVoices(voicesData);
    if (voices.length === 0 && voiceGender !== "neutral") {
      voicesResponse = await fetch(getVoiceListUrl("neutral"), {
        headers: {
          "X-API-KEY": apiKey,
        },
      });
      voicesData = await voicesResponse.json();
      voices = voicesResponse.ok ? extractVoices(voicesData) : [];
    }
    const voice = voices.find((item) => item.voice_id);

    if (!voice?.voice_id) {
      return Response.json(
        { ok: false, message: "사용 가능한 Typecast 음성을 찾지 못했습니다." },
        { status: 400 },
      );
    }

    const speechResponse = await fetch("https://api.typecast.ai/v1/text-to-speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        voice_id: voice.voice_id,
        text,
        model: "ssfm-v21",
        language: "kor",
        prompt: {
          emotion_preset: "normal",
          emotion_intensity: 1,
        },
        output: {
          volume: 100,
          audio_pitch: 0,
          audio_tempo: getVoiceTempo(voiceStyle),
          audio_format: "wav",
        },
      }),
    });

    if (!speechResponse.ok) {
      let data: unknown = null;
      try {
        data = await speechResponse.json();
      } catch {
        data = null;
      }

      return Response.json(
        {
          ok: false,
          message: getTypecastErrorMessage(speechResponse.status, data),
        },
        { status: 400 },
      );
    }

    const audioBuffer = await speechResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");

    return Response.json({
      ok: true,
      audioBase64,
      audioMime: speechResponse.headers.get("content-type") ?? "audio/wav",
      textLength: text.length,
      wasTrimmed: rawText.length > text.length,
      voiceName: voice.voice_name ?? "Typecast voice",
      voiceGender,
      voiceStyle,
    });
  } catch {
    return Response.json(
      { ok: false, message: "Typecast 음성 생성 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
