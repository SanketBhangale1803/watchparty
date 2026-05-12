import { User } from "./UserManger";

interface Room {
    participants: Map<string, User>;
    createdAt: number;
    lastActivityAt: number;
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

/**
 * Friendly 6-character room IDs (omit ambiguous chars: 0/O, 1/I/L).
 * Collisions are negligible at this scale; we just retry a few times.
 */
const ROOM_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeRoomId(): string {
    let out = "";
    for (let i = 0; i < 6; i++) {
        out += ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
    }
    return out;
}

const ROOM_MAX_PARTICIPANTS = 32;

export class RoomManager {
    private rooms: Map<string, Room>;
    private userRoomMap: Map<string, string>;

    constructor() {
        this.rooms = new Map<string, Room>();
        this.userRoomMap = new Map<string, string>();
    }

    private normalizeRoomId(roomId: string): string {
        return roomId.trim().toUpperCase();
    }

    getUserRoom(socketId: string): string | undefined {
        return this.userRoomMap.get(socketId);
    }

    getRoomSize(roomId: string): number {
        const room = this.rooms.get(this.normalizeRoomId(roomId));
        return room ? room.participants.size : 0;
    }

    private touch(room: Room) {
        room.lastActivityAt = Date.now();
    }

    createRoom(host: User, preferredId?: string): string {
        let roomId = preferredId ? this.normalizeRoomId(preferredId) : "";
        if (!roomId || this.rooms.has(roomId)) {
            for (let i = 0; i < 8; i++) {
                const candidate = makeRoomId();
                if (!this.rooms.has(candidate)) {
                    roomId = candidate;
                    break;
                }
            }
            if (!roomId) roomId = makeRoomId();
        }

        const participants = new Map<string, User>();
        participants.set(host.socket.id, host);
        const now = Date.now();
        this.rooms.set(roomId, { participants, createdAt: now, lastActivityAt: now });
        this.userRoomMap.set(host.socket.id, roomId);
        return roomId;
    }

    /**
     * Join an existing room, or transparently create it if it has been lost
     * (e.g. signaling server restarted). Returns an outcome that lets the
     * caller tell the client whether they joined a fresh or existing room.
     */
    joinRoom(roomId: string, user: User): { ok: true; created: boolean; roomId: string } | { ok: false; reason: "full" } {
        const normalized = this.normalizeRoomId(roomId);
        let room = this.rooms.get(normalized);

        if (!room) {
            const id = this.createRoom(user, normalized);
            const created = this.rooms.get(id)!;
            // The host gets a confirmation event too so the UI can stay in sync.
            user.socket.emit("room-joined", {
                roomId: id,
                participants: [],
            });
            this.touch(created);
            return { ok: true, created: true, roomId: id };
        }

        if (room.participants.has(user.socket.id)) {
            user.socket.emit("room-joined", {
                roomId: normalized,
                participants: [...room.participants]
                    .filter(([id]) => id !== user.socket.id)
                    .map(([, p]) => ({ id: p.socket.id, name: p.name })),
            });
            this.touch(room);
            return { ok: true, created: false, roomId: normalized };
        }

        if (room.participants.size >= ROOM_MAX_PARTICIPANTS) {
            return { ok: false, reason: "full" };
        }

        const existingParticipants: Participant[] = [];
        room.participants.forEach((participant) => {
            existingParticipants.push({
                id: participant.socket.id,
                name: participant.name,
            });
        });

        room.participants.set(user.socket.id, user);
        this.userRoomMap.set(user.socket.id, normalized);
        this.touch(room);

        user.socket.emit("room-joined", {
            roomId: normalized,
            participants: existingParticipants,
        });

        room.participants.forEach((participant) => {
            if (participant.socket.id !== user.socket.id) {
                participant.socket.emit("participant-joined", {
                    roomId: normalized,
                    participant: {
                        id: user.socket.id,
                        name: user.name,
                    },
                });
            }
        });

        return { ok: true, created: false, roomId: normalized };
    }

    forwardOffer(roomId: string, senderSocketId: string, targetSocketId: string, sdp: SessionDescriptionPayload) {
        const room = this.rooms.get(this.normalizeRoomId(roomId));
        if (!room) return;
        const targetUser = room.participants.get(targetSocketId);
        if (!targetUser) return;
        this.touch(room);
        targetUser.socket.emit("offer", { roomId: this.normalizeRoomId(roomId), fromId: senderSocketId, sdp });
    }

    forwardAnswer(roomId: string, senderSocketId: string, targetSocketId: string, sdp: SessionDescriptionPayload) {
        const room = this.rooms.get(this.normalizeRoomId(roomId));
        if (!room) return;
        const targetUser = room.participants.get(targetSocketId);
        if (!targetUser) return;
        this.touch(room);
        targetUser.socket.emit("answer", { roomId: this.normalizeRoomId(roomId), fromId: senderSocketId, sdp });
    }

    forwardIceCandidate(
        roomId: string,
        senderSocketId: string,
        targetSocketId: string,
        candidate: IceCandidatePayload
    ) {
        const room = this.rooms.get(this.normalizeRoomId(roomId));
        if (!room) return;
        const targetUser = room.participants.get(targetSocketId);
        if (!targetUser) return;
        this.touch(room);
        targetUser.socket.emit("ice-candidate", {
            roomId: this.normalizeRoomId(roomId),
            fromId: senderSocketId,
            candidate,
        });
    }

    onScreenShareStatus(roomId: string, senderSocketId: string, isSharing: boolean, trackId: string | null) {
        const room = this.rooms.get(this.normalizeRoomId(roomId));
        if (!room) return;
        this.touch(room);
        room.participants.forEach((participant) => {
            if (participant.socket.id !== senderSocketId) {
                participant.socket.emit("screen-share-status", {
                    roomId: this.normalizeRoomId(roomId),
                    senderId: senderSocketId,
                    isSharing,
                    trackId,
                });
            }
        });
    }

    removeUser(socketId: string) {
        const roomId = this.userRoomMap.get(socketId);
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (!room) {
            this.userRoomMap.delete(socketId);
            return;
        }

        room.participants.delete(socketId);
        this.userRoomMap.delete(socketId);
        this.touch(room);

        room.participants.forEach((participant) => {
            participant.socket.emit("participant-left", {
                roomId,
                participantId: socketId,
            });
        });

        if (room.participants.size === 0) {
            this.rooms.delete(roomId);
        }
    }
}
