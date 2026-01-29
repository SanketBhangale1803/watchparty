import { Socket } from "socket.io";
import { RoomManager } from "./RoomManager";

export interface User {
    socket: Socket;
    name: string;
}

export class UserManager {
    private users: User[];
    private roomManager: RoomManager;

    constructor() {
        this.users = [];
        this.roomManager = new RoomManager();
    }

    addUser(name: string, socket: Socket) {
        this.users.push({
            name, socket
        })
        this.initHandlers(socket);
    }

    removeUser(socketId: string) {
        const user = this.users.find(x => x.socket.id === socketId);
        this.users = this.users.filter(x => x.socket.id !== socketId);
    }

    initHandlers(socket: Socket) {
        socket.on("create-room", ({ name }: { name: string }) => {
            console.log("create room request")
            const user = this.users.find(x => x.socket.id === socket.id);
            if (!user) return;
            const roomId = this.roomManager.createRoom(user);
            socket.emit("room-created", { roomId });
        });

        socket.on("join-room", ({ name, roomId }: { name: string, roomId: string }) => {
            console.log("join room request " + roomId)
            const user = this.users.find(x => x.socket.id === socket.id);
            if (!user) return;

            const result = this.roomManager.joinRoom(roomId, user);
            if (!result) {
                socket.emit("room-join-error", { message: "Room not found or full" });
            }
        });

        socket.on("offer", ({ sdp, roomId }: { sdp: string, roomId: string }) => {
            this.roomManager.onOffer(roomId, sdp, socket.id);
        })

        socket.on("answer", ({ sdp, roomId }: { sdp: string, roomId: string }) => {
            this.roomManager.onAnswer(roomId, sdp, socket.id);
        })

        socket.on("add-ice-candidate", ({ candidate, roomId, type }) => {
            this.roomManager.onIceCandidates(roomId, socket.id, candidate, type);
        });

        socket.on("screen-share-status", ({ isSharing, roomId }) => {
            this.roomManager.onScreenShareStatus(roomId, socket.id, isSharing);
        });
    }

}