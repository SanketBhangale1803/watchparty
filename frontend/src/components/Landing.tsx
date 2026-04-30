import { useEffect, useRef, useState } from "react"
import { Room } from "./Room";

export const Landing = () => {
    const [name, setName] = useState("");
    const [localAudioTrack, setLocalAudioTrack] = useState<MediaStreamTrack | null>(null);
    const [localVideoTrack, setlocalVideoTrack] = useState<MediaStreamTrack | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [joined, setJoined] = useState(false);
    const [micEnabled, setMicEnabled] = useState(true);
    const [camEnabled, setCamEnabled] = useState(true);
    const [mediaError, setMediaError] = useState<string | null>(null);

    const getCam = async () => {
        try {
            setMediaError(null);
            const stream = await window.navigator.mediaDevices.getUserMedia({
                video: camEnabled,
                audio: micEnabled ? {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                } : false,
            })
            const audioTrack = stream.getAudioTracks()[0]
            const videoTrack = stream.getVideoTracks()[0]
            setLocalAudioTrack(audioTrack ?? null);
            setlocalVideoTrack(videoTrack ?? null);
            if (videoRef.current && videoTrack) {
                videoRef.current.srcObject = new MediaStream([videoTrack])
                videoRef.current.play();
            }
        } catch (e) {
            console.error("Error accessing media devices:", e);
            setMediaError("Could not access camera/microphone. Please check permissions.");
        }
    }

    useEffect(() => {
        getCam();
    }, []);

    const toggleMic = async () => {
        if (micEnabled) {
            localAudioTrack?.stop();
            setLocalAudioTrack(null);
            setMicEnabled(false);
        } else {
            await getCam();
            setMicEnabled(true);
        }
    };

    const toggleCam = async () => {
        if (camEnabled) {
            localVideoTrack?.stop();
            setlocalVideoTrack(null);
            if (videoRef.current) videoRef.current.srcObject = null;
            setCamEnabled(false);
        } else {
            await getCam();
            setCamEnabled(true);
        }
    };

    const [roomId, setRoomId] = useState("");

    if (!joined) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                flexDirection: "column",
            }}>
                {/* Header */}
                <header style={{
                    padding: "1rem 2rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg-card)",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "12px",
                            background: "linear-gradient(135deg, var(--primary), #7c3aed)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "white",
                            fontSize: "1.25rem",
                        }}>
                            ▶
                        </div>
                        <span style={{ fontWeight: 700, fontSize: "1.25rem" }}>WatchParty</span>
                    </div>
                </header>

                {/* Main content */}
                <div style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "2rem",
                    background: "var(--bg-main)",
                }}>
                    <div className="landing-grid" style={{
                        width: "100%",
                        maxWidth: "900px",
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "3rem",
                        alignItems: "center",
                    }}>
                        {/* Left: Video preview */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                            <div className="card" style={{ padding: 0, overflow: "hidden", aspectRatio: "16/9" }}>
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
                                        display: "block",
                                    }}
                                />
                                {!camEnabled && (
                                    <div style={{
                                        position: "absolute",
                                        inset: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        background: "#1e293b",
                                        color: "var(--text-muted)",
                                        fontSize: "3rem",
                                    }}>
                                        📷
                                    </div>
                                )}
                            </div>

                            {/* Device toggles */}
                            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
                                <button
                                    onClick={toggleMic}
                                    style={{
                                        width: "48px",
                                        height: "48px",
                                        borderRadius: "50%",
                                        border: "none",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: "1.25rem",
                                        background: micEnabled ? "white" : "var(--danger)",
                                        color: micEnabled ? "var(--text-main)" : "white",
                                        boxShadow: "var(--shadow-md)",
                                        transition: "all 0.2s",
                                    }}
                                    title={micEnabled ? "Mute microphone" : "Unmute microphone"}
                                >
                                    {micEnabled ? "🎤" : "🔇"}
                                </button>
                                <button
                                    onClick={toggleCam}
                                    style={{
                                        width: "48px",
                                        height: "48px",
                                        borderRadius: "50%",
                                        border: "none",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: "1.25rem",
                                        background: camEnabled ? "white" : "var(--danger)",
                                        color: camEnabled ? "var(--text-main)" : "white",
                                        boxShadow: "var(--shadow-md)",
                                        transition: "all 0.2s",
                                    }}
                                    title={camEnabled ? "Turn off camera" : "Turn on camera"}
                                >
                                    {camEnabled ? "📹" : "📷"}
                                </button>
                            </div>

                            {mediaError && (
                                <p style={{
                                    color: "var(--danger)",
                                    fontSize: "0.85rem",
                                    textAlign: "center",
                                    background: "#fef2f2",
                                    padding: "0.5rem 1rem",
                                    borderRadius: "0.5rem",
                                }}>
                                    {mediaError}
                                </p>
                            )}
                        </div>

                        {/* Right: Join form */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                            <div>
                                <h1 style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.2 }}>
                                    Watch & connect
                                    <br />
                                    <span style={{
                                        background: "linear-gradient(135deg, var(--primary), #7c3aed)",
                                        WebkitBackgroundClip: "text",
                                        WebkitTextFillColor: "transparent",
                                    }}>
                                        together
                                    </span>
                                </h1>
                                <p style={{ color: "var(--text-muted)", marginTop: "0.75rem", fontSize: "1.05rem" }}>
                                    Share screens, watch videos, and hang out with friends in real-time.
                                </p>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                                <input
                                    className="input"
                                    type="text"
                                    placeholder="Your name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    style={{ fontSize: "1rem", padding: "0.875rem 1rem" }}
                                />

                                <div style={{ display: "flex", gap: "0.75rem" }}>
                                    <input
                                        className="input"
                                        type="text"
                                        placeholder="Room ID to join"
                                        value={roomId}
                                        onChange={(e) => setRoomId(e.target.value)}
                                        style={{ fontSize: "1rem", padding: "0.875rem 1rem" }}
                                    />
                                    <button
                                        className="btn btn-primary"
                                        disabled={!name || !roomId}
                                        onClick={() => setJoined(true)}
                                        style={{ minWidth: "110px", padding: "0.875rem 1.5rem" }}
                                    >
                                        Join
                                    </button>
                                </div>

                                <div style={{ position: "relative", margin: "0.5rem 0" }}>
                                    <div style={{
                                        position: "absolute",
                                        left: 0,
                                        right: 0,
                                        top: "50%",
                                        height: "1px",
                                        background: "var(--border)",
                                    }} />
                                    <span style={{
                                        position: "relative",
                                        background: "var(--bg-main)",
                                        padding: "0 12px",
                                        color: "var(--text-muted)",
                                        fontSize: "0.875rem",
                                    }}>
                                        or
                                    </span>
                                </div>

                                <button
                                    className="btn btn-secondary"
                                    disabled={!name}
                                    onClick={() => {
                                        setRoomId("");
                                        setJoined(true);
                                    }}
                                    style={{
                                        width: "100%",
                                        padding: "0.875rem 1.5rem",
                                        fontSize: "1rem",
                                    }}
                                >
                                    Create New Room
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return <Room name={name} localAudioTrack={localAudioTrack} localVideoTrack={localVideoTrack} demoRoomId={roomId} />
}
