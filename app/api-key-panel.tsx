"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  clearBrowserApiKey,
  getBrowserStoredApiKey,
  saveBrowserApiKey,
} from "./lib/browser-api-keys";

type KeyId = "openai" | "typecast";

type StoredKeyStatus = {
  saved: boolean;
  source: "env" | "local" | "browser" | "missing";
  lastFour: string;
};

type StoredKeyStatuses = Record<KeyId, StoredKeyStatus>;

type VerificationState = Record<
  KeyId,
  {
    status: "idle" | "checking" | "verified" | "error";
    message: string;
  }
>;

type LocalApiKeysResponse = {
  ok?: boolean;
  keys?: StoredKeyStatuses;
  message?: string;
};

const keyFields: Array<{
  id: KeyId;
  label: string;
  helper: string;
  placeholder: string;
}> = [
  {
    id: "openai",
    label: "OpenAI API 키",
    helper: "제품 분석, 제작 지시서, 이미지 생성, 이미지 검수에 사용합니다.",
    placeholder: "sk-...",
  },
  {
    id: "typecast",
    label: "Typecast API 키",
    helper: "나레이션 음성을 만들 때 사용합니다.",
    placeholder: "Typecast API 키",
  },
];

const emptyInputs: Record<KeyId, string> = {
  openai: "",
  typecast: "",
};

const emptyStatuses: StoredKeyStatuses = {
  openai: {
    saved: false,
    source: "missing",
    lastFour: "",
  },
  typecast: {
    saved: false,
    source: "missing",
    lastFour: "",
  },
};

const emptyVerification: VerificationState = {
  openai: {
    status: "idle",
    message: "",
  },
  typecast: {
    status: "idle",
    message: "",
  },
};

function getStatusCopy(status: StoredKeyStatus) {
  if (!status.saved) {
    return {
      label: "키 없음",
      body: "아직 저장된 키가 없습니다.",
      tone: "missing" as const,
    };
  }

  if (status.source === "env") {
    return {
      label: "환경변수 저장됨",
      body: `저장된 키 끝 4자리: ${status.lastFour}`,
      tone: "ready" as const,
    };
  }

  if (status.source === "browser") {
    return {
      label: "브라우저 저장됨",
      body: `저장된 키 끝 4자리: ${status.lastFour}`,
      tone: "ready" as const,
    };
  }

  return {
    label: "로컬 파일 저장됨",
    body: `저장된 키 끝 4자리: ${status.lastFour}`,
    tone: "ready" as const,
  };
}

function getPanelClasses(
  tone: "ready" | "missing" | "checking" | "verified" | "error",
) {
  if (tone === "verified") {
    return {
      panel: "border-[#46e3c2] bg-[#102f2a]",
      badge: "bg-[#dbfff6] text-[#126252]",
      dot: "bg-[#46e3c2]",
    };
  }

  if (tone === "ready") {
    return {
      panel: "border-[#245d53] bg-[#0f2e29]",
      badge: "bg-[#133e38] text-[#8df0dc]",
      dot: "bg-[#46e3c2]",
    };
  }

  if (tone === "checking") {
    return {
      panel: "border-[#6b5524] bg-[#2c2419]",
      badge: "bg-[#453318] text-[#ffd47a]",
      dot: "bg-[#ffcf3f]",
    };
  }

  if (tone === "error") {
    return {
      panel: "border-[#823328] bg-[#2b1513]",
      badge: "bg-[#5a1f1a] text-[#ffb5ad]",
      dot: "bg-[#ff675c]",
    };
  }

  return {
    panel: "border-white/14 bg-white/[0.06]",
    badge: "bg-white/10 text-white/68",
    dot: "bg-white/36",
  };
}

async function parseApiKeyResponse(response: Response) {
  try {
    return (await response.json()) as LocalApiKeysResponse;
  } catch {
    return {
      ok: false,
      message: "서버 응답을 읽을 수 없습니다.",
    } satisfies LocalApiKeysResponse;
  }
}

async function fetchStoredKeyStatuses() {
  const response = await fetch("/api/local-api-keys", {
    method: "GET",
    cache: "no-store",
  });
  const result = await parseApiKeyResponse(response);

  if (!response.ok || !result.ok || !result.keys) {
    throw new Error(result.message ?? "API 키 상태를 불러오지 못했습니다.");
  }

  return result.keys;
}

function mergeBrowserAndServerStatuses(
  serverStatuses: StoredKeyStatuses = emptyStatuses,
) {
  const getBrowserStatus = (provider: KeyId): StoredKeyStatus => {
    const apiKey = getBrowserStoredApiKey(provider);

    if (!apiKey) {
      return emptyStatuses[provider];
    }

    return {
      saved: true,
      source: "browser",
      lastFour: apiKey.length > 4 ? apiKey.slice(-4) : apiKey,
    };
  };

  return {
    openai: serverStatuses.openai.saved
      ? serverStatuses.openai
      : getBrowserStatus("openai"),
    typecast: serverStatuses.typecast.saved
      ? serverStatuses.typecast
      : getBrowserStatus("typecast"),
  } satisfies StoredKeyStatuses;
}

async function loadVisibleKeyStatuses() {
  try {
    const serverStatuses = await fetchStoredKeyStatuses();
    return mergeBrowserAndServerStatuses(serverStatuses);
  } catch {
    return mergeBrowserAndServerStatuses();
  }
}

export default function ApiKeyPanel() {
  const [inputs, setInputs] = useState(emptyInputs);
  const [statuses, setStatuses] = useState<StoredKeyStatuses>(emptyStatuses);
  const [verification, setVerification] =
    useState<VerificationState>(emptyVerification);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<KeyId | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<
    "info" | "success" | "error"
  >("info");

  const showMessage = (
    nextMessage: string,
    tone: "info" | "success" | "error" = "info",
  ) => {
    setMessage(nextMessage);
    setMessageTone(tone);
  };

  useEffect(() => {
    let isMounted = true;

    const loadStatuses = async () => {
      try {
        const nextStatuses = await loadVisibleKeyStatuses();

        if (isMounted) {
          setStatuses(nextStatuses);
        }
      } catch (error) {
        if (isMounted) {
          showMessage(
            error instanceof Error
              ? error.message
              : "API 키 상태를 불러오는 중 오류가 발생했습니다.",
            "error",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadStatuses();

    return () => {
      isMounted = false;
    };
  }, []);

  const resetVerification = (id: KeyId) => {
    setVerification((current) => ({
      ...current,
      [id]: emptyVerification[id],
    }));
  };

  const saveKey = async (event: FormEvent<HTMLFormElement>, id: KeyId) => {
    event.preventDefault();

    const apiKey = inputs[id].trim();
    if (!apiKey) {
      return;
    }

    setSavingKey(id);
    showMessage(
      `${keyFields.find((field) => field.id === id)?.label} 저장 중입니다.`,
    );

    try {
      const response = await fetch("/api/local-api-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: id,
          apiKey,
          action: "save",
        }),
      });
      const result = await parseApiKeyResponse(response);

      if (!response.ok || !result.ok || !result.keys) {
        throw new Error(result.message ?? "API 키 저장에 실패했습니다.");
      }

      clearBrowserApiKey(id);
      const confirmedStatuses = await loadVisibleKeyStatuses();

      if (!confirmedStatuses[id].saved) {
        throw new Error("저장 후 상태 확인에 실패했습니다.");
      }

      setStatuses(confirmedStatuses);
      resetVerification(id);
      setInputs((current) => ({
        ...current,
        [id]: "",
      }));
      showMessage("API 키를 로컬 설정 파일에 저장했습니다.", "success");
    } catch (error) {
      try {
        saveBrowserApiKey(id, apiKey);
        const confirmedStatuses = await loadVisibleKeyStatuses();

        setStatuses(confirmedStatuses);
        resetVerification(id);
        setInputs((current) => ({
          ...current,
          [id]: "",
        }));
        showMessage(
          "로컬 파일 저장이 막혀 이 브라우저에 API 키를 저장했습니다.",
          "success",
        );
      } catch (fallbackError) {
        setStatuses((current) => ({ ...current }));
        showMessage(
          fallbackError instanceof Error
            ? fallbackError.message
            : error instanceof Error
              ? error.message
              : "API 키 저장에 실패했습니다.",
          "error",
        );
      }
    } finally {
      setSavingKey(null);
    }
  };

  const clearKey = async (id: KeyId) => {
    const currentSource = statuses[id].source;

    setSavingKey(id);
    showMessage(
      `${keyFields.find((field) => field.id === id)?.label} 삭제 중입니다.`,
    );

    try {
      if (currentSource === "local") {
        const response = await fetch("/api/local-api-keys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            provider: id,
            action: "clear",
          }),
        });
        const result = await parseApiKeyResponse(response);

        if (!response.ok || !result.ok || !result.keys) {
          throw new Error(result.message ?? "API 키 삭제에 실패했습니다.");
        }
      }

      clearBrowserApiKey(id);
      const confirmedStatuses = await loadVisibleKeyStatuses();

      setStatuses(confirmedStatuses);
      resetVerification(id);
      showMessage("로컬에 저장된 API 키를 삭제했습니다.", "success");
    } catch (error) {
      showMessage(
        error instanceof Error
          ? error.message
          : "API 키 삭제에 실패했습니다.",
        "error",
      );
    } finally {
      setSavingKey(null);
    }
  };

  const verifyKey = async (id: KeyId) => {
    if (!statuses[id].saved) {
      return;
    }

    setVerification((current) => ({
      ...current,
      [id]: {
        status: "checking",
        message: "",
      },
    }));

    try {
      const browserKey =
        statuses[id].source === "browser" ? getBrowserStoredApiKey(id) : "";
      const response = await fetch("/api/verify-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: id,
          ...(browserKey ? { apiKey: browserKey } : {}),
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
      };

      setVerification((current) => ({
        ...current,
        [id]: {
          status: result.ok ? "verified" : "error",
          message:
            result.message ??
            (result.ok
              ? "연결 확인 완료"
              : "연결 테스트에 실패했습니다."),
        },
      }));
    } catch {
      setVerification((current) => ({
        ...current,
        [id]: {
          status: "error",
          message: "연결 테스트 요청을 보낼 수 없습니다.",
        },
      }));
    }
  };

  return (
    <section className="rounded-lg border border-white/20 bg-[#111111]/92 p-5 text-white shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black text-[#ffcf3f]">API 설정</p>
          <h2 className="mt-2 text-2xl font-black leading-tight">
            키를 이 PC에 저장합니다.
          </h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-white/62">
            로컬 파일 저장이 막히면 현재 브라우저에 보관합니다.
          </p>
        </div>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white text-sm font-black text-[#111111]">
          KEY
        </span>
      </div>

      <div className="mt-5 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {keyFields.map((field) => {
            const savedStatus = statuses[field.id];
            const verificationStatus = verification[field.id];
            const statusCopy = getStatusCopy(savedStatus);
            const tone =
              verificationStatus.status === "verified" ||
              verificationStatus.status === "checking" ||
              verificationStatus.status === "error"
                ? verificationStatus.status
                : statusCopy.tone;
            const classes = getPanelClasses(tone);

            return (
              <div
                key={`${field.id}-status`}
                className={`rounded-lg border px-4 py-3 ${classes.panel}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${classes.dot}`}
                  />
                  <p className="text-sm font-black">{field.label}</p>
                </div>
                <p className="mt-2 text-xs font-bold text-white/76">
                  {verificationStatus.status === "idle"
                    ? isLoading
                      ? "상태 확인 중"
                      : statusCopy.label
                    : verificationStatus.status === "checking"
                      ? "연결 확인 중"
                      : verificationStatus.status === "verified"
                        ? "연결 확인 완료"
                        : "연결 실패"}
                </p>
                <p className="mt-1 text-xs leading-5 text-white/56">
                  {verificationStatus.message || statusCopy.body}
                </p>
              </div>
            );
          })}
        </div>

        {keyFields.map((field) => {
          const savedStatus = statuses[field.id];
          const verificationStatus = verification[field.id].status;
          const statusCopy = getStatusCopy(savedStatus);
          const classes = getPanelClasses(statusCopy.tone);
          const canClear =
            savedStatus.saved &&
            (savedStatus.source === "local" ||
              savedStatus.source === "browser");
          const isSaving = savingKey === field.id;
          const isBusy = savingKey !== null || verificationStatus === "checking";

          return (
            <form
              key={field.id}
              className="rounded-lg border border-white/14 bg-white/[0.06] p-4"
              onSubmit={(event) => void saveKey(event, field.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <label
                    htmlFor={`${field.id}-api-key`}
                    className="text-sm font-black"
                  >
                    {field.label}
                  </label>
                  <p className="mt-1 text-xs leading-5 text-white/62">
                    {field.helper}
                  </p>
                </div>
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-bold ${classes.badge}`}
                >
                  {statusCopy.label}
                </span>
              </div>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  id={`${field.id}-api-key`}
                  type="password"
                  value={inputs[field.id]}
                  placeholder={field.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/18 bg-white px-3 text-sm font-semibold text-[#161616] outline-none transition placeholder:text-[#8a8378] focus:border-[#ffcf3f] focus:ring-2 focus:ring-[#ffcf3f]/35"
                  disabled={isSaving}
                  onChange={(event) =>
                    setInputs((current) => ({
                      ...current,
                      [field.id]: event.target.value,
                    }))
                  }
                />
                <button
                  type="submit"
                  className="min-h-11 rounded-lg bg-[#ffcf3f] px-4 text-sm font-black text-[#111111] transition hover:bg-[#ffe07b] disabled:cursor-not-allowed disabled:bg-white/22 disabled:text-white/42"
                  disabled={!inputs[field.id].trim() || isSaving}
                >
                  {isSaving ? "저장 중" : "저장"}
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-lg border border-white/20 px-4 text-sm font-bold text-white transition hover:border-white disabled:cursor-not-allowed disabled:text-white/32"
                  disabled={!savedStatus.saved || isBusy}
                  onClick={() => void verifyKey(field.id)}
                >
                  {verificationStatus === "checking" ? "확인 중" : "연결 테스트"}
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-lg border border-white/20 px-4 text-sm font-bold text-white transition hover:border-white disabled:cursor-not-allowed disabled:text-white/32"
                  disabled={!canClear || isBusy}
                  onClick={() => void clearKey(field.id)}
                >
                  삭제
                </button>
              </div>
            </form>
          );
        })}
      </div>

      {message ? (
        <p
          className={`mt-4 rounded-lg px-4 py-3 text-xs font-bold leading-5 ${
            messageTone === "success"
              ? "bg-[#123f36] text-[#9df5df]"
              : messageTone === "error"
                ? "bg-[#5a1f1a] text-[#ffb5ad]"
                : "bg-white/10 text-white/76"
          }`}
        >
          {message}
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-white/58">
        저장된 키는 프로젝트 로컬 설정 폴더 또는 현재 브라우저에만 보관됩니다.
        채팅창에는 API 키를 보내지 마세요.
      </p>
    </section>
  );
}
