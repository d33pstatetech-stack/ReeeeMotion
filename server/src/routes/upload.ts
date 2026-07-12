import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";

const ACCEPTED_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/aac",
  "audio/x-m4a",
  "audio/mp4",
  "audio/flac",
]);

function extFor(mime: string, originalName: string) {
  const fromName = path.extname(originalName).toLowerCase();
  if (fromName) return fromName;
  switch (mime) {
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    case "video/quicktime":
      return ".mov";
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "audio/mpeg":
    case "audio/mp3":
      return ".mp3";
    case "audio/wav":
    case "audio/x-wav":
      return ".wav";
    case "audio/ogg":
      return ".ogg";
    case "audio/aac":
      return ".aac";
    case "audio/x-m4a":
    case "audio/mp4":
      return ".m4a";
    case "audio/flac":
      return ".flac";
    case "audio/webm":
      return ".webm";
    default:
      return "";
  }
}

function detectKind(mimetype: string, originalName: string): "video" | "image" | "audio" {
  if (mimetype.startsWith("audio/")) return "audio";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("image/")) return "image";
  // Fallback to extension for clients that send generic octet-stream.
  const ext = path.extname(originalName).toLowerCase();
  if (/^\.(mp4|webm|mov|m4v)$/i.test(ext)) return "video";
  if (/^\.(png|jpe?g|webp|gif)$/i.test(ext)) return "image";
  if (/^\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(ext)) return "audio";
  return "video";
}

export function uploadRouter(uploadDir: string) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const id = nanoid(10);
      const ext = extFor(file.mimetype, file.originalname);
      cb(null, `${id}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 1024 * 1024 * 500 }, // 500 MB per file
    fileFilter: (_req, file, cb) => {
      if (ACCEPTED_MIME.has(file.mimetype)) cb(null, true);
      else cb(new Error(`Unsupported media type: ${file.mimetype}`));
    },
  });

  const router = Router();

  // Single-file upload endpoint. The client posts FormData('files[]', blob).
  router.post("/", upload.array("files", 20), (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const host = process.env.PUBLIC_HOST ?? `http://localhost:${process.env.PORT ?? 3001}`;
    const payload = files.map((file) => {
      const kind = detectKind(file.mimetype, file.originalname);
      return {
        id: path.parse(file.filename).name,
        name: file.originalname,
        filename: file.filename,
        url: `${host}/uploads/${file.filename}`,
        mime: file.mimetype,
        kind,
        size: file.size,
        pathOnDisk: path.join(uploadDir, file.filename),
      };
    });
    res.json({ assets: payload });
  });

  // DELETE /api/upload/:filename -> remove a previously uploaded media file.
  router.delete("/:filename", (req, res) => {
    const safe = path.basename(req.params.filename);
    const full = path.join(uploadDir, safe);
    if (!fs.existsSync(full)) return res.status(404).json({ error: "not found" });
    fs.unlinkSync(full);
    res.json({ ok: true });
  });

  return router;
}
