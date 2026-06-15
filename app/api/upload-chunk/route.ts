import { upsertUploadChunk } from "../upload-store";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readNumber(formData: FormData, key: string) {
  const value = Number(readString(formData, key));
  return Number.isFinite(value) ? value : NaN;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const sessionId = readString(formData, "sessionId");
    const fileId = readString(formData, "fileId");
    const fileName = readString(formData, "fileName");
    const fileType = readString(formData, "fileType");
    const fileSize = readNumber(formData, "fileSize");
    const chunkIndex = readNumber(formData, "chunkIndex");
    const totalChunks = readNumber(formData, "totalChunks");
    const chunk = formData.get("chunk");

    if (
      !sessionId ||
      !fileId ||
      !fileName ||
      !fileType ||
      !Number.isInteger(fileSize) ||
      !Number.isInteger(chunkIndex) ||
      !Number.isInteger(totalChunks) ||
      !(chunk instanceof File)
    ) {
      return Response.json(
        { ok: false, message: "업로드 조각 정보가 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const result = upsertUploadChunk({
      sessionId,
      fileId,
      fileName,
      fileType,
      fileSize,
      chunkIndex,
      totalChunks,
      bytes: new Uint8Array(await chunk.arrayBuffer()),
    });

    return Response.json({
      ok: true,
      ...result,
    });
  } catch {
    return Response.json(
      { ok: false, message: "파일 조각 업로드 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
