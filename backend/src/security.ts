import crypto from "crypto";

/** Server pepper for scrypt/HMAC — set INVITE_SIGNING_KEY in production. */
const SIGNING_KEY =
    process.env.INVITE_SIGNING_KEY?.trim() ||
    process.env.ROOM_SECRET_PEPPER?.trim() ||
    "";

function signingKey(): string {
    if (SIGNING_KEY.length >= 16) {
        return SIGNING_KEY;
    }
    // Dev fallback only; production should set INVITE_SIGNING_KEY.
    return "closr-dev-insecure-pepper";
}

function timingSafeEqualBytes(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

export function hashRoomSecret(secret: string): string {
    return crypto.scryptSync(secret.trim(), signingKey(), 32).toString("hex");
}

export function verifyRoomSecret(provided: string, storedHashHex: string): boolean {
    if (!isValidRoomSecret(provided)) return false;
    const computed = hashRoomSecret(provided);
    try {
        const a = Buffer.from(computed, "hex");
        const b = Buffer.from(storedHashHex, "hex");
        if (a.length !== b.length) return false;
        return timingSafeEqualBytes(a, b);
    } catch {
        return false;
    }
}

export function sanitizeDisplayName(raw: string | undefined): string | null {
    const stripped = (raw ?? "")
        .trim()
        .replace(/[\x00-\x1f\x7f]/g, "")
        .replace(/<[^>]*>/g, "");
    if (stripped.length < 1 || stripped.length > 40) return null;
    if (!/^[\p{L}\p{N}\s._'\-]+$/u.test(stripped)) return null;
    return stripped;
}

export function isValidClientId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id.trim()
    );
}

const ROOM_ID_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6,8}$/;

export function isValidRoomId(id: string): boolean {
    return ROOM_ID_RE.test(id.trim().toUpperCase());
}

export function isValidRoomSecret(secret: string): boolean {
    return /^[a-f0-9]{48}$/i.test(secret.trim());
}

const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** Short-lived token for invite links (room key stays out of the URL). */
export function createInviteToken(roomId: string, ttlMs = DEFAULT_INVITE_TTL_MS): string {
    const normalized = roomId.trim().toUpperCase();
    const exp = Date.now() + ttlMs;
    const payload = `${normalized}:${exp}`;
    const sig = crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");
    return Buffer.from(`${exp}.${sig}`, "utf8").toString("base64url");
}

export function verifyInviteToken(roomId: string, token: string): boolean {
    try {
        const decoded = Buffer.from(token.trim(), "base64url").toString("utf8");
        const dot = decoded.indexOf(".");
        if (dot < 0) return false;
        const exp = Number(decoded.slice(0, dot));
        const sig = decoded.slice(dot + 1);
        if (!Number.isFinite(exp) || Date.now() > exp) return false;

        const normalized = roomId.trim().toUpperCase();
        const payload = `${normalized}:${exp}`;
        const expected = crypto
            .createHmac("sha256", signingKey())
            .update(payload)
            .digest("base64url");

        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length) return false;
        return timingSafeEqualBytes(a, b);
    } catch {
        return false;
    }
}

export const ROOM_MAX_LIFETIME_MS = Number(process.env.ROOM_MAX_LIFETIME_MS) || 4 * 60 * 60 * 1000;
/** How long an empty room with no prior guests may stay in memory. */
export const ROOM_EMPTY_TTL_MS = Number(process.env.ROOM_EMPTY_TTL_MS) || 30 * 60 * 1000;
/** Empty room retention when someone has joined before (reconnect / brief disconnect). */
export const ROOM_EMPTY_KNOWN_CLIENTS_TTL_MS =
    Number(process.env.ROOM_EMPTY_KNOWN_CLIENTS_TTL_MS) || 2 * 60 * 60 * 1000;
