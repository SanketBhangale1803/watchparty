import crypto from "crypto";
import { User } from "./UserManger";
import {
    ROOM_EMPTY_TTL_MS,
    ROOM_MAX_LIFETIME_MS,
    createInviteToken,
    hashRoomSecret,
    isValidRoomId,
    verifyInviteToken,
    verifyRoomSecret,
} from "../security";

interface Room {
    secretHash: string;
    hostClientId: string;
    locked: boolean;
    participants: Map<string, User>;
    clientIds: Map<string, string>;
    /** Client ids that have joined at least once — may rejoin while room is locked. */
    knownClientIds: Set<string>;
    /** Only one active screen sharer per room. */
    screenSharerId: string | null;
    createdAt: number;
    lastActivityAt: number;
    expiresAt: number;
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

const ROOM_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeRoomId(): string {
    let out = "";
    for (let i = 0; i < 8; i++) {
        out += ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
    }
    return out;
}

function makeRoomSecret(): string {
    return crypto.randomBytes(24).toString("hex");
}

const ROOM_MAX_PARTICIPANTS = Number(process.env.ROOM_MAX_PARTICIPANTS) || 12;

export type JoinResult =
    | { ok: true; roomId: string; inviteToken: string }
    | {
          ok: false;
          reason: "full" | "not_found" | "forbidden" | "invalid" | "locked" | "expired";
      };

export class RoomManager {
    private rooms: Map<string, Room>;
    private userRoomMap: Map<string, string>;

    constructor() {
        this.rooms = new Map<string, Room>();
        this.userRoomMap = new Map<string, string>();
        setInterval(() => this.pruneExpiredRooms(), 60_000);
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
        // Sliding expiry — active rooms stay alive while people are in the call.
        room.expiresAt = Date.now() + ROOM_MAX_LIFETIME_MS;
    }

    private isRoomExpired(room: Room): boolean {
        return room.participants.size === 0 && Date.now() > room.expiresAt;
    }

    private pruneExpiredRooms() {
        const now = Date.now();
        for (const [roomId, room] of this.rooms.entries()) {
            if (room.participants.size > 0) continue;
            const emptyTooLong = now - room.lastActivityAt > ROOM_EMPTY_TTL_MS;
            if (this.isRoomExpired(room) || emptyTooLong) {
                this.rooms.delete(roomId);
            }
        }
    }

    private evictSocket(room: Room, roomId: string, socketId: string) {
        if (!room.participants.has(socketId)) return;

        const wasScreenSharer = room.screenSharerId === socketId;
        room.participants.delete(socketId);
        this.userRoomMap.delete(socketId);

        if (wasScreenSharer) {
            room.screenSharerId = null;
            room.participants.forEach((participant) => {
                participant.socket.emit("screen-share-status", {
                    roomId,
                    senderId: socketId,
                    isSharing: false,
                    trackId: null,
                    activeSharerId: null,
                });
            });
        }

        for (const [clientId, sid] of room.clientIds.entries()) {
            if (sid === socketId) {
                room.clientIds.delete(clientId);
                break;
            }
        }

        room.participants.forEach((participant) => {
            participant.socket.emit("participant-left", {
                roomId,
                participantId: socketId,
            });
        });
    }

    private authorizeJoin(
        room: Room,
        roomId: string,
        roomSecret?: string,
        inviteToken?: string
    ): boolean {
        if (inviteToken?.trim() && verifyInviteToken(roomId, inviteToken)) {
            return true;
        }
        if (roomSecret?.trim() && verifyRoomSecret(roomSecret, room.secretHash)) {
            return true;
        }
        return false;
    }

    createRoom(host: User): { roomId: string; roomSecret: string; inviteToken: string } {
        let roomId = "";
        for (let i = 0; i < 12; i++) {
            const candidate = makeRoomId();
            if (!this.rooms.has(candidate)) {
                roomId = candidate;
                break;
            }
        }
        if (!roomId) roomId = makeRoomId();

        const roomSecret = makeRoomSecret();
        const now = Date.now();
        const participants = new Map<string, User>();
        participants.set(host.socket.id, host);

        const clientIds = new Map<string, string>();
        if (host.clientId) clientIds.set(host.clientId, host.socket.id);

        const knownClientIds = new Set<string>();
        if (host.clientId) knownClientIds.add(host.clientId);

        this.rooms.set(roomId, {
            secretHash: hashRoomSecret(roomSecret),
            hostClientId: host.clientId,
            locked: false,
            participants,
            clientIds,
            knownClientIds,
            screenSharerId: null,
            createdAt: now,
            lastActivityAt: now,
            expiresAt: now + ROOM_MAX_LIFETIME_MS,
        });
        this.userRoomMap.set(host.socket.id, roomId);

        const inviteToken = createInviteToken(roomId);
        return { roomId, roomSecret, inviteToken };
    }

    joinRoom(
        roomId: string,
        user: User,
        opts: { roomSecret?: string; inviteToken?: string }
    ): JoinResult {
        const normalized = this.normalizeRoomId(roomId);

        if (!isValidRoomId(normalized)) {
            return { ok: false, reason: "invalid" };
        }

        const room = this.rooms.get(normalized);
        if (!room) {
            return { ok: false, reason: "not_found" };
        }

        if (!this.authorizeJoin(room, normalized, opts.roomSecret, opts.inviteToken)) {
            return { ok: false, reason: "forbidden" };
        }

        const isHost = user.clientId === room.hostClientId;
        const isKnownClient = Boolean(user.clientId && room.knownClientIds.has(user.clientId));

        // Lock only blocks brand-new guests, not the host or anyone who already joined this room.
        if (room.locked && !isHost && !isKnownClient && !room.participants.has(user.socket.id)) {
            return { ok: false, reason: "locked" };
        }

        if (user.clientId) {
            const oldSocketId = room.clientIds.get(user.clientId);
            if (oldSocketId && oldSocketId !== user.socket.id) {
                const oldUser = room.participants.get(oldSocketId);
                console.log(
                    `[${new Date().toISOString()}] [reconnect]  room=${normalized}` +
                        ` clientId=${user.clientId.slice(0, 8)}…` +
                        ` evict=${oldSocketId} (${oldUser?.name ?? "?"})` +
                        ` → ${user.socket.id} (${user.name})`
                );
                this.evictSocket(room, normalized, oldSocketId);
            }
        }

        if (room.participants.has(user.socket.id)) {
            user.socket.emit("room-joined", {
                roomId: normalized,
                participants: [...room.participants]
                    .filter(([id]) => id !== user.socket.id)
                    .map(([, p]) => ({ id: p.socket.id, name: p.name })),
                isHost: user.clientId === room.hostClientId,
            });
            if (user.clientId) room.clientIds.set(user.clientId, user.socket.id);
            this.touch(room);
            return { ok: true, roomId: normalized, inviteToken: createInviteToken(normalized) };
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
        if (user.clientId) {
            room.clientIds.set(user.clientId, user.socket.id);
            room.knownClientIds.add(user.clientId);
        }
        this.touch(room);

        user.socket.emit("room-joined", {
            roomId: normalized,
            participants: existingParticipants,
            isHost: user.clientId === room.hostClientId,
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

        return { ok: true, roomId: normalized, inviteToken: createInviteToken(normalized) };
    }

    setRoomLocked(socketId: string, locked: boolean): boolean {
        const located = this.getRoomForSocket(socketId);
        if (!located) return false;

        const { room } = located;
        const user = room.participants.get(socketId);
        if (!user || user.clientId !== room.hostClientId) return false;

        room.locked = locked;
        this.touch(room);

        room.participants.forEach((participant) => {
            participant.socket.emit("room-locked", { roomId: located.roomId, locked });
        });

        return true;
    }

    private getRoomForSocket(socketId: string): { room: Room; roomId: string } | null {
        const roomId = this.userRoomMap.get(socketId);
        if (!roomId) return null;
        const room = this.rooms.get(roomId);
        if (!room) return null;
        return { room, roomId };
    }

    /** Signaling is only allowed from a socket that belongs to the claimed room. */
    private assertSenderInRoom(senderSocketId: string, claimedRoomId: string): Room | null {
        const located = this.getRoomForSocket(senderSocketId);
        if (!located) return null;
        if (located.roomId !== this.normalizeRoomId(claimedRoomId)) return null;
        this.touch(located.room);
        return located.room;
    }

    forwardOffer(roomId: string, senderSocketId: string, targetSocketId: string, sdp: SessionDescriptionPayload) {
        const room = this.assertSenderInRoom(senderSocketId, roomId);
        if (!room) return;
        if (!room.participants.has(senderSocketId) || !room.participants.has(targetSocketId)) return;
        const targetUser = room.participants.get(targetSocketId);
        if (!targetUser) return;
        this.touch(room);
        targetUser.socket.emit("offer", {
            roomId: this.normalizeRoomId(roomId),
            fromId: senderSocketId,
            sdp,
        });
    }

    forwardAnswer(roomId: string, senderSocketId: string, targetSocketId: string, sdp: SessionDescriptionPayload) {
        const room = this.assertSenderInRoom(senderSocketId, roomId);
        if (!room) return;
        if (!room.participants.has(senderSocketId) || !room.participants.has(targetSocketId)) return;
        const targetUser = room.participants.get(targetSocketId);
        if (!targetUser) return;
        this.touch(room);
        targetUser.socket.emit("answer", {
            roomId: this.normalizeRoomId(roomId),
            fromId: senderSocketId,
            sdp,
        });
    }

    forwardIceCandidate(
        roomId: string,
        senderSocketId: string,
        targetSocketId: string,
        candidate: IceCandidatePayload
    ) {
        const room = this.assertSenderInRoom(senderSocketId, roomId);
        if (!room) return;
        if (!room.participants.has(senderSocketId) || !room.participants.has(targetSocketId)) return;
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
        const room = this.assertSenderInRoom(senderSocketId, roomId);
        if (!room || !room.participants.has(senderSocketId)) return;

        const normalized = this.normalizeRoomId(roomId);

        if (isSharing) {
            const previousSharer = room.screenSharerId;
            if (previousSharer && previousSharer !== senderSocketId) {
                const prevUser = room.participants.get(previousSharer);
                prevUser?.socket.emit("screen-share-revoked", {
                    roomId: normalized,
                    newSharerId: senderSocketId,
                });
                prevUser?.socket.emit("screen-share-status", {
                    roomId: normalized,
                    senderId: previousSharer,
                    isSharing: false,
                    trackId: null,
                });
            }
            room.screenSharerId = senderSocketId;
        } else if (room.screenSharerId === senderSocketId) {
            room.screenSharerId = null;
        }

        room.participants.forEach((participant) => {
            participant.socket.emit("screen-share-status", {
                roomId: normalized,
                senderId: senderSocketId,
                isSharing,
                trackId,
                activeSharerId: room.screenSharerId,
            });
        });
    }

    removeUser(socketId: string) {
        const located = this.getRoomForSocket(socketId);
        if (!located) {
            this.userRoomMap.delete(socketId);
            return;
        }

        const { room, roomId } = located;
        this.evictSocket(room, roomId, socketId);

        if (room.participants.size === 0) {
            room.lastActivityAt = Date.now();
        }
    }
}
