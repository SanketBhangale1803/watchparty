import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { clearActiveRoomSession, parseInviteFromUrl, saveInviteToken } from "../lib/session";
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
    const [inviteToken, setInviteToken] = useState("");
    const [legacyRoomKey, setLegacyRoomKey] = useState("");
    const [searchParams] = useSearchParams();
    const streamRef = useRef<MediaStream | null>(null);

    const hasInviteFromUrl = Boolean(inviteToken.trim() || legacyRoomKey.trim());
    const [entryMode, setEntryMode] = useState<"join" | "create">("create");

    useEffect(() => {
        if (hasInviteFromUrl) setEntryMode("join");
    }, [hasInviteFromUrl]);

    useEffect(() => {
        const { roomId: r, inviteToken: t, legacySecret } = parseInviteFromUrl(searchParams);
        if (r) setRoomId(r);
        if (t) setInviteToken(t);
        if (r && t) saveInviteToken(r, t);
        if (legacySecret) setLegacyRoomKey(legacySecret);
    }, [searchParams]);

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
                    noiseSuppression: false,
                    autoGainControl: false,
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
                mode={requestedRoomId ? "join" : "create"}
                demoRoomId={requestedRoomId}
                demoInviteToken={inviteToken.trim() || undefined}
                demoRoomSecret={legacyRoomKey.trim() || undefined}
            />
        );
    }

    const handleJoin = () => {
        const joinId = roomId.trim();
        if (!joinId || (!inviteToken.trim() && !legacyRoomKey.trim())) return;
        setRequestedRoomId(joinId);
        setJoined(true);
    };

    const handleCreate = () => {
        clearActiveRoomSession();
        setRequestedRoomId(undefined);
        setRoomId("");
        setJoined(true);
    };

    return (
        <div className="landing-page app-backdrop fade-in">
            <header className="landing-header">
                <div className="landing-header__brand">
                    <img src="/logo.png" alt="Closr" className="landing-header__logo" width={36} height={36} />
                    <div>
                        <div className="landing-header__title">Closr</div>
                        <div className="landing-header__tag">Video calls, simply</div>
                    </div>
                </div>
                <span className="status-pill" aria-hidden>
                    <span className="status-dot" />
                    Live
                </span>
            </header>

            <main className="landing-main">
                <div className="landing-grid">
                    <div className="landing-preview-col">
                        <div className="landing-preview">
                            <video
                                autoPlay
                                muted
                                playsInline
                                ref={videoRef}
                                style={{ display: camEnabled ? "block" : "none" }}
                            />
                            {!camEnabled && (
                                <div className="landing-preview-off">
                                    <div className="avatar" style={{ width: 56, height: 56, fontSize: "1.5rem" }}>
                                        {(name || "You").charAt(0).toUpperCase()}
                                    </div>
                                    <span>Camera is off</span>
                                </div>
                            )}
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    pointerEvents: "none",
                                    boxShadow: "inset 0 -60px 60px -30px rgba(0,0,0,0.55)",
                                }}
                            />
                            <div className="tile-label" style={{ left: "0.5rem", bottom: "0.5rem", fontSize: "0.75rem" }}>
                                {name || "You"}
                                <span className="you-badge">Preview</span>
                            </div>
                        </div>

                        <div className="landing-controls">
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <button
                                    type="button"
                                    onClick={toggleMic}
                                    className={`ctrl-btn ${micEnabled ? "is-on" : "is-off"}`}
                                    aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
                                >
                                    <span className="msr" aria-hidden>{micEnabled ? "mic" : "mic_off"}</span>
                                </button>
                                <span className="ctrl-label">{micEnabled ? "Mic on" : "Mic off"}</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <button
                                    type="button"
                                    onClick={toggleCam}
                                    className={`ctrl-btn ${camEnabled ? "is-on" : "is-off"}`}
                                    aria-label={camEnabled ? "Turn camera off" : "Turn camera on"}
                                >
                                    <span className="msr" aria-hidden>{camEnabled ? "videocam" : "videocam_off"}</span>
                                </button>
                                <span className="ctrl-label">{camEnabled ? "Camera on" : "Camera off"}</span>
                            </div>
                        </div>

                        {mediaError && (
                            <p className="landing-hint" style={{ color: "#fecaca", textAlign: "center" }}>
                                {mediaError}
                            </p>
                        )}
                    </div>

                    <div className="landing-card card">
                        <div>
                            <h1 className="landing-card__title">
                                Video calls{" "}
                                <span className="gradient-text">built for friends</span>
                            </h1>
                            <p className="landing-card__subtitle">
                                Pick a name, jump in, and talk. No accounts, no install, no ads.
                            </p>
                        </div>

                        <label className="landing-label" htmlFor="landing-name">
                            Your name
                        </label>
                        <input
                            id="landing-name"
                            className="input landing-input"
                            type="text"
                            placeholder="e.g. Sanket"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />

                        {!hasInviteFromUrl && (
                            <div className="landing-tabs" role="tablist" aria-label="How to enter">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={entryMode === "create"}
                                    className={`landing-tab ${entryMode === "create" ? "is-active" : ""}`}
                                    onClick={() => setEntryMode("create")}
                                >
                                    Create room
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={entryMode === "join"}
                                    className={`landing-tab ${entryMode === "join" ? "is-active" : ""}`}
                                    onClick={() => setEntryMode("join")}
                                >
                                    Join room
                                </button>
                            </div>
                        )}

                        {(entryMode === "join" || hasInviteFromUrl) && (
                            <div className="landing-form">
                                {hasInviteFromUrl && (
                                    <p className="landing-invite-banner">
                                        Invite link detected — enter your name and join.
                                    </p>
                                )}
                                <label className="landing-label" htmlFor="landing-room">
                                    Room code
                                </label>
                                <input
                                    id="landing-room"
                                    className="input landing-input"
                                    type="text"
                                    placeholder="From invite link"
                                    value={roomId}
                                    onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                                    style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
                                />
                                {!hasInviteFromUrl && (
                                    <>
                                        <label className="landing-label" htmlFor="landing-token">
                                            Invite token
                                        </label>
                                        <input
                                            id="landing-token"
                                            className="input landing-input"
                                            type="text"
                                            placeholder="Paste ?t=… from invite link"
                                            value={inviteToken || legacyRoomKey}
                                            onChange={(e) => {
                                                setInviteToken(e.target.value.trim());
                                                setLegacyRoomKey("");
                                            }}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                    </>
                                )}
                                <div className="landing-actions">
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        disabled={
                                            !name.trim() ||
                                            !roomId.trim() ||
                                            (!hasInviteFromUrl &&
                                                !inviteToken.trim() &&
                                                !legacyRoomKey.trim())
                                        }
                                        onClick={handleJoin}
                                    >
                                        Join room
                                    </button>
                                </div>
                                <p className="landing-hint">
                                    Use the host&apos;s full invite link. Room codes alone cannot be guessed to join.
                                </p>
                            </div>
                        )}

                        {entryMode === "create" && !hasInviteFromUrl && (
                            <div className="landing-form">
                                <p className="landing-hint">
                                    Start a new room and share the invite link with friends.
                                </p>
                                <div className="landing-actions">
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        disabled={!name.trim()}
                                        onClick={handleCreate}
                                    >
                                        Create new room
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="landing-features">
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                                <span className="msr sm" aria-hidden>lock</span>
                                Peer-to-peer
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                                <span className="msr sm" aria-hidden>bolt</span>
                                Low-latency audio
                            </span>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};
