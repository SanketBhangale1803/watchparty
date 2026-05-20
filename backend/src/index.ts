import { Socket } from "socket.io";
import http from "http";
import express, { Request, Response } from "express";
import { Server } from "socket.io";
import { UserManager } from "./managers/UserManger";

const app = express();
const server = http.createServer(app);

function parseAllowedOrigins(): string[] | "*" {
    const raw = process.env.ALLOWED_ORIGINS?.trim();
    if (!raw) return "*";
    const list = raw.split(",").map((o) => o.trim()).filter(Boolean);
    return list.length > 0 ? list : "*";
}

const allowedOrigins = parseAllowedOrigins();

function isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return true;
    if (allowedOrigins === "*") return true;
    return allowedOrigins.includes(origin);
}

app.use((req: Request, res: Response, next) => {
    const origin = req.headers.origin;
    if (isOriginAllowed(origin)) {
        res.header("Access-Control-Allow-Origin", origin ?? "*");
        res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("X-Content-Type-Options", "nosniff");
    res.header("X-Frame-Options", "DENY");
    res.header("Referrer-Policy", "no-referrer");
    if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
});

app.get("/", (_req: Request, res: Response) => {
    res.status(200).send("Closr signaling server is running");
});

app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

const io = new Server(server, {
    cors: {
        origin: allowedOrigins === "*" ? "*" : allowedOrigins,
        methods: ["GET", "POST"],
    },
    pingInterval: 10_000,
    pingTimeout: 20_000,
});

const userManager = new UserManager();

const stamp = () => new Date().toISOString();

io.on("connection", (socket: Socket) => {
    console.log(`[${stamp()}] [connect]    socket=${socket.id}`);
    userManager.addUser(socket);

    socket.on("disconnect", (reason) => {
        const name = userManager.getUserName(socket.id) ?? "(unnamed)";
        const roomId = userManager.getUserRoom(socket.id);
        console.log(
            `[${stamp()}] [disconnect] socket=${socket.id} user="${name}"` +
                (roomId ? ` room=${roomId}` : "") +
                ` reason=${reason}`
        );
        userManager.removeUser(socket.id);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (allowedOrigins !== "*") {
        console.log(`CORS restricted to: ${(allowedOrigins as string[]).join(", ")}`);
    }
    if (!process.env.INVITE_SIGNING_KEY?.trim()) {
        console.warn(
            "WARNING: INVITE_SIGNING_KEY is not set — invite tokens use a dev-only pepper. Set it in production."
        );
    }
});
