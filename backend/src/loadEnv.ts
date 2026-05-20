import dotenv from "dotenv";
import path from "path";

// Load backend/.env before any module reads process.env (e.g. security.ts).
dotenv.config({ path: path.resolve(__dirname, "../.env") });
