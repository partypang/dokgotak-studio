import { apiKeyStorageKey, serverStoredKeyToken } from "./studio-config";

export type ApiKeyProvider = "openai" | "typecast";

export type BrowserApiKeys = Record<ApiKeyProvider, string>;

export type BrowserApiKeyStatus = {
  saved: boolean;
  source: "browser" | "missing";
  lastFour: string;
};

const emptyKeys: BrowserApiKeys = {
  openai: "",
  typecast: "",
};

function parseKeys(raw: string | null): BrowserApiKeys {
  if (!raw) {
    return emptyKeys;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<ApiKeyProvider, unknown>>;

    return {
      openai: typeof parsed.openai === "string" ? parsed.openai.trim() : "",
      typecast:
        typeof parsed.typecast === "string" ? parsed.typecast.trim() : "",
    };
  } catch {
    return emptyKeys;
  }
}

function writeKeys(keys: BrowserApiKeys) {
  window.localStorage.setItem(
    apiKeyStorageKey,
    JSON.stringify({
      openai: keys.openai.trim(),
      typecast: keys.typecast.trim(),
      updatedAt: new Date().toISOString(),
    }),
  );
}

function maskLastFour(value: string) {
  return value.length > 4 ? value.slice(-4) : value;
}

export function readBrowserApiKeys(): BrowserApiKeys {
  if (typeof window === "undefined") {
    return emptyKeys;
  }

  const localKeys = parseKeys(window.localStorage.getItem(apiKeyStorageKey));

  if (localKeys.openai || localKeys.typecast) {
    return localKeys;
  }

  const sessionKeys = parseKeys(window.sessionStorage.getItem(apiKeyStorageKey));

  if (sessionKeys.openai || sessionKeys.typecast) {
    writeKeys(sessionKeys);
    window.sessionStorage.removeItem(apiKeyStorageKey);
  }

  return sessionKeys;
}

export function getBrowserStoredApiKey(provider: ApiKeyProvider) {
  return readBrowserApiKeys()[provider].trim();
}

export function getRequestApiKey(provider: ApiKeyProvider) {
  return getBrowserStoredApiKey(provider) || serverStoredKeyToken;
}

export function saveBrowserApiKey(provider: ApiKeyProvider, apiKey: string) {
  const nextKeys = {
    ...readBrowserApiKeys(),
    [provider]: apiKey.trim(),
  };

  writeKeys(nextKeys);
  window.sessionStorage.removeItem(apiKeyStorageKey);

  return getBrowserApiKeyStatuses();
}

export function clearBrowserApiKey(provider: ApiKeyProvider) {
  const nextKeys = {
    ...readBrowserApiKeys(),
    [provider]: "",
  };

  writeKeys(nextKeys);
  window.sessionStorage.removeItem(apiKeyStorageKey);

  return getBrowserApiKeyStatuses();
}

export function getBrowserApiKeyStatuses(): Record<
  ApiKeyProvider,
  BrowserApiKeyStatus
> {
  const keys = readBrowserApiKeys();

  return {
    openai: keys.openai
      ? {
          saved: true,
          source: "browser",
          lastFour: maskLastFour(keys.openai),
        }
      : {
          saved: false,
          source: "missing",
          lastFour: "",
        },
    typecast: keys.typecast
      ? {
          saved: true,
          source: "browser",
          lastFour: maskLastFour(keys.typecast),
        }
      : {
          saved: false,
          source: "missing",
          lastFour: "",
        },
  };
}
