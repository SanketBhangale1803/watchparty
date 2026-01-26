import { Socket } from "socket.io";
import http from "http";

import express from 'express';
import { Server } from 'socket.io';
import { UserManager } from "./managers/UserManger";
import cors from 'cors';

const app = express();
const server = http.createServer(app);

// Enable CORS for all routes
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"]
}));

// Health check route for Railway
app.get('/', (req, res) => {
    res.send('Watchparty signaling server is running');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

const userManager = new UserManager();

io.on('connection', (socket: Socket) => {
    console.log('a user connected:', socket.id);
    userManager.addUser("randomName", socket);
    socket.on("disconnect", () => {
        console.log("user disconnected:", socket.id);
        userManager.removeUser(socket.id);
    })
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
