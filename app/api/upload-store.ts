export type UploadedFileMeta = {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  totalChunks: number;
};

export type StoredUploadFile = UploadedFileMeta & {
  chunks: Map<number, Uint8Array>;
  receivedBytes: number;
};

type UploadSession = {
  createdAt: number;
  files: Map<string, StoredUploadFile>;
};

type UploadStore = Map<string, UploadSession>;

const uploadTtlMs = 15 * 60 * 1000;

function getGlobalStore() {
  const globalScope = globalThis as typeof globalThis & {
    __dokgotakUploadStore?: UploadStore;
  };

  if (!globalScope.__dokgotakUploadStore) {
    globalScope.__dokgotakUploadStore = new Map();
  }

  return globalScope.__dokgotakUploadStore;
}

export function cleanupUploadStore() {
  const store = getGlobalStore();
  const now = Date.now();

  for (const [sessionId, session] of store.entries()) {
    if (now - session.createdAt > uploadTtlMs) {
      store.delete(sessionId);
    }
  }
}

export function upsertUploadChunk(options: {
  sessionId: string;
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  chunkIndex: number;
  totalChunks: number;
  bytes: Uint8Array;
}) {
  cleanupUploadStore();

  const store = getGlobalStore();
  let session = store.get(options.sessionId);
  if (!session) {
    session = {
      createdAt: Date.now(),
      files: new Map(),
    };
    store.set(options.sessionId, session);
  }

  let file = session.files.get(options.fileId);
  if (!file) {
    file = {
      fileId: options.fileId,
      fileName: options.fileName,
      fileType: options.fileType,
      fileSize: options.fileSize,
      totalChunks: options.totalChunks,
      chunks: new Map(),
      receivedBytes: 0,
    };
    session.files.set(options.fileId, file);
  }

  const existingChunk = file.chunks.get(options.chunkIndex);
  if (existingChunk) {
    file.receivedBytes -= existingChunk.byteLength;
  }

  file.chunks.set(options.chunkIndex, options.bytes);
  file.receivedBytes += options.bytes.byteLength;

  return {
    receivedChunks: file.chunks.size,
    totalChunks: file.totalChunks,
    complete: file.chunks.size === file.totalChunks,
  };
}

export function getUploadedFiles(
  sessionId: string,
  fileMetas: UploadedFileMeta[],
) {
  cleanupUploadStore();

  const session = getGlobalStore().get(sessionId);
  if (!session) {
    throw new Error("업로드 세션을 찾지 못했습니다. 파일을 다시 넣어주세요.");
  }

  return fileMetas.map((meta) => {
    const file = session.files.get(meta.fileId);
    if (!file) {
      throw new Error(`${meta.fileName} 파일 업로드 정보를 찾지 못했습니다.`);
    }

    if (file.chunks.size !== file.totalChunks) {
      throw new Error(`${meta.fileName} 파일 업로드가 아직 완료되지 않았습니다.`);
    }

    return file;
  });
}

export function storedFileToBytes(file: StoredUploadFile) {
  const orderedChunks = Array.from(file.chunks.entries())
    .sort(([left], [right]) => left - right)
    .map(([, chunk]) => chunk);
  const totalBytes = orderedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of orderedChunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

export function clearUploadSession(sessionId: string) {
  getGlobalStore().delete(sessionId);
}
