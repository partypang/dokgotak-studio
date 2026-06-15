import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { cwd, env } from "node:process";

export type ApiKeyProvider = "openai" | "typecast";

type StoredApiKeys = Partial<Record<ApiKeyProvider, string>> & {
  updatedAt?: string;
};

export type ApiKeyStatus = {
  saved: boolean;
  source: "env" | "local" | "missing";
  lastFour: string;
};

const localDataDir = resolve(
  env.DOKGOTAK_STUDIO_DATA_DIR?.trim() ||
    join(env.INIT_CWD?.trim() || cwd(), ".dokgotak-local"),
);
const localApiKeyPath = join(localDataDir, "api-keys.json");
const serverStoredKeyToken = "__dokgotak_server_stored_key__";

function getEnvKey(provider: ApiKeyProvider) {
  return provider === "openai"
    ? env.OPENAI_API_KEY?.trim() ?? ""
    : env.TYPECAST_API_KEY?.trim() ?? "";
}

function maskLastFour(value: string) {
  return value.length > 4 ? value.slice(-4) : value;
}

async function readStoredApiKeys(): Promise<StoredApiKeys> {
  try {
    const raw = await readFile(localApiKeyPath, "utf8");
    const parsed = JSON.parse(raw) as StoredApiKeys;

    return {
      openai: typeof parsed.openai === "string" ? parsed.openai : "",
      typecast: typeof parsed.typecast === "string" ? parsed.typecast : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return {};
  }
}

async function writeStoredApiKeys(nextKeys: StoredApiKeys) {
  await mkdir(dirname(localApiKeyPath), { recursive: true });
  await writeFile(
    localApiKeyPath,
    `${JSON.stringify(
      {
        openai: nextKeys.openai?.trim() ?? "",
        typecast: nextKeys.typecast?.trim() ?? "",
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function getStoredApiKey(provider: ApiKeyProvider) {
  const envKey = getEnvKey(provider);
  if (envKey) {
    return envKey;
  }

  const storedKeys = await readStoredApiKeys();
  return storedKeys[provider]?.trim() ?? "";
}

export async function saveStoredApiKey(
  provider: ApiKeyProvider,
  apiKey: string,
) {
  const storedKeys = await readStoredApiKeys();
  const nextKey = apiKey.trim();

  await writeStoredApiKeys({
    ...storedKeys,
    [provider]: nextKey,
  });

  const savedKeys = await readStoredApiKeys();
  if ((savedKeys[provider]?.trim() ?? "") !== nextKey) {
    throw new Error("API key was not written to local storage.");
  }
}

export async function clearStoredApiKey(provider: ApiKeyProvider) {
  const storedKeys = await readStoredApiKeys();
  await writeStoredApiKeys({
    ...storedKeys,
    [provider]: "",
  });
}

export async function getStoredApiKeyStatuses(): Promise<
  Record<ApiKeyProvider, ApiKeyStatus>
> {
  const storedKeys = await readStoredApiKeys();

  const buildStatus = (provider: ApiKeyProvider): ApiKeyStatus => {
    const envKey = getEnvKey(provider);
    if (envKey) {
      return {
        saved: true,
        source: "env",
        lastFour: maskLastFour(envKey),
      };
    }

    const localKey = storedKeys[provider]?.trim() ?? "";
    if (localKey) {
      return {
        saved: true,
        source: "local",
        lastFour: maskLastFour(localKey),
      };
    }

    return {
      saved: false,
      source: "missing",
      lastFour: "",
    };
  };

  return {
    openai: buildStatus("openai"),
    typecast: buildStatus("typecast"),
  };
}

export async function resolveOpenAiApiKey(payloadKey?: string) {
  const trimmed = payloadKey?.trim() ?? "";
  return trimmed && trimmed !== serverStoredKeyToken
    ? trimmed
    : getStoredApiKey("openai");
}

export async function resolveTypecastApiKey(payloadKey?: string) {
  const trimmed = payloadKey?.trim() ?? "";
  return trimmed && trimmed !== serverStoredKeyToken
    ? trimmed
    : getStoredApiKey("typecast");
}
