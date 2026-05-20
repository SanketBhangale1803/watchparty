const CLIENT_ID_KEY = "closr-client-id";

/** Stable per browser tab — sessionStorage so two tabs can join the same room as different people. */
export function getClientId(): string {
    try {
        let id = sessionStorage.getItem(CLIENT_ID_KEY);
        if (!id) {
            id = crypto.randomUUID();
            sessionStorage.setItem(CLIENT_ID_KEY, id);
        }
        return id;
    } catch {
        return crypto.randomUUID();
    }
}

export function saveRoomSecret(roomId: string, secret: string) {
    try {
        sessionStorage.setItem(`closr-secret-${roomId.toUpperCase()}`, secret);
    } catch {
        /* private mode / quota */
    }
}

export function loadRoomSecret(roomId: string): string | null {
    try {
        return sessionStorage.getItem(`closr-secret-${roomId.toUpperCase()}`);
    } catch {
        return null;
    }
}

/** Prefer token in URLs — the long-lived room key stays in sessionStorage for the host only. */
export function saveInviteToken(roomId: string, token: string) {
    try {
        sessionStorage.setItem(`closr-invite-${roomId.toUpperCase()}`, token);
    } catch {
        /* ignore */
    }
}

export function loadInviteToken(roomId: string): string | null {
    try {
        return sessionStorage.getItem(`closr-invite-${roomId.toUpperCase()}`);
    } catch {
        return null;
    }
}

export type ActiveRoomSession = {
    roomId: string;
    isHost: boolean;
};

const ACTIVE_ROOM_KEY = "closr-active-room";

/** Remember which room this tab is in so socket reconnects re-join instead of creating a new room. */
export function saveActiveRoomSession(roomId: string, isHost: boolean) {
    try {
        sessionStorage.setItem(
            ACTIVE_ROOM_KEY,
            JSON.stringify({ roomId: roomId.toUpperCase(), isHost })
        );
    } catch {
        /* ignore */
    }
}

export function loadActiveRoomSession(): ActiveRoomSession | null {
    try {
        const raw = sessionStorage.getItem(ACTIVE_ROOM_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ActiveRoomSession;
        if (!parsed?.roomId) return null;
        return { roomId: parsed.roomId.toUpperCase(), isHost: Boolean(parsed.isHost) };
    } catch {
        return null;
    }
}

export function clearActiveRoomSession() {
    try {
        sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    } catch {
        /* ignore */
    }
}

export function buildInviteLink(roomId: string, inviteToken: string): string {
    const url = new URL(window.location.origin);
    url.searchParams.set("room", roomId);
    url.searchParams.set("t", inviteToken);
    return url.toString();
}

export function parseInviteFromUrl(searchParams: URLSearchParams): {
    roomId: string | null;
    inviteToken: string | null;
    legacySecret: string | null;
} {
    const roomId = searchParams.get("room")?.trim().toUpperCase() || null;
    const inviteToken =
        searchParams.get("t")?.trim() || searchParams.get("token")?.trim() || null;
    const legacySecret = searchParams.get("key")?.trim() || null;
    return { roomId, inviteToken, legacySecret };
}
