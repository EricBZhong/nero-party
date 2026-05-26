import fs from "node:fs";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL ?? "";

if (databaseUrl.startsWith("file:")) {
  const filePath = databaseUrl.replace(/^file:/, "");
  if (path.isAbsolute(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.closeSync(fs.openSync(filePath, "a"));
  }
}
