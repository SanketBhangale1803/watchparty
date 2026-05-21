/** Render free tier idles out after ~15 min; ping before that while a call is active. */
const KEEPALIVE_INTERVAL_MS = 8 * 60 * 1000;

let intervalId: ReturnType<typeof setInterval> | null = null;
let healthUrl: string | null = null;

function ping() {
    if (!healthUrl) return;
    fetch(healthUrl, { method: "GET", cache: "no-store", credentials: "omit" }).catch(() => {
        /* ignore — reconnect / join logic handles a dead server */
    });
}

/** Ping signaling /health on an interval so the host does not spin down mid-call. */
export function startSignalingKeepalive(backendOrigin: string) {
    const origin = backendOrigin.trim().replace(/\/+$/, "");
    healthUrl = `${origin}/health`;
    stopSignalingKeepalive();
    ping();
    intervalId = setInterval(ping, KEEPALIVE_INTERVAL_MS);
}

export function stopSignalingKeepalive() {
    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }
    healthUrl = null;
}
