import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../.env") });
const configuredDb = process.env.DATABASE_PATH || "./data/assistant.sqlite";
const taxRateBasisPoints = Number(process.env.TAX_RATE_BASIS_POINTS || 1800);

if (!Number.isSafeInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 10000) {
  throw new Error("TAX_RATE_BASIS_POINTS must be a whole number from 0 to 10000.");
}

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  databasePath: path.isAbsolute(configuredDb) ? configuredDb : path.resolve(here, "..", configuredDb),
  logLevel: process.env.LOG_LEVEL || "info",
  taxRateBasisPoints,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173"
};
