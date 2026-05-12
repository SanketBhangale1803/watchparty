import { useEffect, useRef, useState } from "react";
import { Room } from "./Room";

export const Landing = () => {
    const [name, setName] = useState("");
    const [localAudioTrack, setLocalAudioTrack] = useState<MediaStreamTrack | null>(null);
    const [localVideoTrack, setlocalVideoTrack] = useState<MediaStreamTrack | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [joined, setJoined] = useState(false);
    const [requestedRoomId, setRequestedRoomId] = useState<string | undefined>(undefined);
    const [micEnabled, setMicEnabled] = useState(true);
    const [camEnabled, setCamEnabled] = useState(true);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [roomId, setRoomId] = useState("");
    const streamRef = useRef<MediaStream | null>(null);

    const getCam = async () => {
        try {
            setMediaError(null);
            const stream = await window.navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 },
                },
                audio: {
                    echoCancellation: true,
                    // Heavy DSP often sounds metallic/robotic on many devices.
                    noiseSuppression: false,
                    autoGainControl: true,
                    channelCount: 1,
                },
            });
            streamRef.current = stream;
            const audioTrack = stream.getAudioTracks()[0];
            const videoTrack = stream.getVideoTracks()[0];
            setLocalAudioTrack(audioTrack);
            setlocalVideoTrack(videoTrack);
            if (videoRef.current) {
                videoRef.current.srcObject = new MediaStream([videoTrack]);
                videoRef.current.play().catch(() => {});
            }
        } catch (e) {
            console.error("Error accessing media devices:", e);
            setMediaError("We couldn't access your camera or mic. Check the browser permissions and try again.");
        }
    };

    useEffect(() => {
        getCam();
        return () => {
            streamRef.current?.getTracks().forEach((t) => t.stop());
        };
    }, []);

    const toggleMic = () => {
        if (localAudioTrack) {
            localAudioTrack.enabled = !localAudioTrack.enabled;
            setMicEnabled(localAudioTrack.enabled);
        }
    };

    const toggleCam = () => {
        if (!localVideoTrack) return;
        localVideoTrack.enabled = !localVideoTrack.enabled;
        setCamEnabled(localVideoTrack.enabled);
        if (!localVideoTrack.enabled && videoRef.current) {
            videoRef.current.srcObject = null;
        } else if (localVideoTrack.enabled && videoRef.current && streamRef.current) {
            const videoTrack = streamRef.current.getVideoTracks()[0];
            if (videoTrack) {
                videoRef.current.srcObject = new MediaStream([videoTrack]);
                videoRef.current.play().catch(() => {});
            }
        }
    };

    if (joined) {
        return (
            <Room
                name={name}
                localAudioTrack={localAudioTrack}
                localVideoTrack={localVideoTrack}
                demoRoomId={requestedRoomId}
            />
        );
    }

    return (
        <div className="app-backdrop" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
            <header
                style={{
                    padding: "1.1rem 2rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "1px solid var(--border)",
                    background: "rgba(11, 15, 26, 0.65)",
                    backdropFilter: "blur(14px)",
                    WebkitBackdropFilter: "blur(14px)",
                    position: "sticky",
                    top: 0,
                    zIndex: 5,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
                    <div
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 12,
                            background: "linear-gradient(135deg, var(--primary), var(--accent))",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "white",
                            fontWeight: 800,
                            fontSize: "1.1rem",
                            boxShadow: "0 10px 30px -10px var(--primary-glow)",
                        }}
                        aria-hidden
                    >
                        C
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontWeight: 800, fontSize: "1.15rem", letterSpacing: "-0.01em" }}>
                            Closr
                        </span>
                        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                            Video calls, simply
                        </span>
                    </div>
                </div>

                <span className="status-pill" aria-hidden>
                    <span className="status-dot" />
                    Live
                </span>
            </header>

            <main
                className="fade-in"
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "2rem",
                }}
            >
                <div
                    className="landing-grid"
                    style={{
                        width: "100%",
                        maxWidth: "1040px",
                        display: "grid",
                        gridTemplateColumns: "1.05fr 1fr",
                        gap: "3rem",
                        alignItems: "center",
                    }}
                >
                    {/* Left: live preview */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                        <div
                            style={{
                                position: "relative",
                                borderRadius: "var(--radius-lg)",
                                overflow: "hidden",
                                aspectRatio: "16/9",
                                background: "#000",
                                border: "1px solid var(--border)",
                                boxShadow: "var(--shadow-lg)",
                            }}
                        >
                            <video
                                autoPlay
                                muted
                                playsInline
                                ref={videoRef}
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    transform: "scaleX(-1)",
                                    background: "#000",
                                    display: camEnabled ? "block" : "none",
                                }}
                            />
                            {!camEnabled && (
                                <div
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flexDirection: "column",
                                        gap: "0.75rem",
                                        background:
                                            "radial-gradient(60% 60% at 50% 40%, rgba(99,102,241,0.18), transparent 70%), #0d1322",
                                        color: "var(--text-muted)",
                                    }}
                                >
                                    <div className="avatar" style={{ width: 80, height: 80, fontSize: "2.1rem" }}>
                                        {(name || "You").charAt(0).toUpperCase()}
                                    </div>
                                    <span style={{ fontSize: "0.85rem" }}>Camera is off</span>
                                </div>
                            )}

                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    pointerEvents: "none",
                                    boxShadow: "inset 0 -80px 80px -40px rgba(0,0,0,0.6)",
                                }}
                            />

                            <div
                                className="tile-label"
                                style={{ left: "0.75rem", bottom: "0.75rem" }}
                            >
                                {name || "You"}
                                <span className="you-badge">Preview</span>
                            </div>
                        </div>

                        <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <button
                                    type="button"
                                    onClick={toggleMic}
                                    className={`ctrl-btn ${micEnabled ? "is-on" : "is-off"}`}
                                    aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
                                    title={micEnabled ? "Mute microphone" : "Unmute microphone"}
                                >
                                    {micEnabled ? "🎙️" : "🔇"}
                                </button>
                                <span className="ctrl-label">{micEnabled ? "Mic on" : "Mic off"}</span>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <button
                                    type="button"
                                    onClick={toggleCam}
                                    className={`ctrl-btn ${camEnabled ? "is-on" : "is-off"}`}
                                    aria-label={camEnabled ? "Turn camera off" : "Turn camera on"}
                                    title={camEnabled ? "Turn camera off" : "Turn camera on"}
                                >
                                    {camEnabled ? "📹" : "🚫"}
                                </button>
                                <span className="ctrl-label">{camEnabled ? "Camera on" : "Camera off"}</span>
                            </div>
                        </div>

                        {mediaError && (
                            <p
                                style={{
                                    color: "#fecaca",
                                    fontSize: "0.85rem",
                                    textAlign: "center",
                                    background: "rgba(239, 68, 68, 0.12)",
                                    border: "1px solid rgba(239, 68, 68, 0.35)",
                                    padding: "0.65rem 1rem",
                                    borderRadius: "0.75rem",
                                }}
                            >
                                {mediaError}
                            </p>
                        )}
                    </div>

                    {/* Right: join card */}
                    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                        <div>
                            <h1
                                style={{
                                    fontSize: "2.1rem",
                                    fontWeight: 800,
                                    lineHeight: 1.15,
                                    letterSpacing: "-0.02em",
                                }}
                            >
                                Video calls
                                <br />
                                <span className="gradient-text">built for friends</span>
                            </h1>
                            <p
                                style={{
                                    color: "var(--text-muted)",
                                    marginTop: "0.75rem",
                                    fontSize: "1rem",
                                    lineHeight: 1.55,
                                }}
                            >
                                Pick a name, jump in, and talk. No accounts, no install, no ads.
                            </p>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                            <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                                Your name
                            </label>
                            <input
                                className="input"
                                type="text"
                                placeholder="e.g. Alex"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />

                            <label
                                style={{
                                    fontSize: "0.75rem",
                                    color: "var(--text-muted)",
                                    letterSpacing: "0.06em",
                                    textTransform: "uppercase",
                                    marginTop: "0.25rem",
                                }}
                            >
                                Room code
                            </label>
                            <div style={{ display: "flex", gap: "0.6rem" }}>
                                <input
                                    className="input"
                                    type="text"
                                    placeholder="6-character code"
                                    value={roomId}
                                    onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                                    style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}
                                />
                                <button
                                    className="btn btn-primary"
                                    disabled={!name.trim() || !roomId.trim()}
                                    onClick={() => {
                                        const joinId = roomId.trim();
                                        if (!joinId) return;
                                        setRequestedRoomId(joinId);
                                        setJoined(true);
                                    }}
                                    style={{ minWidth: "110px" }}
                                >
                                    Join
                                </button>
                            </div>

                            <div style={{ position: "relative", margin: "0.4rem 0" }}>
                                <div
                                    style={{
                                        position: "absolute",
                                        left: 0,
                                        right: 0,
                                        top: "50%",
                                        height: 1,
                                        background: "var(--border)",
                                    }}
                                />
                                <span
                                    style={{
                                        position: "relative",
                                        background: "var(--bg-surface)",
                                        padding: "0 12px",
                                        color: "var(--text-faint)",
                                        fontSize: "0.78rem",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.08em",
                                    }}
                                >
                                    or
                                </span>
                            </div>

                            <button
                                className="btn btn-secondary"
                                disabled={!name.trim()}
                                onClick={() => {
                                    setRequestedRoomId(undefined);
                                    setRoomId("");
                                    setJoined(true);
                                }}
                                style={{ width: "100%", padding: "0.95rem 1.5rem", fontSize: "0.95rem" }}
                            >
                                Create new room
                            </button>
                        </div>

                        <div
                            style={{
                                borderTop: "1px solid var(--border)",
                                paddingTop: "1rem",
                                display: "flex",
                                gap: "1rem",
                                color: "var(--text-muted)",
                                fontSize: "0.78rem",
                            }}
                        >
                            <span>🔒 End-to-end peer-to-peer</span>
                            <span>⚡ Low-latency Opus audio</span>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};
