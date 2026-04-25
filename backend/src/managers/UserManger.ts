import { Socket } from "socket.io";
import { RoomManager } from "./RoomManager";

export interface User {
    socket: Socket;
    name: string;
}

export class UserManager {
    private users: Map<string, User>;
    private roomManager: RoomManager;

    constructor() {
        this.users = new Map<string, User>();
        this.roomManager = new RoomManager();
    }

    addUser(name: string, socket: Socket) {
        this.users.set(socket.id, {
            name,
            socket
        });
        this.initHandlers(socket);
    }

    removeUser(socketId: string) {
        this.users.delete(socketId);
        this.roomManager.removeUser(socketId);
    }

    initHandlers(socket: Socket) {
        socket.on("create-room", ({ name }: { name: string }) => {
            console.log("create room request");
            const user = this.users.get(socket.id);
            if (!user) return;
            user.name = name || user.name;
            const roomId = this.roomManager.createRoom(user);
            socket.emit("room-created", { roomId });
            socket.emit("room-joined", { roomId, participants: [] });
        });

        socket.on("join-room", ({ name, roomId }: { name: string, roomId: string }) => {
            console.log("join room request " + roomId);
            const user = this.users.get(socket.id);
            if (!user) return;
            user.name = name || user.name;

            const result = this.roomManager.joinRoom(roomId, user);
            if (!result) {
                socket.emit("room-join-error", { message: "Room not found or full" });
            }
        });

        socket.on("offer", ({ sdp, roomId, targetId }: { sdp: any, roomId: string, targetId: string }) => {
            this.roomManager.forwardOffer(roomId, socket.id, targetId, sdp);
        });

        socket.on("answer", ({ sdp, roomId, targetId }: { sdp: any, roomId: string, targetId: string }) => {
            this.roomManager.forwardAnswer(roomId, socket.id, targetId, sdp);
        });

        socket.on("ice-candidate", ({ candidate, roomId, targetId }: { candidate: any, roomId: string, targetId: string }) => {
            this.roomManager.forwardIceCandidate(roomId, socket.id, targetId, candidate);
        });

        socket.on("screen-share-status", ({ isSharing, roomId, trackId }: { isSharing: boolean, roomId: string, trackId: string | null }) => {
            this.roomManager.onScreenShareStatus(roomId, socket.id, isSharing, trackId ?? null);
        });

        socket.on("playback-toggle", ({ roomId, paused }: { roomId: string, paused: boolean }) => {
            this.roomManager.onPlaybackToggle(roomId, socket.id, paused);
        });
    }
}
