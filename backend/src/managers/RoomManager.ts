import { User } from "./UserManger";

let GLOBAL_ROOM_ID = 1;

interface Room {
    participants: Map<string, User>;
}

type Participant = {
    id: string;
    name: string;
};

type SessionDescriptionPayload = {
    type?: string;
    sdp?: string;
};

type IceCandidatePayload = {
    candidate?: string;
    sdpMLineIndex?: number | null;
    sdpMid?: string | null;
    usernameFragment?: string;
};

export class RoomManager {
    private rooms: Map<string, Room>;
    private userRoomMap: Map<string, string>;

    constructor() {
        this.rooms = new Map<string, Room>();
        this.userRoomMap = new Map<string, string>();
    }

    createRoom(host: User) {
        const roomId = this.generate().toString();
        const participants = new Map<string, User>();
        participants.set(host.socket.id, host);
        this.rooms.set(roomId, { participants });
        this.userRoomMap.set(host.socket.id, roomId);
        return roomId;
    }

    joinRoom(roomId: string, user: User) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return false;
        }

        if (room.participants.has(user.socket.id)) {
            return true;
        }

        const existingParticipants: Participant[] = [];
        room.participants.forEach((participant) => {
            existingParticipants.push({
                id: participant.socket.id,
                name: participant.name
            });
        });

        room.participants.set(user.socket.id, user);
        this.userRoomMap.set(user.socket.id, roomId);

        user.socket.emit("room-joined", {
            roomId,
            participants: existingParticipants
        });

        room.participants.forEach((participant) => {
            if (participant.socket.id !== user.socket.id) {
                participant.socket.emit("participant-joined", {
                    roomId,
                    participant: {
                        id: user.socket.id,
                        name: user.name
                    }
                });
            }
        });

        return true;
    }

    forwardOffer(roomId: string, senderSocketId: string, targetSocketId: string, sdp: SessionDescriptionPayload) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }

        const targetUser = room.participants.get(targetSocketId);
        if (!targetUser) {
            return;
        }

        targetUser.socket.emit("offer", {
            roomId,
            fromId: senderSocketId,
            sdp
        });
    }

    forwardAnswer(roomId: string, senderSocketId: string, targetSocketId: string, sdp: SessionDescriptionPayload) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }

        const targetUser = room.participants.get(targetSocketId);
        if (!targetUser) {
            return;
        }

        targetUser.socket.emit("answer", {
            roomId,
            fromId: senderSocketId,
            sdp
        });
    }

    forwardIceCandidate(roomId: string, senderSocketId: string, targetSocketId: string, candidate: IceCandidatePayload) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }

        const targetUser = room.participants.get(targetSocketId);
        if (!targetUser) {
            return;
        }

        targetUser.socket.emit("ice-candidate", {
            roomId,
            fromId: senderSocketId,
            candidate
        });
    }

    onScreenShareStatus(roomId: string, senderSocketId: string, isSharing: boolean, trackId: string | null) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }

        room.participants.forEach((participant) => {
            if (participant.socket.id !== senderSocketId) {
                participant.socket.emit("screen-share-status", {
                    roomId,
                    senderId: senderSocketId,
                    isSharing,
                    trackId
                });
            }
        });
    }

    onPlaybackToggle(roomId: string, senderSocketId: string, paused: boolean) {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }

        room.participants.forEach((participant) => {
            if (participant.socket.id !== senderSocketId) {
                participant.socket.emit("playback-toggle", {
                    roomId,
                    senderId: senderSocketId,
                    paused
                });
            }
        });
    }

    removeUser(socketId: string) {
        const roomId = this.userRoomMap.get(socketId);
        if (!roomId) {
            return;
        }

        const room = this.rooms.get(roomId);
        if (!room) {
            this.userRoomMap.delete(socketId);
            return;
        }

        room.participants.delete(socketId);
        this.userRoomMap.delete(socketId);

        room.participants.forEach((participant) => {
            participant.socket.emit("participant-left", {
                roomId,
                participantId: socketId
            });
        });

        if (room.participants.size === 0) {
            this.rooms.delete(roomId);
        }
    }

    generate() {
        return GLOBAL_ROOM_ID++;
    }
}
