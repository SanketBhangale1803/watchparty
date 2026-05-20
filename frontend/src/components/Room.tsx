import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Socket, io } from "socket.io-client";
import {
    buildInviteLink,
    getClientId,
    loadRoomSecret,
    saveRoomSecret,
} from "../lib/session";

const DEFAULT_BACKEND_URL = "https://closr-live.onrender.com";
const normalizeBackendUrl = (rawUrl: string): string => {
    const trimmed = rawUrl.trim().replace(/\/+$/, "");
    // Common misconfig: setting VITE_BACKEND_URL to ".../socket.io" instead of backend origin.
    return trimmed.endsWith("/socket.io") ? trimmed.slice(0, -"/socket.io".length) : trimmed;
};

const rawBackendUrl =
    import.meta.env.VITE_BACKEND_URL?.trim() ||
    (import.meta.env.PROD ? DEFAULT_BACKEND_URL : "http://localhost:3000");
const URL = normalizeBackendUrl(rawBackendUrl);

/** Screen-share tuning: defaults often optimize like a webcam (bursty keyframes, variable FPS). */
const SCREEN_SHARE_TARGET_FPS = 30;

async function prepareScreenCaptureVideoTrack(track: MediaStreamTrack): Promise<void> {
    if (track.kind !== "video") return;
    try {
        track.contentHint = "detail";
    } catch {
        /* unsupported */
    }
    try {
        await track.applyConstraints({
            frameRate: { ideal: SCREEN_SHARE_TARGET_FPS, max: SCREEN_SHARE_TARGET_FPS },
            width: { max: 1920 },
            height: { max: 1080 },
        });
    } catch {
        /* display surfaces often ignore or partially apply constraints */
    }
}

async function applyScreenShareSenderEncoding(sender: RTCRtpSender): Promise<void> {
    try {
        const params = sender.getParameters();
        const encodings: RTCRtpEncodingParameters[] =
            params.encodings?.length > 0
                ? params.encodings.map((e) => ({ ...e }))
                : [{ active: true }];

        for (const enc of encodings) {
            enc.maxFramerate = SCREEN_SHARE_TARGET_FPS;
            enc.maxBitrate =
                enc.maxBitrate != null ? Math.min(enc.maxBitrate, 8_000_000) : 8_000_000;
            // Chromium: prefer steady FPS when bandwidth is tight (DOM typings omit this field).
            (enc as RTCRtpEncodingParameters & { degradationPreference?: string }).degradationPreference =
                "maintain-framerate";
        }

        params.encodings = encodings;
        await sender.setParameters(params);
    } catch {
        /* parameters may not be applied until negotiation finishes */
    }
}

/**
 * Audio quality on WebRTC degrades to a robotic / underwater sound when the
 * audio packets compete with video for bandwidth or get dropped. Prioritize
 * the audio sender so the browser keeps it on the fast path.
 */
async function tuneAudioSender(sender: RTCRtpSender): Promise<void> {
    try {
        const params = sender.getParameters();
        const encodings: RTCRtpEncodingParameters[] =
            params.encodings?.length > 0
                ? params.encodings.map((e) => ({ ...e }))
                : [{ active: true }];

        for (const enc of encodings) {
            (enc as RTCRtpEncodingParameters & {
                networkPriority?: string;
                priority?: string;
            }).networkPriority = "high";
            (enc as RTCRtpEncodingParameters & {
                networkPriority?: string;
                priority?: string;
            }).priority = "high";
            if (enc.maxBitrate == null || enc.maxBitrate > 128_000) {
                enc.maxBitrate = 128_000;
            }
        }

        params.encodings = encodings;
        await sender.setParameters(params);
    } catch {
        /* parameters may not yet be settable; safe to ignore */
    }
}

/** Apply encoder prefs once DTLS/SRTP transport is up (and retry after signaling settles). */
function scheduleScreenShareSenderTuning(sender: RTCRtpSender): void {
    const tune = () => void applyScreenShareSenderEncoding(sender);
    tune();

    const transport = sender.transport;
    if (!transport) {
        window.setTimeout(tune, 350);
        window.setTimeout(tune, 1400);
        return;
    }

    if (transport.state === "connected") {
        tune();
        return;
    }

    const onState = () => {
        if (transport.state === "connected") {
            transport.removeEventListener("statechange", onState);
            void applyScreenShareSenderEncoding(sender);
        }
    };
    transport.addEventListener("statechange", onState);

    window.setTimeout(tune, 400);
}

type PeerSummary = {
    id: string;
    name: string;
};

type ParticipantState = {
    id: string;
    name: string;
    sourceStream: MediaStream;
    displayStream: MediaStream;
    cameraStream: MediaStream;
    isSharingScreen: boolean;
    screenTrackId: string | null;
};

const ParticipantVideo = ({
    stream,
    label,
    prioritized,
    mirrored,
    muted = false,
    isLocal = false,
    fitMode = "cover",
}: {
    stream: MediaStream | null;
    label: string;
    prioritized?: boolean;
    mirrored?: boolean;
    muted?: boolean;
    isLocal?: boolean;
    /** "cover" fills the tile (good for cameras); "contain" preserves aspect (good for screen-share). */
    fitMode?: "cover" | "contain";
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const [hasVideo, setHasVideo] = useState(true);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        setIsVideoReady(false);
        video.srcObject = stream;
        if (stream) {
            const hasVidTracks = stream.getVideoTracks().length > 0;
            setHasVideo(hasVidTracks);
            video.play().catch(() => undefined);
        } else {
            setIsVideoReady(true);
            setHasVideo(false);
        }
    }, [stream]);

    return (
        <div
            className="video-tile"
            style={{
                border: prioritized
                    ? "2px solid var(--success)"
                    : isLocal
                        ? "2px solid var(--primary)"
                        : "1px solid var(--border)",
                transition: "border-color 220ms ease, box-shadow 220ms ease",
                background: fitMode === "contain" ? "#000" : undefined,
            }}
        >
            {!hasVideo && (
                <div className="video-placeholder">
                    <div className="avatar">
                        {label.charAt(0).toUpperCase()}
                    </div>
                </div>
            )}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={muted}
                onLoadedData={() => setIsVideoReady(true)}
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: fitMode,
                    transform: mirrored ? "scaleX(-1)" : "none",
                    opacity: isVideoReady && hasVideo ? 1 : 0,
                    transition: "opacity 220ms ease",
                    position: "absolute",
                    inset: 0,
                }}
            />
            <div className="tile-label">
                {label}
                {isLocal && <span className="you-badge">You</span>}
            </div>
        </div>
    );
};

const ParticipantAudio = ({
    stream,
    boost = 1.0,
}: {
    stream: MediaStream | null;
    boost?: number;
}) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;

        if (!stream) {
            el.srcObject = null;
            return;
        }

        el.srcObject = stream;
        el.volume = Math.min(1, Math.max(0, boost));
        el.play().catch(() => undefined);

        return () => {
            el.srcObject = null;
        };
    }, [stream, boost]);

    return <audio ref={audioRef} playsInline hidden aria-hidden />;
};

export const Room = ({
    name,
    localAudioTrack,
    localVideoTrack,
    demoRoomId,
    demoRoomSecret,
    demoInviteToken,
}: {
    name: string;
    localAudioTrack: MediaStreamTrack | null;
    localVideoTrack: MediaStreamTrack | null;
    demoRoomId?: string;
    /** Legacy: raw room key (old invite links). Prefer demoInviteToken. */
    demoRoomSecret?: string;
    demoInviteToken?: string;
}) => {
    const [, setLobby] = useState(true);
    const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
    const [participants, setParticipants] = useState<ParticipantState[]>([]);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const isScreenSharingRef = useRef(false);
    const [screenPreviewStream, setScreenPreviewStream] = useState<MediaStream | null>(null);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showParticipants, setShowParticipants] = useState(false);
    const [micEnabled, setMicEnabled] = useState(true);
    const [camEnabled, setCamEnabled] = useState(true);
    const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "reconnecting">("connecting");
    const [toast, setToast] = useState<{ message: string; tone: "info" | "error" } | null>(null);
    const [copyConfirmed, setCopyConfirmed] = useState(false);
    const [isRoomLocked, setIsRoomLocked] = useState(false);
    const [isHost, setIsHost] = useState(false);
    const toastTimerRef = useRef<number | null>(null);

    const showToast = useCallback((message: string, tone: "info" | "error" = "info") => {
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        setToast({ message, tone });
        toastTimerRef.current = window.setTimeout(() => setToast(null), 3500);
    }, []);

    const containerRef = useRef<HTMLDivElement>(null);
    const localScreenPreviewRef = useRef<HTMLVideoElement>(null);

    const socketRef = useRef<Socket | null>(null);
    const socketIdRef = useRef<string | null>(null);
    const currentRoomIdRef = useRef<string | null>(null);
    const demoRoomIdRef = useRef(demoRoomId);
    const demoRoomSecretRef = useRef(demoRoomSecret);
    const demoInviteTokenRef = useRef(demoInviteToken);
    const nameRef = useRef(name);
    const clientIdRef = useRef(getClientId());
    const roomSecretRef = useRef<string | null>(demoRoomSecret?.trim() || null);
    const inviteTokenRef = useRef<string | null>(demoInviteToken?.trim() || null);
    const isHostRef = useRef(false);

    demoRoomIdRef.current = demoRoomId;
    demoRoomSecretRef.current = demoRoomSecret;
    demoInviteTokenRef.current = demoInviteToken;
    nameRef.current = name;

    /** Show room id only after server confirms it. */
    const displayedRoomId = currentRoomId;

    const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
    const peerNamesRef = useRef<Map<string, string>>(new Map());
    const participantStateRef = useRef<Map<string, ParticipantState>>(new Map());
    const screenStatusRef = useRef<Map<string, { isSharing: boolean; trackId: string | null }>>(new Map());
    const makingOfferRef = useRef<Map<string, boolean>>(new Map());
    /** Timers that drop a participant if their peer connection stays unhealthy too long. */
    const peerDeathTimersRef = useRef<Map<string, number>>(new Map());

    const localStreamRef = useRef<MediaStream>(new MediaStream());
    const screenStreamRef = useRef<MediaStream | null>(null);
    const screenVideoTrackRef = useRef<MediaStreamTrack | null>(null);
    const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
    const outboundAudioTrackRef = useRef<MediaStreamTrack | null>(null);
    const mixedAudioContextRef = useRef<AudioContext | null>(null);
    const mixedAudioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const mixedAudioTrackRef = useRef<MediaStreamTrack | null>(null);
    const screenVideoSendersRef = useRef<Map<string, RTCRtpSender>>(new Map());
    const cameraSendersRef = useRef<Map<string, RTCRtpSender>>(new Map());
    const audioSendersRef = useRef<Map<string, RTCRtpSender>>(new Map());

    const syncParticipants = useCallback(() => {
        setParticipants(Array.from(participantStateRef.current.values()));
    }, []);

    const updateDisplayedStream = useCallback((participantId: string) => {
        const participant = participantStateRef.current.get(participantId);
        if (!participant) return;

        const allVideoTracks = participant.sourceStream.getVideoTracks();
        const allAudioTracks = participant.sourceStream.getAudioTracks();

        const screenTrack = participant.screenTrackId
            ? allVideoTracks.find((t) => t.id === participant.screenTrackId) ?? null
            : null;
        const cameraTrack = allVideoTracks.find((t) => t.id !== participant.screenTrackId) ?? null;

        const selectedVideoTrack = participant.isSharingScreen
            ? screenTrack || cameraTrack
            : cameraTrack || screenTrack;

        const nextDisplayStream = new MediaStream();
        if (selectedVideoTrack) nextDisplayStream.addTrack(selectedVideoTrack);
        allAudioTracks.forEach((t) => nextDisplayStream.addTrack(t));

        const nextCameraStream = new MediaStream();
        if (cameraTrack) {
            nextCameraStream.addTrack(cameraTrack);
        } else if (screenTrack) {
            nextCameraStream.addTrack(screenTrack);
        }

        participant.displayStream = nextDisplayStream;
        participant.cameraStream = nextCameraStream;
        participantStateRef.current.set(participantId, participant);
    }, []);

    const registerPeer = useCallback(
        (peerId: string, peerName: string) => {
            peerNamesRef.current.set(peerId, peerName);
            if (participantStateRef.current.has(peerId)) return;
            const empty = new MediaStream();
            const nextState: ParticipantState = {
                id: peerId,
                name: peerName,
                sourceStream: empty,
                displayStream: new MediaStream(),
                cameraStream: new MediaStream(),
                isSharingScreen: screenStatusRef.current.get(peerId)?.isSharing ?? false,
                screenTrackId: screenStatusRef.current.get(peerId)?.trackId ?? null,
            };
            participantStateRef.current.set(peerId, nextState);
            updateDisplayedStream(peerId);
            syncParticipants();
        },
        [syncParticipants, updateDisplayedStream]
    );

    const upsertParticipantStream = useCallback(
        (participantId: string, stream: MediaStream, participantName?: string) => {
            if (!peerNamesRef.current.has(participantId)) return;

            const existing = participantStateRef.current.get(participantId);
            const resolvedName =
                participantName ||
                peerNamesRef.current.get(participantId) ||
                existing?.name;
            if (!resolvedName) return;

            const nextState: ParticipantState = existing
                ? { ...existing, sourceStream: stream, name: resolvedName }
                : {
                      id: participantId,
                      name: resolvedName,
                      sourceStream: stream,
                      displayStream: new MediaStream(),
                      cameraStream: new MediaStream(),
                      isSharingScreen: screenStatusRef.current.get(participantId)?.isSharing ?? false,
                      screenTrackId: screenStatusRef.current.get(participantId)?.trackId ?? null,
                  };

            participantStateRef.current.set(participantId, nextState);
            updateDisplayedStream(participantId);
            syncParticipants();
        },
        [syncParticipants, updateDisplayedStream]
    );

    const removeParticipant = useCallback(
        (participantId: string) => {
            participantStateRef.current.delete(participantId);
            syncParticipants();
        },
        [syncParticipants]
    );

    const emitScreenShareStatus = useCallback((isSharing: boolean, trackId: string | null) => {
        const socket = socketRef.current;
        const roomId = currentRoomIdRef.current;
        if (!socket || !roomId) return;
        socket.emit("screen-share-status", { roomId, isSharing, trackId });
    }, []);

    const disposeMixedAudio = useCallback(() => {
        mixedAudioTrackRef.current?.stop();
        mixedAudioTrackRef.current = null;
        mixedAudioDestinationRef.current = null;

        const audioContext = mixedAudioContextRef.current;
        mixedAudioContextRef.current = null;
        if (audioContext) {
            audioContext.close().catch(() => undefined);
        }
    }, []);

    const buildOutboundAudioTrack = useCallback(
        (micTrack: MediaStreamTrack | null, screenAudioTrack: MediaStreamTrack | null) => {
            disposeMixedAudio();

            if (!screenAudioTrack) {
                outboundAudioTrackRef.current = micTrack;
                return micTrack;
            }

            const audioContext = new AudioContext();
            const destination = audioContext.createMediaStreamDestination();

            if (micTrack) {
                const micSource = audioContext.createMediaStreamSource(new MediaStream([micTrack]));
                const micGain = audioContext.createGain();
                micGain.gain.value = 1.0;
                micSource.connect(micGain);
                micGain.connect(destination);
            }

            const screenSource = audioContext.createMediaStreamSource(new MediaStream([screenAudioTrack]));
            const screenGain = audioContext.createGain();
            screenGain.gain.value = 0.75;
            screenSource.connect(screenGain);
            screenGain.connect(destination);

            audioContext.resume().catch(() => undefined);

            const mixedTrack = destination.stream.getAudioTracks()[0] ?? null;
            mixedAudioContextRef.current = audioContext;
            mixedAudioDestinationRef.current = destination;
            mixedAudioTrackRef.current = mixedTrack;
            outboundAudioTrackRef.current = mixedTrack;

            return mixedTrack;
        },
        [disposeMixedAudio]
    );

    const toggleFullscreen = useCallback(async () => {
        if (!containerRef.current) return;
        try {
            if (!document.fullscreenElement) {
                await containerRef.current.requestFullscreen();
                setIsFullscreen(true);
            } else {
                await document.exitFullscreen();
                setIsFullscreen(false);
            }
        } catch (e) {
            console.error("Fullscreen error", e);
        }
    }, []);

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", handler);
        return () => document.removeEventListener("fullscreenchange", handler);
    }, []);

    const createAndSendOffer = useCallback(async (peerId: string) => {
        const socket = socketRef.current;
        const roomId = currentRoomIdRef.current;
        const pc = peersRef.current.get(peerId);
        if (!socket || !roomId || !pc) return;
        if (pc.signalingState !== "stable") return;

        try {
            makingOfferRef.current.set(peerId, true);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit("offer", { roomId, targetId: peerId, sdp: pc.localDescription });
        } catch (e) {
            console.error("createOffer failed", e);
        } finally {
            makingOfferRef.current.set(peerId, false);
        }
    }, []);

    const syncOutboundAudioTrack = useCallback(
        (audioTrack: MediaStreamTrack | null) => {
            outboundAudioTrackRef.current = audioTrack;

            peersRef.current.forEach((pc, peerId) => {
                const audioSender = audioSendersRef.current.get(peerId);

                if (audioSender) {
                    audioSender.replaceTrack(audioTrack).catch(() => undefined);
                } else if (audioTrack) {
                    const sender = pc.addTrack(audioTrack, localStreamRef.current);
                    audioSendersRef.current.set(peerId, sender);
                    void tuneAudioSender(sender);
                    createAndSendOffer(peerId);
                }
            });
        },
        [createAndSendOffer]
    );

    const ensurePeerConnection = useCallback(
        (peerId: string, peerName?: string) => {
            const existing = peersRef.current.get(peerId);
            if (existing) {
                if (peerName) peerNamesRef.current.set(peerId, peerName);
                return existing;
            }

            if (peerName) peerNamesRef.current.set(peerId, peerName);

            const socket = socketRef.current;
            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    { urls: "stun:stun1.l.google.com:19302" },
                    { urls: "stun:stun2.l.google.com:19302" },
                    { urls: "stun:stun3.l.google.com:19302" },
                    { urls: "stun:stun.cloudflare.com:3478" },
                ],
                bundlePolicy: "max-bundle",
                rtcpMuxPolicy: "require",
                iceCandidatePoolSize: 4,
            });
            peersRef.current.set(peerId, pc);

            const initialVideoTrack = localStreamRef.current.getVideoTracks()[0] ?? null;
            if (initialVideoTrack) {
                const cameraSender = pc.addTrack(initialVideoTrack, localStreamRef.current);
                cameraSendersRef.current.set(peerId, cameraSender);
            }

            const initialAudioTrack = outboundAudioTrackRef.current;
            if (initialAudioTrack) {
                const audioSender = pc.addTrack(initialAudioTrack, localStreamRef.current);
                audioSendersRef.current.set(peerId, audioSender);
                void tuneAudioSender(audioSender);
            }

            if (screenStreamRef.current && screenVideoTrackRef.current) {
                const s = pc.addTrack(screenVideoTrackRef.current, screenStreamRef.current);
                screenVideoSendersRef.current.set(peerId, s);
                scheduleScreenShareSenderTuning(s);
            }

            pc.onicecandidate = (event) => {
                if (!event.candidate || !socket || !currentRoomIdRef.current) return;
                socket.emit("ice-candidate", {
                    roomId: currentRoomIdRef.current,
                    targetId: peerId,
                    candidate: event.candidate,
                });
            };

            pc.ontrack = (event) => {
                const currentStream = remoteStreamsRef.current.get(peerId) || new MediaStream();
                remoteStreamsRef.current.set(peerId, currentStream);

                if (!currentStream.getTracks().some((t) => t.id === event.track.id)) {
                    currentStream.addTrack(event.track);
                }

                event.track.onended = () => {
                    currentStream.removeTrack(event.track);
                    upsertParticipantStream(peerId, currentStream);
                };

                upsertParticipantStream(peerId, currentStream);
            };

            pc.onnegotiationneeded = () => createAndSendOffer(peerId);

            const dropPeer = () => {
                const timerId = peerDeathTimersRef.current.get(peerId);
                if (timerId) window.clearTimeout(timerId);
                peerDeathTimersRef.current.delete(peerId);

                try { pc.close(); } catch { /* already closed */ }
                peersRef.current.delete(peerId);
                remoteStreamsRef.current.delete(peerId);
                screenVideoSendersRef.current.delete(peerId);
                cameraSendersRef.current.delete(peerId);
                audioSendersRef.current.delete(peerId);
                makingOfferRef.current.delete(peerId);
                peerNamesRef.current.delete(peerId);
                screenStatusRef.current.delete(peerId);
                removeParticipant(peerId);
            };

            pc.onconnectionstatechange = () => {
                const state = pc.connectionState;
                const existingTimer = peerDeathTimersRef.current.get(peerId);

                if (state === "failed" || state === "closed") {
                    dropPeer();
                    return;
                }

                if (state === "disconnected") {
                    // ICE may recover within a few seconds; if it doesn't, reap the tile
                    // so callers don't see ghost participants after someone leaves.
                    if (!existingTimer) {
                        const t = window.setTimeout(() => {
                            if (pc.connectionState === "disconnected") dropPeer();
                        }, 6000);
                        peerDeathTimersRef.current.set(peerId, t);
                    }
                    return;
                }

                // Connection healthy again — cancel any pending reap.
                if (existingTimer) {
                    window.clearTimeout(existingTimer);
                    peerDeathTimersRef.current.delete(peerId);
                }
            };

            return pc;
        },
        [createAndSendOffer, removeParticipant, upsertParticipantStream]
    );

    const stopScreenShare = useCallback(() => {
        const screenStream = screenStreamRef.current;

        peersRef.current.forEach((pc, peerId) => {
            const vs = screenVideoSendersRef.current.get(peerId);
            if (vs) { pc.removeTrack(vs); screenVideoSendersRef.current.delete(peerId); }
            createAndSendOffer(peerId);
        });

        if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
        screenVideoTrackRef.current = null;
        screenAudioTrackRef.current = null;
        syncOutboundAudioTrack(buildOutboundAudioTrack(localAudioTrack, null));
        setScreenPreviewStream(null);
        setIsScreenSharing(false);
        isScreenSharingRef.current = false;
        emitScreenShareStatus(false, null);
    }, [buildOutboundAudioTrack, createAndSendOffer, emitScreenShareStatus, localAudioTrack, syncOutboundAudioTrack]);

    const startScreenShare = useCallback(async () => {
        try {
            // Tab/system audio: avoid voice-oriented DSP and forced sample rates (reduces artifacts
            // when mixed with the mic and when encoded for WebRTC).
            const audioConstraints = {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            } as const;

            let stream: MediaStream;
            try {
                stream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        frameRate: { ideal: SCREEN_SHARE_TARGET_FPS, max: SCREEN_SHARE_TARGET_FPS },
                        width: { max: 1920 },
                        height: { max: 1080 },
                    },
                    audio: audioConstraints,
                });
            } catch {
                stream = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: audioConstraints,
                });
            }

            const videoTrack = stream.getVideoTracks()[0] ?? null;
            const audioTrack = stream.getAudioTracks()[0] ?? null;

            if (!videoTrack) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }

            await prepareScreenCaptureVideoTrack(videoTrack);

            screenStreamRef.current = stream;
            screenVideoTrackRef.current = videoTrack;
            screenAudioTrackRef.current = audioTrack;
            syncOutboundAudioTrack(buildOutboundAudioTrack(localAudioTrack, audioTrack));

            // Use the actual screen stream, not a copy (effect binds <video> after mount)
            setScreenPreviewStream(stream);
            setIsScreenSharing(true);
            isScreenSharingRef.current = true;

            peersRef.current.forEach((pc, peerId) => {
                const vs = pc.addTrack(videoTrack, stream);
                screenVideoSendersRef.current.set(peerId, vs);
                scheduleScreenShareSenderTuning(vs);
                createAndSendOffer(peerId);
            });

            emitScreenShareStatus(true, videoTrack.id);

            videoTrack.onended = () => stopScreenShare();
        } catch (e) {
            console.error("Screen share failed", e);
        }
    }, [buildOutboundAudioTrack, createAndSendOffer, emitScreenShareStatus, localAudioTrack, stopScreenShare, syncOutboundAudioTrack]);

    const toggleScreenShare = useCallback(() => {
        if (isScreenSharing) stopScreenShare();
        else startScreenShare();
    }, [isScreenSharing, startScreenShare, stopScreenShare]);

    useEffect(() => {
        const nextAudioTrack = buildOutboundAudioTrack(localAudioTrack, screenAudioTrackRef.current);
        const nextLocalStream = new MediaStream();
        if (localVideoTrack) nextLocalStream.addTrack(localVideoTrack);
        if (nextAudioTrack) nextLocalStream.addTrack(nextAudioTrack);
        localStreamRef.current = nextLocalStream;
        outboundAudioTrackRef.current = nextAudioTrack;

        peersRef.current.forEach((pc, peerId) => {
            const camSender = cameraSendersRef.current.get(peerId);
            const micSender = audioSendersRef.current.get(peerId);

            if (localVideoTrack) {
                if (camSender) camSender.replaceTrack(localVideoTrack).catch(() => undefined);
                else {
                    const sender = pc.addTrack(localVideoTrack, localStreamRef.current);
                    cameraSendersRef.current.set(peerId, sender);
                }
            } else if (camSender) {
                camSender.replaceTrack(null).catch(() => undefined);
            }

            if (nextAudioTrack) {
                if (micSender) micSender.replaceTrack(nextAudioTrack).catch(() => undefined);
                else {
                    const sender = pc.addTrack(nextAudioTrack, localStreamRef.current);
                    audioSendersRef.current.set(peerId, sender);
                    void tuneAudioSender(sender);
                }
            } else if (micSender) {
                micSender.replaceTrack(null).catch(() => undefined);
            }

            createAndSendOffer(peerId);
        });
    }, [buildOutboundAudioTrack, createAndSendOffer, localAudioTrack, localVideoTrack]);

    useEffect(() => {
        const video = localScreenPreviewRef.current;
        if (!video || !screenPreviewStream) return;
        video.srcObject = screenPreviewStream;
        video.play().catch(() => undefined);
    }, [screenPreviewStream]);

    useEffect(() => {
        const socket = io(URL, {
            path: "/socket.io",
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 800,
            reconnectionDelayMax: 5000,
            timeout: 15_000,
        });
        socketRef.current = socket;

        const tearDownPeers = () => {
            peersRef.current.forEach((pc) => pc.close());
            peersRef.current.clear();
            remoteStreamsRef.current.clear();
            participantStateRef.current.clear();
            screenStatusRef.current.clear();
            screenVideoSendersRef.current.clear();
            cameraSendersRef.current.clear();
            audioSendersRef.current.clear();
            makingOfferRef.current.clear();
            peerNamesRef.current.clear();
            syncParticipants();
        };

        const emitJoinRoom = (roomId: string) => {
            const token =
                inviteTokenRef.current ||
                demoInviteTokenRef.current?.trim() ||
                null;
            const secret =
                roomSecretRef.current ||
                loadRoomSecret(roomId) ||
                demoRoomSecretRef.current?.trim() ||
                null;

            if (!token && !secret) {
                showToast("Missing invite link — ask the host to share it again.", "error");
                return;
            }

            if (secret) {
                roomSecretRef.current = secret;
                saveRoomSecret(roomId, secret);
            }

            socket.emit("join-room", {
                roomId,
                name: nameRef.current,
                clientId: clientIdRef.current,
                ...(token ? { inviteToken: token } : {}),
                ...(secret ? { roomSecret: secret } : {}),
            });
        };

        socket.on("connect", () => {
            const isReconnect = socketIdRef.current !== null;
            socketIdRef.current = socket.id ?? null;
            setConnectionStatus("connected");

            if (isReconnect) {
                tearDownPeers();
            }

            const knownRoomId = currentRoomIdRef.current?.trim();
            const requestedJoinId = demoRoomIdRef.current?.trim();
            const joinId = knownRoomId || requestedJoinId;
            if (joinId) {
                emitJoinRoom(joinId);
            } else {
                socket.emit("create-room", {
                    name: nameRef.current,
                    clientId: clientIdRef.current,
                });
            }

            if (isReconnect) showToast("Reconnected", "info");
        });

        socket.on("disconnect", (reason) => {
            console.log("Socket disconnected:", reason);
            setConnectionStatus("reconnecting");
        });

        socket.io.on("reconnect_attempt", () => setConnectionStatus("reconnecting"));

        socket.on(
            "room-created",
            ({
                roomId,
                roomSecret,
                inviteToken,
            }: {
                roomId: string;
                roomSecret: string;
                inviteToken: string;
            }) => {
                setCurrentRoomId(roomId);
                currentRoomIdRef.current = roomId;
                roomSecretRef.current = roomSecret;
                inviteTokenRef.current = inviteToken;
                saveRoomSecret(roomId, roomSecret);
                isHostRef.current = true;
                setIsHost(true);
            }
        );

        socket.on("invite-token-refreshed", ({ inviteToken }: { inviteToken: string }) => {
            inviteTokenRef.current = inviteToken;
        });

        socket.on("room-locked", ({ locked }: { locked: boolean }) => {
            setIsRoomLocked(locked);
            showToast(locked ? "Room locked — no new joins" : "Room unlocked", "info");
        });

        socket.on(
            "room-joined",
            ({ roomId, participants: existing }: { roomId: string; participants: PeerSummary[] }) => {
                setLobby(false);
                setCurrentRoomId(roomId);
                currentRoomIdRef.current = roomId;
                existing.forEach((p) => {
                    registerPeer(p.id, p.name);
                    ensurePeerConnection(p.id, p.name);
                    createAndSendOffer(p.id);
                });
            }
        );

        socket.on("participant-joined", ({ participant }: { roomId: string; participant: PeerSummary }) => {
            registerPeer(participant.id, participant.name);
            ensurePeerConnection(participant.id, participant.name);

            // Must use ref: this handler is registered once; `isScreenSharing` state would be stale here.
            if (isScreenSharingRef.current && screenVideoTrackRef.current && currentRoomIdRef.current) {
                socket.emit("screen-share-status", {
                    roomId: currentRoomIdRef.current,
                    isSharing: true,
                    trackId: screenVideoTrackRef.current.id,
                });
            }

            createAndSendOffer(participant.id);
        });

        socket.on(
            "offer",
            async ({ fromId, sdp }: { roomId: string; fromId: string; sdp: RTCSessionDescriptionInit }) => {
                if (!peerNamesRef.current.has(fromId)) return;
                const pc = ensurePeerConnection(fromId, peerNamesRef.current.get(fromId));
                if (!pc) return;

                try {
                    const myId = socketIdRef.current || "";
                    const polite = myId.localeCompare(fromId) > 0;
                    const makingOffer = makingOfferRef.current.get(fromId) ?? false;
                    const collision = sdp.type === "offer" && (makingOffer || pc.signalingState !== "stable");

                    if (collision && !polite) return;
                    if (collision) await pc.setLocalDescription({ type: "rollback" });

                    await pc.setRemoteDescription(sdp);
                    if (sdp.type === "offer") {
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        socket.emit("answer", {
                            roomId: currentRoomIdRef.current,
                            targetId: fromId,
                            sdp: pc.localDescription,
                        });
                    }
                } catch (e) {
                    console.error("offer handling failed", e);
                }
            }
        );

        socket.on(
            "answer",
            async ({ fromId, sdp }: { roomId: string; fromId: string; sdp: RTCSessionDescriptionInit }) => {
                const pc = peersRef.current.get(fromId);
                if (!pc) return;
                try {
                    await pc.setRemoteDescription(sdp);
                } catch (e) {
                    console.error("answer handling failed", e);
                }
            }
        );

        socket.on(
            "ice-candidate",
            async ({
                fromId,
                candidate,
            }: {
                roomId: string;
                fromId: string;
                candidate: RTCIceCandidateInit;
            }) => {
                if (!peerNamesRef.current.has(fromId)) return;
                const pc = ensurePeerConnection(fromId, peerNamesRef.current.get(fromId));
                if (!pc || !candidate) return;
                try {
                    await pc.addIceCandidate(candidate);
                } catch (e) {
                    console.error("ICE candidate failed", e);
                }
            }
        );

        socket.on(
            "screen-share-status",
            ({
                senderId,
                isSharing,
                trackId,
            }: {
                roomId: string;
                senderId: string;
                isSharing: boolean;
                trackId: string | null;
            }) => {
                screenStatusRef.current.set(senderId, { isSharing, trackId });
                const participant = participantStateRef.current.get(senderId);
                if (!participant) return;
                participant.isSharingScreen = isSharing;
                participant.screenTrackId = trackId;
                participantStateRef.current.set(senderId, participant);
                updateDisplayedStream(senderId);
                syncParticipants();
            }
        );

        socket.on("participant-left", ({ participantId }: { roomId: string; participantId: string }) => {
            const deathTimer = peerDeathTimersRef.current.get(participantId);
            if (deathTimer) {
                window.clearTimeout(deathTimer);
                peerDeathTimersRef.current.delete(participantId);
            }
            const pc = peersRef.current.get(participantId);
            if (pc) pc.close();
            peersRef.current.delete(participantId);
            remoteStreamsRef.current.delete(participantId);
            screenVideoSendersRef.current.delete(participantId);
            cameraSendersRef.current.delete(participantId);
            audioSendersRef.current.delete(participantId);
            peerNamesRef.current.delete(participantId);
            makingOfferRef.current.delete(participantId);
            screenStatusRef.current.delete(participantId);
            removeParticipant(participantId);
        });

        socket.on("room-join-error", ({ message }: { message: string }) => {
            showToast(message || "Could not join room", "error");
        });

        return () => {
            stopScreenShare();
            peersRef.current.forEach((pc) => pc.close());
            peersRef.current.clear();
            remoteStreamsRef.current.clear();
            participantStateRef.current.clear();
            screenStatusRef.current.clear();
            makingOfferRef.current.clear();
            cameraSendersRef.current.clear();
            audioSendersRef.current.clear();
            disposeMixedAudio();
            socket.disconnect();
            socketRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        return () => {
            disposeMixedAudio();
        };
    }, [disposeMixedAudio]);

    // Tell the server we're leaving when the tab closes / navigates away, so other
    // peers don't have to wait for a ping timeout to see us disappear.
    useEffect(() => {
        const announceLeave = () => {
            const s = socketRef.current;
            if (!s) return;
            try {
                s.volatile.emit("leave-room");
                s.disconnect();
            } catch {
                /* ignore */
            }
        };
        window.addEventListener("pagehide", announceLeave);
        window.addEventListener("beforeunload", announceLeave);
        return () => {
            window.removeEventListener("pagehide", announceLeave);
            window.removeEventListener("beforeunload", announceLeave);
        };
    }, []);

    const remoteParticipants = useMemo(
        () => participants.filter((p) => p.id !== socketIdRef.current),
        [participants]
    );

    const sharingParticipant = useMemo(() => {
        if (isScreenSharing) return { id: "self", name, isLocal: true };
        const sharing = remoteParticipants.find(p => p.isSharingScreen);
        return sharing ? { id: sharing.id, name: sharing.name, isLocal: false } : null;
    }, [isScreenSharing, remoteParticipants, name]);

    const allTiles = useMemo(() => {
        const tiles = [{ id: "self", name, displayStream: localStreamRef.current, isLocal: true }];
        remoteParticipants.forEach((p) => {
            tiles.push({ id: p.id, name: p.name, displayStream: p.displayStream, isLocal: false });
        });
        return tiles;
    }, [name, remoteParticipants]);

    const nonSharingTiles = useMemo(() => {
        if (!sharingParticipant) return allTiles;
        return allTiles.filter(t => t.id !== sharingParticipant.id);
    }, [allTiles, sharingParticipant]);

    const gridCols = useMemo(() => {
        const count = sharingParticipant ? nonSharingTiles.length : allTiles.length;
        if (count <= 1) return "1fr";
        if (count === 2) return "1fr 1fr";
        if (count <= 4) return "1fr 1fr";
        if (count <= 6) return "1fr 1fr 1fr";
        if (count <= 9) return "1fr 1fr 1fr";
        return "1fr 1fr 1fr 1fr";
    }, [allTiles.length, sharingParticipant, nonSharingTiles.length]);

    const totalParticipants = 1 + remoteParticipants.length;

    const handleToggleMic = useCallback(() => {
        if (localAudioTrack) {
            localAudioTrack.enabled = !localAudioTrack.enabled;
            setMicEnabled(localAudioTrack.enabled);
        }
    }, [localAudioTrack]);

    const handleToggleCam = useCallback(() => {
        if (localVideoTrack) {
            localVideoTrack.enabled = !localVideoTrack.enabled;
            setCamEnabled(localVideoTrack.enabled);
        }
    }, [localVideoTrack]);

    const handleToggleRoomLock = useCallback(() => {
        if (!isHostRef.current) return;
        socketRef.current?.emit("lock-room", { locked: !isRoomLocked });
    }, [isRoomLocked]);

    const handleCopyRoomId = useCallback(() => {
        if (!displayedRoomId) return;
        const token = inviteTokenRef.current;
        const text = token
            ? buildInviteLink(displayedRoomId, token)
            : displayedRoomId;
        navigator.clipboard
            .writeText(text)
            .then(() => {
                setCopyConfirmed(true);
                window.setTimeout(() => setCopyConfirmed(false), 1500);
            })
            .catch(() => undefined);
    }, [displayedRoomId]);

    const handleLeave = useCallback(() => {
        stopScreenShare();
        // Tell the server before we drop the socket so the other peers see us leave
        // immediately, instead of waiting for a ping timeout.
        try {
            socketRef.current?.emit("leave-room");
        } catch {
            /* socket already closed */
        }
        peersRef.current.forEach((pc) => pc.close());
        peersRef.current.clear();
        remoteStreamsRef.current.clear();
        participantStateRef.current.clear();
        screenStatusRef.current.clear();
        makingOfferRef.current.clear();
        cameraSendersRef.current.clear();
        audioSendersRef.current.clear();
        peerDeathTimersRef.current.forEach((t) => window.clearTimeout(t));
        peerDeathTimersRef.current.clear();
        disposeMixedAudio();
        socketRef.current?.disconnect();
        socketRef.current = null;
        window.location.reload();
    }, [stopScreenShare, disposeMixedAudio]);

    return (
        <div
            ref={containerRef}
            className={isFullscreen ? "" : "app-backdrop"}
            style={{
                width: "100%",
                maxWidth: "100vw",
                height: "100vh",
                overflow: "hidden",
                boxSizing: "border-box",
                backgroundColor: isFullscreen ? "#000" : undefined,
                display: "flex",
                flexDirection: "column",
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: "0.85rem 1.4rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                    background: "rgba(11, 15, 26, 0.78)",
                    backdropFilter: "blur(14px)",
                    WebkitBackdropFilter: "blur(14px)",
                    borderBottom: "1px solid var(--border)",
                    flexShrink: 0,
                    zIndex: 10,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", minWidth: 0 }}>
                    <img
                        src="/logo.png"
                        alt="Closr"
                        width={36}
                        height={36}
                        style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            objectFit: "cover",
                            flexShrink: 0,
                            border: "1px solid var(--border)",
                            boxShadow: "0 10px 30px -10px var(--primary-glow)",
                        }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-main)" }}>
                                Closr
                            </span>
                            <span
                                className="status-pill"
                                title={
                                    connectionStatus === "connected"
                                        ? "Connected to signaling"
                                        : connectionStatus === "reconnecting"
                                            ? "Reconnecting…"
                                            : "Connecting…"
                                }
                            >
                                <span
                                    className={`status-dot ${
                                        connectionStatus === "reconnecting"
                                            ? "is-reconnecting"
                                            : connectionStatus === "connecting"
                                                ? "is-connecting"
                                                : ""
                                    }`}
                                />
                                {connectionStatus === "connected"
                                    ? "Live"
                                    : connectionStatus === "reconnecting"
                                        ? "Reconnecting"
                                        : "Connecting"}
                            </span>
                        </div>
                        {displayedRoomId && (
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
                                <span
                                    style={{
                                        fontSize: "0.68rem",
                                        color: "var(--text-muted)",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.08em",
                                    }}
                                >
                                    Room
                                </span>
                                <code
                                    style={{
                                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                        fontSize: "0.9rem",
                                        fontWeight: 600,
                                        color: "var(--text-main)",
                                        letterSpacing: "0.12em",
                                        background: "rgba(255,255,255,0.05)",
                                        border: "1px solid var(--border-strong)",
                                        borderRadius: 6,
                                        padding: "2px 8px",
                                        maxWidth: "min(260px, 45vw)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                    title={displayedRoomId}
                                >
                                    {displayedRoomId}
                                </code>
                                <button
                                    type="button"
                                    onClick={handleCopyRoomId}
                                    style={{
                                        fontSize: "0.72rem",
                                        padding: "0.25rem 0.6rem",
                                        borderRadius: 6,
                                        border: "1px solid var(--border-strong)",
                                        background: copyConfirmed ? "rgba(34, 197, 94, 0.18)" : "rgba(255,255,255,0.05)",
                                        color: copyConfirmed ? "#bbf7d0" : "var(--text-main)",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                        transition: "all 0.15s ease",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.3rem",
                                    }}
                                >
                                    <span className="msr sm" aria-hidden>
                                        {copyConfirmed ? "check" : "content_copy"}
                                    </span>
                                    {copyConfirmed ? "Copied" : "Copy link"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                        {totalParticipants} {totalParticipants === 1 ? "person" : "people"}
                    </span>
                    {isHost && (
                        <button
                            type="button"
                            onClick={handleToggleRoomLock}
                            title={isRoomLocked ? "Unlock room" : "Lock room"}
                            style={{
                                background: isRoomLocked
                                    ? "rgba(245, 158, 11, 0.18)"
                                    : "rgba(255,255,255,0.06)",
                                border: `1px solid ${isRoomLocked ? "rgba(245, 158, 11, 0.5)" : "var(--border-strong)"}`,
                                borderRadius: 10,
                                padding: "0.45rem 0.8rem",
                                color: "var(--text-main)",
                                cursor: "pointer",
                                fontSize: "0.82rem",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.4rem",
                            }}
                        >
                            <span className="msr sm" aria-hidden>
                                {isRoomLocked ? "lock" : "lock_open"}
                            </span>
                            {isRoomLocked ? "Locked" : "Lock"}
                        </button>
                    )}
                    <button
                        onClick={() => setShowParticipants(!showParticipants)}
                        style={{
                            background: showParticipants ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
                            border: "1px solid var(--border-strong)",
                            borderRadius: 10,
                            padding: "0.45rem 0.8rem",
                            color: "var(--text-main)",
                            cursor: "pointer",
                            fontSize: "0.82rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                            transition: "all 0.18s ease",
                        }}
                    >
                        <span className="msr sm" aria-hidden>group</span>
                        Participants
                    </button>
                </div>
            </div>

            {/* Main content area */}
            <div style={{
                flex: 1,
                display: "flex",
                overflow: "hidden",
                minHeight: 0,
                gap: "0.75rem",
                padding: "0.75rem",
            }}>
                {/* Center: Main display (screen share or grid) */}
                <div style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    borderRadius: "0.75rem",
                    background: "#1e293b",
                }}>
                    {/* Screen share view - show when someone is sharing */}
                    {sharingParticipant ? (
                        <div style={{
                            flex: 1,
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "#000",
                        }}>
                            {sharingParticipant.isLocal ? (
                                screenPreviewStream ? (
                                    <video
                                        ref={localScreenPreviewRef}
                                        autoPlay
                                        muted
                                        playsInline
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "contain",
                                        }}
                                    />
                                ) : (
                                    <div style={{ color: "#fff" }}>Starting screen share...</div>
                                )
                            ) : (
                                <ParticipantVideo
                                    stream={remoteParticipants.find(p => p.id === sharingParticipant.id)?.displayStream || null}
                                    label={`${sharingParticipant.name} is sharing`}
                                    prioritized
                                    muted
                                    fitMode="contain"
                                />
                            )}
                            <div className="tile-label" style={{ zIndex: 10 }}>
                                {sharingParticipant.isLocal ? "Your Screen" : `${sharingParticipant.name}'s Screen`}
                            </div>
                        </div>
                    ) : (
                        /* Regular grid when no sharing - show all in main area */
                        <div style={{
                            flex: 1,
                            display: "grid",
                            gridTemplateColumns: gridCols,
                            gap: "0.75rem",
                            gridAutoRows: "1fr",
                            padding: "0.75rem",
                            minHeight: 0,
                            alignContent: "start",
                        }}>
                            {allTiles.map((tile) => {
                                return (
                                    <ParticipantVideo
                                        key={tile.id}
                                        stream={tile.displayStream}
                                        label={tile.name}
                                        mirrored={tile.isLocal}
                                        muted
                                        isLocal={tile.isLocal}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Right panel: Only show when someone is sharing */}
                {sharingParticipant && (
                    <div style={{
                        width: "240px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                        overflow: "hidden",
                        flexShrink: 0,
                    }}>
                        <div style={{
                            fontSize: "0.75rem",
                            color: "#94a3b8",
                            padding: "0.25rem 0",
                            textAlign: "center",
                            flexShrink: 0,
                        }}>
                            Participants ({allTiles.length})
                        </div>
                        <div style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                            overflow: "auto",
                            paddingRight: "2px",
                        }}>
                            {/* Local video - show camera */}
                            <div style={{
                                width: "100%",
                                aspectRatio: "16/9",
                                borderRadius: "0.5rem",
                                overflow: "hidden",
                                flexShrink: 0,
                            }}>
                                <ParticipantVideo
                                    stream={new MediaStream(localVideoTrack ? [localVideoTrack] : [])}
                                    label={name}
                                    mirrored
                                    muted
                                    isLocal
                                />
                            </div>

                            {/* Remote videos - show camera for each participant */}
                            {remoteParticipants.map((p) => (
                                <div key={p.id} style={{
                                    width: "100%",
                                    aspectRatio: "16/9",
                                    borderRadius: "0.5rem",
                                    overflow: "hidden",
                                    flexShrink: 0,
                                }}>
                                    <ParticipantVideo
                                        stream={p.cameraStream}
                                        label={p.name}
                                        muted
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Control bar */}
            <div
                style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "0.65rem",
                    padding: "0.85rem 1.5rem 1rem",
                    background: "rgba(11, 15, 26, 0.85)",
                    backdropFilter: "blur(14px)",
                    WebkitBackdropFilter: "blur(14px)",
                    borderTop: "1px solid var(--border)",
                    flexShrink: 0,
                }}
            >
                <button
                    type="button"
                    onClick={handleToggleMic}
                    className={`ctrl-btn ${micEnabled ? "is-on" : "is-off"}`}
                    aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
                    title={micEnabled ? "Mute microphone" : "Unmute microphone"}
                >
                    <span className="msr" aria-hidden>{micEnabled ? "mic" : "mic_off"}</span>
                </button>

                <button
                    type="button"
                    onClick={handleToggleCam}
                    className={`ctrl-btn ${camEnabled ? "is-on" : "is-off"}`}
                    aria-label={camEnabled ? "Turn camera off" : "Turn camera on"}
                    title={camEnabled ? "Turn camera off" : "Turn camera on"}
                >
                    <span className="msr" aria-hidden>{camEnabled ? "videocam" : "videocam_off"}</span>
                </button>

                <button
                    type="button"
                    onClick={toggleScreenShare}
                    className={`ctrl-btn ${isScreenSharing ? "is-on" : ""}`}
                    aria-label={isScreenSharing ? "Stop sharing your screen" : "Share your screen"}
                    title={isScreenSharing ? "Stop sharing" : "Share your screen"}
                >
                    <span className="msr" aria-hidden>
                        {isScreenSharing ? "stop_screen_share" : "screen_share"}
                    </span>
                </button>

                <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="ctrl-btn"
                    aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                    <span className="msr" aria-hidden>
                        {isFullscreen ? "fullscreen_exit" : "fullscreen"}
                    </span>
                </button>

                <div style={{ width: 1, height: 26, background: "var(--border-strong)", margin: "0 0.25rem" }} />

                <button
                    type="button"
                    onClick={handleLeave}
                    className="ctrl-btn is-danger"
                    aria-label="Leave call"
                    title="Leave call"
                >
                    <span className="msr sm" aria-hidden>call_end</span>
                    Leave
                </button>
            </div>

            {toast && (
                <div
                    className={`toast ${toast.tone === "error" ? "is-error" : ""}`}
                    role="status"
                    aria-live="polite"
                >
                    {toast.message}
                </div>
            )}

            {/* Hidden audio players */}
            {remoteParticipants.map((participant) => (
                <ParticipantAudio
                    key={participant.id}
                    stream={participant.displayStream}
                    boost={1.0}
                />
            ))}
        </div>
    );
};
