import { Socket } from "socket.io";
import http from "http";
import express, { Request, Response } from 'express';
import { Server } from 'socket.io';
import { UserManager } from "./managers/UserManger";

const app = express();
const server = http.createServer(app);

// Manual CORS middleware (more reliable than cors package)
app.use((_req: Request, res: Response, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Health check route for Railway
app.get('/', (_req: Request, res: Response) => {
    res.status(200).send('Closr signaling server is running');
});

app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Detect tab-close / network drop within ~20s instead of the previous minutes,
    // so the other peers' tiles disappear promptly when someone leaves.
    pingInterval: 10_000,
    pingTimeout: 20_000,
});

const userManager = new UserManager();

const stamp = () => new Date().toISOString();

io.on('connection', (socket: Socket) => {
    console.log(`[${stamp()}] [connect]    socket=${socket.id}`);
    userManager.addUser("Guest", socket);

    socket.on("disconnect", (reason) => {
        // Resolve the human-readable name BEFORE we ask the manager to forget the user.
        const name = userManager.getUserName(socket.id) ?? "Guest";
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
});