const HOST_CLIENT_ID_KEY = "closr-client-id";
const TAB_CLIENT_ID_KEY = "closr-tab-client-id";

/**
 * Host: stable id in localStorage (survives refresh/reconnect).
 * Guest: per-tab id in sessionStorage so two tabs are two participants.
 */
export function getClientId(role: "create" | "join" = "join"): string {
    const storageKey = role === "create" ? HOST_CLIENT_ID_KEY : TAB_CLIENT_ID_KEY;
    const storage = role === "create" ? localStorage : sessionStorage;
    try {
        let id = storage.getItem(storageKey);
        if (!id) {
            id = crypto.randomUUID();
            storage.setItem(storageKey, id);
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

export type ParsedInvite = {
    roomId: string;
    inviteToken: string | null;
    legacySecret: string | null;
};

function inviteFromSearchParams(params: URLSearchParams): ParsedInvite | null {
    const roomId = params.get("room")?.trim().toUpperCase() || null;
    if (!roomId) return null;

    const inviteToken =
        params.get("t")?.trim() || params.get("token")?.trim() || null;
    const legacySecret = params.get("key")?.trim() || null;

    if (inviteToken || legacySecret) {
        return { roomId, inviteToken, legacySecret };
    }
    return null;
}

export function parseInviteFromUrl(searchParams: URLSearchParams): {
    roomId: string | null;
    inviteToken: string | null;
    legacySecret: string | null;
} {
    const parsed = inviteFromSearchParams(searchParams);
    return {
        roomId: parsed?.roomId ?? null,
        inviteToken: parsed?.inviteToken ?? null,
        legacySecret: parsed?.legacySecret ?? null,
    };
}

/**
 * Parse a pasted invite link. Room codes alone are rejected — a token (?t=) or legacy key (?key=) is required.
 */
export function parseInviteLinkInput(raw: string): ParsedInvite | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const origin =
        typeof window !== "undefined" ? window.location.origin : "https://closr.local";

    const tryParse = (href: string): ParsedInvite | null => {
        try {
            return inviteFromSearchParams(new URL(href).searchParams);
        } catch {
            return null;
        }
    };

    if (/^https?:\/\//i.test(trimmed)) {
        return tryParse(trimmed);
    }

    if (trimmed.includes("room=")) {
        const qIndex = trimmed.indexOf("?");
        const query = qIndex >= 0 ? trimmed.slice(qIndex) : `?${trimmed}`;
        const normalized = query.startsWith("?") ? query : `?${query}`;
        return tryParse(`${origin}${normalized}`);
    }

    return null;
}

export function isValidInviteCredentials(
    roomId: string,
    inviteToken: string,
    legacySecret: string
): boolean {
    if (!roomId.trim()) return false;
    return Boolean(inviteToken.trim() || legacySecret.trim());
}
