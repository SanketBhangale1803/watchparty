import { Socket } from "socket.io";
import { RateLimiter } from "../rateLimit";
import { isValidClientId, isValidRoomSecret, sanitizeDisplayName } from "../security";
import { RoomManager } from "./RoomManager";

export interface User {
    socket: Socket;
    name: string;
    clientId: string;
}

const stamp = () => new Date().toISOString();

/** Same message for not_found / forbidden / expired to prevent room enumeration. */
const JOIN_DENIED =
    "Could not join this room. Check your invite link or ask the host for a new one.";

export class UserManager {
    private users: Map<string, User>;
    private roomManager: RoomManager;
    private joinLimiter = new RateLimiter();
    private createLimiter = new RateLimiter();

    constructor() {
        this.users = new Map<string, User>();
        this.roomManager = new RoomManager();
    }

    addUser(socket: Socket) {
        this.users.set(socket.id, { name: "", socket, clientId: "" });
        this.initHandlers(socket);
    }

    removeUser(socketId: string) {
        this.users.delete(socketId);
        this.roomManager.removeUser(socketId);
    }

    getUserName(socketId: string): string | undefined {
        const name = this.users.get(socketId)?.name;
        return name && name.length > 0 ? name : undefined;
    }

    getUserRoom(socketId: string): string | undefined {
        return this.roomManager.getUserRoom(socketId);
    }

    private socketKey(socket: Socket): string {
        return socket.handshake.address || socket.id;
    }

    private joinError(socket: Socket, message: string = JOIN_DENIED) {
        socket.emit("room-join-error", { message });
    }

    private initHandlers(socket: Socket) {
        socket.on(
            "create-room",
            ({ name, clientId }: { name?: string; clientId?: string }) => {
                const key = this.socketKey(socket);
                if (!this.createLimiter.tryConsume(key, 8, 60_000)) {
                    this.joinError(socket, "Too many rooms created. Please wait a minute.");
                    return;
                }

                const user = this.users.get(socket.id);
                if (!user) return;

                const displayName = sanitizeDisplayName(name);
                if (!displayName) {
                    this.joinError(socket, "Please enter a valid display name (letters and numbers only).");
                    return;
                }
                if (!clientId?.trim() || !isValidClientId(clientId)) {
                    this.joinError(socket, "Invalid client identity.");
                    return;
                }

                user.name = displayName;
                user.clientId = clientId.trim();

                const { roomId, roomSecret, inviteToken } = this.roomManager.createRoom(user);
                console.log(
                    `[${stamp()}] [create]     socket=${socket.id} user="${user.name}" room=${roomId} size=1`
                );
                socket.emit("room-created", { roomId, roomSecret, inviteToken });
                socket.emit("room-joined", { roomId, participants: [] });
            }
        );

        socket.on(
            "join-room",
            ({
                name,
                roomId,
                roomSecret,
                inviteToken,
                clientId,
            }: {
                name?: string;
                roomId: string;
                roomSecret?: string;
                inviteToken?: string;
                clientId?: string;
            }) => {
                const key = this.socketKey(socket);
                if (!this.joinLimiter.tryConsume(key, 20, 60_000)) {
                    this.joinError(socket, "Too many join attempts. Please wait a minute.");
                    return;
                }

                const user = this.users.get(socket.id);
                if (!user || !roomId) return;

                const displayName = sanitizeDisplayName(name);
                if (!displayName) {
                    this.joinError(socket, "Please enter a valid display name (letters and numbers only).");
                    return;
                }
                if (!clientId?.trim() || !isValidClientId(clientId)) {
                    this.joinError(socket, "Invalid client identity.");
                    return;
                }

                const hasSecret = roomSecret?.trim() && isValidRoomSecret(roomSecret);
                const hasToken = Boolean(inviteToken?.trim());
                if (!hasSecret && !hasToken) {
                    this.joinError(socket, "Missing invite link or room key.");
                    return;
                }

                user.name = displayName;
                user.clientId = clientId.trim();

                const result = this.roomManager.joinRoom(roomId, user, {
                    roomSecret: hasSecret ? roomSecret : undefined,
                    inviteToken: hasToken ? inviteToken : undefined,
                });

                if (!result.ok) {
                    this.joinLimiter.recordFailure(key, 60_000);
                    const messages: Record<string, string> = {
                        full: "This room is full.",
                        locked: "This room is locked for new guests. If you were already in the call, refresh and rejoin with your invite link.",
                        invalid: JOIN_DENIED,
                        not_found: JOIN_DENIED,
                        forbidden: JOIN_DENIED,
                        expired: "This room has expired. Ask the host to create a new one.",
                    };
                    console.log(
                        `[${stamp()}] [join-fail] socket=${socket.id} user="${user.name}" room=${roomId} reason=${result.reason}`
                    );
                    this.joinError(socket, messages[result.reason] ?? JOIN_DENIED);
                    return;
                }

                const size = this.roomManager.getRoomSize(result.roomId);
                console.log(
                    `[${stamp()}] [join]       socket=${socket.id} user="${user.name}" room=${result.roomId} size=${size}`
                );
                socket.emit("invite-token-refreshed", { inviteToken: result.inviteToken });
            }
        );

        socket.on("lock-room", ({ locked }: { locked: boolean }) => {
            if (!this.roomManager.setRoomLocked(socket.id, Boolean(locked))) {
                socket.emit("room-join-error", { message: "Only the host can lock this room." });
            }
        });

        socket.on("offer", ({ sdp, roomId, targetId }: { sdp: unknown; roomId: string; targetId: string }) => {
            if (!this.roomManager.getUserRoom(socket.id)) return;
            this.roomManager.forwardOffer(roomId, socket.id, targetId, sdp as never);
        });

        socket.on("answer", ({ sdp, roomId, targetId }: { sdp: unknown; roomId: string; targetId: string }) => {
            if (!this.roomManager.getUserRoom(socket.id)) return;
            this.roomManager.forwardAnswer(roomId, socket.id, targetId, sdp as never);
        });

        socket.on(
            "ice-candidate",
            ({ candidate, roomId, targetId }: { candidate: unknown; roomId: string; targetId: string }) => {
                if (!this.roomManager.getUserRoom(socket.id)) return;
                this.roomManager.forwardIceCandidate(roomId, socket.id, targetId, candidate as never);
            }
        );

        socket.on(
            "screen-share-status",
            ({
                isSharing,
                roomId,
                trackId,
            }: {
                isSharing: boolean;
                roomId: string;
                trackId: string | null;
            }) => {
                if (!this.roomManager.getUserRoom(socket.id)) return;
                this.roomManager.onScreenShareStatus(roomId, socket.id, isSharing, trackId ?? null);
            }
        );

        socket.on("leave-room", () => {
            const user = this.users.get(socket.id);
            const roomId = this.roomManager.getUserRoom(socket.id);
            console.log(
                `[${stamp()}] [leave]      socket=${socket.id} user="${user?.name ?? "?"}"` +
                    (roomId ? ` room=${roomId}` : "")
            );
            this.roomManager.removeUser(socket.id);
        });
    }
}
