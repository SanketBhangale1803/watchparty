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
    res.status(200).send('Watchparty signaling server is running');
});

app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const userManager = new UserManager();

io.on('connection', (socket: Socket) => {
    console.log('a user connected:', socket.id);
    userManager.addUser("randomName", socket);
    socket.on("disconnect", () => {
        console.log("user disconnected:", socket.id);
        userManager.removeUser(socket.id);
    });
});

const PORT = parseInt(process.env.PORT || '8080', 10);

server.listen(PORT, '8080', () => {
    console.log(`Server running on port ${PORT}`);
});