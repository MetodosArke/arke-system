import { describe, expect, it } from "vitest";
import { DIETA_MIME_TYPES, EXERCICIO_VIDEO_MIME_TYPES, LOGO_MIME_TYPES, decodeUpload, extensionFor } from "./storage";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MP4_HEADER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // tamanho + "ftyp"

describe("decodeUpload", () => {
  it("decodes a valid base64 payload of an allowed type", () => {
    const payload = Buffer.concat([PNG_HEADER, Buffer.from("resto do arquivo")]);
    const buffer = decodeUpload(payload.toString("base64"), "image/png", LOGO_MIME_TYPES, 1024);
    expect(buffer.equals(payload)).toBe(true);
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
    const payload = Buffer.concat([MP4_HEADER, Buffer.from("resto do arquivo")]);
    const buffer = decodeUpload(payload.toString("base64"), "video/mp4", EXERCICIO_VIDEO_MIME_TYPES, 1024);
    expect(buffer.equals(payload)).toBe(true);
  });

  it("rejects a file whose bytes don't match the declared type (content-type spoofing)", () => {
    const fakeVideo = Buffer.from("<html><script>alert(1)</script></html>");
    const base64 = fakeVideo.toString("base64");
    expect(() => decodeUpload(base64, "video/mp4", EXERCICIO_VIDEO_MIME_TYPES, 1024)).toThrow(/não corresponde ao tipo declarado/);
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
