const CLIENT_ID_KEY = "closr-client-id";

export function getClientId(): string {
    try {
        let id = localStorage.getItem(CLIENT_ID_KEY);
        if (!id) {
            id = crypto.randomUUID();
            localStorage.setItem(CLIENT_ID_KEY, id);
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
