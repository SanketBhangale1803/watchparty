/** ICE servers for WebRTC — STUN for NAT discovery; TURN for relay when P2P fails (mobile / international). */
export function getIceServers(): RTCIceServer[] {
    const servers: RTCIceServer[] = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
    ];

    const turnUrl = import.meta.env.VITE_TURN_URL?.trim();
    const turnUser = import.meta.env.VITE_TURN_USERNAME?.trim();
    const turnCred = import.meta.env.VITE_TURN_CREDENTIAL?.trim();

    if (turnUrl && turnUser && turnCred) {
        servers.push({
            urls: turnUrl.includes(",")
                ? turnUrl.split(",").map((u: string) => u.trim())
                : turnUrl,
            username: turnUser,
            credential: turnCred,
        });
        return servers;
    }

    // Public relay fallback — helps guests on mobile / strict NAT / different countries.
    if (import.meta.env.PROD) {
        servers.push({
            urls: [
                "turn:openrelay.metered.ca:80",
                "turn:openrelay.metered.ca:443",
                "turn:openrelay.metered.ca:443?transport=tcp",
            ],
            username: "openrelayproject",
            credential: "openrelayproject",
        });
    }

    return servers;
}

export function getPeerConnectionConfig(): RTCConfiguration {
    return {
        iceServers: getIceServers(),
        iceCandidatePoolSize: 8,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
    };
}

export function isMobileDevice(): boolean {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}
