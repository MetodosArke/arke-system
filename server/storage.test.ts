import { describe, expect, it } from "vitest";
import { DIETA_MIME_TYPES, EXERCICIO_VIDEO_MIME_TYPES, LOGO_MIME_TYPES, decodeUpload, extensionFor } from "./storage";

describe("decodeUpload", () => {
  it("decodes a valid base64 payload of an allowed type", () => {
    const base64 = Buffer.from("conteudo do arquivo").toString("base64");
    const buffer = decodeUpload(base64, "image/png", LOGO_MIME_TYPES, 1024);
    expect(buffer.toString()).toBe("conteudo do arquivo");
  });

  it("rejects a mime type outside the allow-list", () => {
    const base64 = Buffer.from("x").toString("base64");
    expect(() => decodeUpload(base64, "application/zip", LOGO_MIME_TYPES, 1024)).toThrow(/não suportado/);
  });

  it("rejects a payload larger than the configured limit", () => {
    const base64 = Buffer.alloc(2048, "a").toString("base64");
    expect(() => decodeUpload(base64, "application/pdf", DIETA_MIME_TYPES, 1024)).toThrow(/muito grande/);
  });

  it("rejects an empty payload", () => {
    expect(() => decodeUpload("", "image/png", LOGO_MIME_TYPES, 1024)).toThrow(/vazio/);
  });

  it("accepts an mp4 video within the exercício video allow-list", () => {
    const base64 = Buffer.from("video").toString("base64");
    const buffer = decodeUpload(base64, "video/mp4", EXERCICIO_VIDEO_MIME_TYPES, 1024);
    expect(buffer.toString()).toBe("video");
  });
});

describe("extensionFor", () => {
  it("maps known mime types to their extension", () => {
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("application/pdf")).toBe("pdf");
    expect(extensionFor("video/mp4")).toBe("mp4");
  });

  it("falls back to a generic extension for unknown types", () => {
    expect(extensionFor("application/octet-stream")).toBe("bin");
  });
});
