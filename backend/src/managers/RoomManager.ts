import { User } from "./UserManger";

let GLOBAL_ROOM_ID = 1;

interface Room {
    user1: User,
    user2?: User,
}

export class RoomManager {
    private rooms: Map<string, Room>
    constructor() {
        this.rooms = new Map<string, Room>()
    }

    createRoom(user1: User) {
        const roomId = this.generate().toString();
        this.rooms.set(roomId.toString(), {
            user1,
        })
        return roomId;
    }

    joinRoom(roomId: string, user2: User) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return false;
        }
        if (room.user2) {
            return false;
        }
        room.user2 = user2;

        room.user1.socket.emit("user-joined", {
            roomId
        });

        room.user2.socket.emit("user-joined", {
            roomId
        });

        // Trigger the negotiation: User 2 (the joiner) will likely wait for User 1 to send offer?
        // Or we can stick to previous flow: Server tells User 1 to send offer.

        room.user1.socket.emit("send-offer", {
            roomId
        })

        return true;
    }

    onOffer(roomId: string, sdp: string, senderSocketid: string) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }
        const receivingUser = room.user1.socket.id === senderSocketid ? room.user2 : room.user1;
        receivingUser?.socket.emit("offer", {
            sdp,
            roomId
        })
    }

    onAnswer(roomId: string, sdp: string, senderSocketid: string) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }
        const receivingUser = room.user1.socket.id === senderSocketid ? room.user2 : room.user1;

        receivingUser?.socket.emit("answer", {
            sdp,
            roomId
        });
    }

    onIceCandidates(roomId: string, senderSocketid: string, candidate: any, type: "sender" | "receiver") {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }
        const receivingUser = room.user1.socket.id === senderSocketid ? room.user2 : room.user1;
        receivingUser?.socket.emit("add-ice-candidate", ({ candidate, type }));
    }

    onScreenShareStatus(roomId: string, senderSocketid: string, isSharing: boolean) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }
        const receivingUser = room.user1.socket.id === senderSocketid ? room.user2 : room.user1;
        receivingUser?.socket.emit("screen-share-status", { isSharing });
    }

    generate() {
        return GLOBAL_ROOM_ID++;
    }

}