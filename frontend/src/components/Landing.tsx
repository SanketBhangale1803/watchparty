import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
    clearActiveRoomSession,
    isValidInviteCredentials,
    parseInviteFromUrl,
    parseInviteLinkInput,
    saveInviteToken,
} from "../lib/session";
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
    const [inviteLinkInput, setInviteLinkInput] = useState("");
    const [inviteLinkError, setInviteLinkError] = useState<string | null>(null);
    const [searchParams] = useSearchParams();
    const streamRef = useRef<MediaStream | null>(null);

    const hasValidInvite = isValidInviteCredentials(roomId, inviteToken, legacyRoomKey);
    const hasInviteFromUrl = Boolean(
        searchParams.get("room")?.trim() &&
            (searchParams.get("t")?.trim() ||
                searchParams.get("token")?.trim() ||
                searchParams.get("key")?.trim())
    );
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
            const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
            const stream = await window.navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "user",
                    width: { ideal: isMobile ? 640 : 1280, max: 1280 },
                    height: { ideal: isMobile ? 480 : 720, max: 720 },
                    frameRate: { ideal: 24, max: 30 },
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

    const applyInviteLink = (value: string) => {
        setInviteLinkInput(value);
        if (!value.trim()) {
            setRoomId("");
            setInviteToken("");
            setLegacyRoomKey("");
            setInviteLinkError(null);
            return;
        }

        const parsed = parseInviteLinkInput(value);
        if (!parsed) {
            setRoomId("");
            setInviteToken("");
            setLegacyRoomKey("");
            setInviteLinkError(
                "Paste the host's full invite link (must include ?room=… and ?t=…). Room codes alone won't work."
            );
            return;
        }

        setInviteLinkError(null);
        setRoomId(parsed.roomId);
        setInviteToken(parsed.inviteToken ?? "");
        setLegacyRoomKey(parsed.legacySecret ?? "");
        if (parsed.inviteToken) {
            saveInviteToken(parsed.roomId, parsed.inviteToken);
        }
    };

    const handleJoin = () => {
        if (!name.trim() || !isValidInviteCredentials(roomId, inviteToken, legacyRoomKey)) {
            if (!hasInviteFromUrl) {
                setInviteLinkError(
                    "Paste the host's full invite link (must include ?room=… and ?t=…)."
                );
            }
            return;
        }
        setRequestedRoomId(roomId.trim());
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
                                {hasInviteFromUrl ? (
                                    <p className="landing-invite-banner">
                                        Invite link detected — room{" "}
                                        <strong style={{ letterSpacing: "0.06em" }}>{roomId}</strong>
                                        . Enter your name and join.
                                    </p>
                                ) : (
                                    <>
                                        <label className="landing-label" htmlFor="landing-invite-link">
                                            Invite link
                                        </label>
                                        <input
                                            id="landing-invite-link"
                                            className="input landing-input"
                                            type="url"
                                            inputMode="url"
                                            placeholder="https://yoursite.com/?room=…&t=…"
                                            value={inviteLinkInput}
                                            onChange={(e) => applyInviteLink(e.target.value)}
                                            onPaste={(e) => {
                                                const pasted = e.clipboardData.getData("text");
                                                if (pasted) {
                                                    e.preventDefault();
                                                    applyInviteLink(pasted);
                                                }
                                            }}
                                            autoComplete="off"
                                            spellCheck={false}
                                        />
                                        {inviteLinkError && (
                                            <p className="landing-hint" style={{ color: "#fecaca" }}>
                                                {inviteLinkError}
                                            </p>
                                        )}
                                        {hasValidInvite && !inviteLinkError && (
                                            <p className="landing-invite-banner">
                                                Link OK — room <strong>{roomId}</strong>
                                            </p>
                                        )}
                                    </>
                                )}
                                <div className="landing-actions">
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        disabled={!name.trim() || !hasValidInvite}
                                        onClick={handleJoin}
                                    >
                                        Join room
                                    </button>
                                </div>
                                {!hasInviteFromUrl && (
                                    <p className="landing-hint">
                                        Ask the host to copy the full invite link from the call — not just the
                                        room code.
                                    </p>
                                )}
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
