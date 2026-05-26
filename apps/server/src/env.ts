import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  CLIENT_URL: process.env.CLIENT_URL ?? "http://localhost:5173",
  PUBLIC_API_URL: process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  PUBLIC_WEB_URL: process.env.PUBLIC_WEB_URL ?? "http://localhost:5173",
  UPLOAD_DIR: process.env.UPLOAD_DIR ?? "./uploads",
  AUDIUS_API_BASE: process.env.AUDIUS_API_BASE ?? "https://api.audius.co/v1",
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID ?? "",
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET ?? "",
  SPOTIFY_REDIRECT_URI:
    process.env.SPOTIFY_REDIRECT_URI ?? `${process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`}/api/spotify/callback`,
  SPOTIFY_SCOPES:
    process.env.SPOTIFY_SCOPES ?? "user-modify-playback-state user-read-playback-state user-read-currently-playing",
  DISCORD_TOKEN: process.env.DISCORD_TOKEN ?? "",
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID ?? "",
  DISCORD_PUBLIC_KEY: process.env.DISCORD_PUBLIC_KEY ?? "",
  DISCORD_BOT_SECRET: process.env.DISCORD_BOT_SECRET ?? "",
};
