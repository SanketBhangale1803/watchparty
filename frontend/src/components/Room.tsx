import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Socket, io } from "socket.io-client";

const URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

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
}: {
    stream: MediaStream | null;
    label: string;
    prioritized?: boolean;
    mirrored?: boolean;
    muted?: boolean;
    isLocal?: boolean;
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
                border: prioritized ? "2px solid var(--success)" : isLocal ? "2px solid var(--primary)" : "1px solid var(--border)",
                transition: "border-color 220ms ease, box-shadow 220ms ease",
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
                    objectFit: "cover",
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
    useEffect(() => {
        if (!stream) return;

        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = boost;
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        audioContext.resume().catch(() => undefined);

        return () => {
            source.disconnect();
            gainNode.disconnect();
            audioContext.close().catch(() => undefined);
        };
    }, [stream, boost]);

    return null;
};

export const Room = ({
    name,
    localAudioTrack,
    localVideoTrack,
    demoRoomId,
}: {
    name: string;
    localAudioTrack: MediaStreamTrack | null;
    localVideoTrack: MediaStreamTrack | null;
    demoRoomId?: string;
}) => {
    const [, setLobby] = useState(true);
    const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
    const [participants, setParticipants] = useState<ParticipantState[]>([]);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [, setScreenPreviewStream] = useState<MediaStream | null>(null);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showParticipants, setShowParticipants] = useState(false);
    const [micEnabled, setMicEnabled] = useState(true);
    const [camEnabled, setCamEnabled] = useState(true);

    const containerRef = useRef<HTMLDivElement>(null);
    const localScreenPreviewRef = useRef<HTMLVideoElement>(null);

    const socketRef = useRef<Socket | null>(null);
    const socketIdRef = useRef<string | null>(null);
    const currentRoomIdRef = useRef<string | null>(null);

    const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
    const peerNamesRef = useRef<Map<string, string>>(new Map());
    const participantStateRef = useRef<Map<string, ParticipantState>>(new Map());
    const screenStatusRef = useRef<Map<string, { isSharing: boolean; trackId: string | null }>>(new Map());
    const makingOfferRef = useRef<Map<string, boolean>>(new Map());

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

    const upsertParticipantStream = useCallback(
        (participantId: string, stream: MediaStream, participantName?: string) => {
            const existing = participantStateRef.current.get(participantId);
            const nextState: ParticipantState = existing
                ? { ...existing, sourceStream: stream }
                : {
                      id: participantId,
                      name: participantName || peerNamesRef.current.get(participantId) || "Guest",
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
            const compressor = audioContext.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 18;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;
            compressor.connect(destination);

            if (micTrack) {
                const micSource = audioContext.createMediaStreamSource(new MediaStream([micTrack]));
                const micGain = audioContext.createGain();
                micGain.gain.value = 1.0;
                micSource.connect(micGain);
                micGain.connect(compressor);
            }

            const screenSource = audioContext.createMediaStreamSource(new MediaStream([screenAudioTrack]));
            const screenGain = audioContext.createGain();
            screenGain.gain.value = 0.8;
            screenSource.connect(screenGain);
            screenGain.connect(compressor);

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
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
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
            }

            if (screenStreamRef.current && screenVideoTrackRef.current) {
                const s = pc.addTrack(screenVideoTrackRef.current, screenStreamRef.current);
                screenVideoSendersRef.current.set(peerId, s);
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

            pc.onconnectionstatechange = () => {
                const state = pc.connectionState;
                if (state === "failed" || state === "closed" || state === "disconnected") {
                    pc.close();
                    peersRef.current.delete(peerId);
                    remoteStreamsRef.current.delete(peerId);
                    screenVideoSendersRef.current.delete(peerId);
                    cameraSendersRef.current.delete(peerId);
                    audioSendersRef.current.delete(peerId);
                    makingOfferRef.current.delete(peerId);
                    removeParticipant(peerId);
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
        emitScreenShareStatus(false, null);
    }, [buildOutboundAudioTrack, createAndSendOffer, emitScreenShareStatus, localAudioTrack, syncOutboundAudioTrack]);

    const startScreenShare = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100,
                },
            });

            const videoTrack = stream.getVideoTracks()[0] ?? null;
            const audioTrack = stream.getAudioTracks()[0] ?? null;

            if (!videoTrack) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }

            screenStreamRef.current = stream;
            screenVideoTrackRef.current = videoTrack;
            screenAudioTrackRef.current = audioTrack;
            syncOutboundAudioTrack(buildOutboundAudioTrack(localAudioTrack, audioTrack));

            const previewStream = new MediaStream([videoTrack]);
            setScreenPreviewStream(previewStream);
            setIsScreenSharing(true);

            if (localScreenPreviewRef.current) {
                localScreenPreviewRef.current.srcObject = previewStream;
                localScreenPreviewRef.current.play().catch(() => undefined);
            }

            peersRef.current.forEach((pc, peerId) => {
                const vs = pc.addTrack(videoTrack, stream);
                screenVideoSendersRef.current.set(peerId, vs);
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
                }
            } else if (micSender) {
                micSender.replaceTrack(null).catch(() => undefined);
            }

            createAndSendOffer(peerId);
        });
    }, [buildOutboundAudioTrack, createAndSendOffer, localAudioTrack, localVideoTrack]);

    useEffect(() => {
        const socket = io(URL);
        socketRef.current = socket;

        socket.on("connect", () => {
            socketIdRef.current = socket.id ?? null;
            if (demoRoomId) socket.emit("join-room", { roomId: demoRoomId, name });
            else socket.emit("create-room", { name });
        });

        socket.on("room-created", ({ roomId }: { roomId: string }) => {
            setCurrentRoomId(roomId);
            currentRoomIdRef.current = roomId;
        });

        socket.on(
            "room-joined",
            ({ roomId, participants: existing }: { roomId: string; participants: PeerSummary[] }) => {
                setLobby(false);
                setCurrentRoomId(roomId);
                currentRoomIdRef.current = roomId;
                existing.forEach((p) => {
                    peerNamesRef.current.set(p.id, p.name);
                    ensurePeerConnection(p.id, p.name);
                    createAndSendOffer(p.id);
                });
            }
        );

        socket.on("participant-joined", ({ participant }: { roomId: string; participant: PeerSummary }) => {
            peerNamesRef.current.set(participant.id, participant.name);
            ensurePeerConnection(participant.id, participant.name);
        });

        socket.on(
            "offer",
            async ({ fromId, sdp }: { roomId: string; fromId: string; sdp: RTCSessionDescriptionInit }) => {
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
            const pc = peersRef.current.get(participantId);
            if (pc) pc.close();
            peersRef.current.delete(participantId);
            remoteStreamsRef.current.delete(participantId);
            screenVideoSendersRef.current.delete(participantId);
            cameraSendersRef.current.delete(participantId);
            audioSendersRef.current.delete(participantId);
            peerNamesRef.current.delete(participantId);
            makingOfferRef.current.delete(participantId);
            removeParticipant(participantId);
        });

        socket.on("room-join-error", ({ message }: { message: string }) => {
            alert(message);
            setLobby(true);
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

    const remoteParticipants = useMemo(
        () => participants.filter((p) => p.id !== socketIdRef.current),
        [participants]
    );

    const allTiles = useMemo(() => {
        const tiles = [{ id: "self", name, displayStream: localStreamRef.current, isLocal: true }];
        remoteParticipants.forEach((p) => {
            tiles.push({ id: p.id, name: p.name, displayStream: p.displayStream, isLocal: false });
        });
        return tiles;
    }, [name, remoteParticipants]);

    const gridCols = useMemo(() => {
        const count = allTiles.length;
        if (count <= 1) return "1fr";
        if (count === 2) return "1fr 1fr";
        if (count <= 4) return "1fr 1fr";
        if (count <= 6) return "1fr 1fr 1fr";
        if (count <= 9) return "1fr 1fr 1fr";
        return "1fr 1fr 1fr 1fr";
    }, [allTiles.length]);

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

    const handleLeave = useCallback(() => {
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
        socketRef.current?.disconnect();
        socketRef.current = null;
        window.location.reload();
    }, [stopScreenShare, disposeMixedAudio]);

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                maxWidth: "100vw",
                height: "100vh",
                overflow: "hidden",
                boxSizing: "border-box",
                backgroundColor: isFullscreen ? "#000" : "#0f172a",
                display: "flex",
                flexDirection: "column",
            }}
        >
            {/* Header */}
            <div style={{
                padding: "0.75rem 1.25rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "rgba(15, 23, 42, 0.9)",
                backdropFilter: "blur(8px)",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                flexShrink: 0,
                zIndex: 10,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <div style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        background: "linear-gradient(135deg, var(--primary), #7c3aed)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white",
                        fontSize: "0.9rem",
                    }}>
                        ▶
                    </div>
                    <div>
                        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "white" }}>WatchParty</h2>
                        {currentRoomId && (
                            <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: 0 }}>
                                Room: <strong style={{ color: "#e2e8f0" }}>{currentRoomId}</strong>
                            </p>
                        )}
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                        {totalParticipants} {totalParticipants === 1 ? "participant" : "participants"}
                    </span>
                    <button
                        onClick={() => setShowParticipants(!showParticipants)}
                        style={{
                            background: showParticipants ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: "8px",
                            padding: "0.5rem 0.75rem",
                            color: "white",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            transition: "all 0.2s",
                        }}
                    >
                        👥 Participants
                    </button>
                </div>
            </div>

            {/* Main content area */}
            <div style={{
                flex: 1,
                display: "flex",
                overflow: "hidden",
                minHeight: 0,
            }}>
                {/* Video grid */}
                <div style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    padding: showParticipants ? "0.75rem" : "0.75rem 0.75rem 0.75rem 0.75rem",
                }}>
                    <div style={{
                        flex: 1,
                        display: "grid",
                        gridTemplateColumns: gridCols,
                        gap: "0.75rem",
                        gridAutoRows: "1fr",
                        minHeight: 0,
                    }}>
                        {allTiles.map((tile) => {
                            const remoteP = remoteParticipants.find((p) => p.id === tile.id);
                            const isSharing = tile.id === "self" ? isScreenSharing : (remoteP?.isSharingScreen ?? false);
                            return (
                                <ParticipantVideo
                                    key={tile.id}
                                    stream={tile.displayStream}
                                    label={tile.name}
                                    mirrored={tile.isLocal}
                                    muted={tile.isLocal}
                                    isLocal={tile.isLocal}
                                    prioritized={isSharing}
                                />
                            );
                        })}
                    </div>

                    {/* Control bar */}
                    <div style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: "0.75rem",
                        padding: "1rem 0 0.5rem",
                        flexShrink: 0,
                    }}>
                        <button
                            onClick={handleToggleMic}
                            style={{
                                width: "52px",
                                height: "52px",
                                borderRadius: "50%",
                                border: "none",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "1.35rem",
                                background: micEnabled ? "rgba(255,255,255,0.12)" : "var(--danger)",
                                color: "white",
                                transition: "all 0.2s",
                            }}
                            title={micEnabled ? "Mute" : "Unmute"}
                        >
                            {micEnabled ? "🎤" : "🔇"}
                        </button>

                        <button
                            onClick={handleToggleCam}
                            style={{
                                width: "52px",
                                height: "52px",
                                borderRadius: "50%",
                                border: "none",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "1.35rem",
                                background: camEnabled ? "rgba(255,255,255,0.12)" : "var(--danger)",
                                color: "white",
                                transition: "all 0.2s",
                            }}
                            title={camEnabled ? "Stop camera" : "Start camera"}
                        >
                            {camEnabled ? "📹" : "📷"}
                        </button>

                        <button
                            onClick={toggleScreenShare}
                            style={{
                                width: "52px",
                                height: "52px",
                                borderRadius: "50%",
                                border: "none",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "1.35rem",
                                background: isScreenSharing ? "var(--success)" : "rgba(255,255,255,0.12)",
                                color: "white",
                                transition: "all 0.2s",
                            }}
                            title={isScreenSharing ? "Stop sharing" : "Share screen"}
                        >
                            🖥
                        </button>

                        <button
                            onClick={toggleFullscreen}
                            style={{
                                width: "52px",
                                height: "52px",
                                borderRadius: "50%",
                                border: "none",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "1.35rem",
                                background: "rgba(255,255,255,0.12)",
                                color: "white",
                                transition: "all 0.2s",
                            }}
                            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                        >
                            {isFullscreen ? "⤓" : "⤢"}
                        </button>

                        <button
                            onClick={handleLeave}
                            style={{
                                width: "52px",
                                height: "52px",
                                borderRadius: "50%",
                                border: "none",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "1.35rem",
                                background: "var(--danger)",
                                color: "white",
                                transition: "all 0.2s",
                            }}
                            title="Leave"
                        >
                            📞
                        </button>
                    </div>
                </div>

                {/* Participant sidebar */}
                {showParticipants && (
                    <div style={{
                        width: "280px",
                        background: "rgba(15, 23, 42, 0.95)",
                        borderLeft: "1px solid rgba(255,255,255,0.08)",
                        display: "flex",
                        flexDirection: "column",
                        flexShrink: 0,
                        overflow: "hidden",
                    }}>
                        <div style={{
                            padding: "1rem 1.25rem",
                            borderBottom: "1px solid rgba(255,255,255,0.08)",
                            flexShrink: 0,
                        }}>
                            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: "white", margin: 0 }}>
                                Participants ({totalParticipants})
                            </h3>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem 0" }}>
                            {/* Local user */}
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.75rem",
                                padding: "0.625rem 1.25rem",
                            }}>
                                <div style={{
                                    width: "36px",
                                    height: "36px",
                                    borderRadius: "50%",
                                    background: "linear-gradient(135deg, var(--primary), #7c3aed)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "white",
                                    fontWeight: 600,
                                    fontSize: "0.9rem",
                                    flexShrink: 0,
                                }}>
                                    {name.charAt(0).toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "white", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {name} (You)
                                    </p>
                                </div>
                                <div style={{ display: "flex", gap: "0.35rem" }}>
                                    <span title={micEnabled ? "Mic on" : "Mic off"} style={{ fontSize: "0.9rem" }}>
                                        {micEnabled ? "🎤" : "🔇"}
                                    </span>
                                    <span title={camEnabled ? "Camera on" : "Camera off"} style={{ fontSize: "0.9rem" }}>
                                        {camEnabled ? "📹" : "📷"}
                                    </span>
                                </div>
                            </div>

                            {/* Remote participants */}
                            {remoteParticipants.map((p) => (
                                <div key={p.id} style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.75rem",
                                    padding: "0.625rem 1.25rem",
                                }}>
                                    <div style={{
                                        width: "36px",
                                        height: "36px",
                                        borderRadius: "50%",
                                        background: "linear-gradient(135deg, #64748b, #475569)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        color: "white",
                                        fontWeight: 600,
                                        fontSize: "0.9rem",
                                        flexShrink: 0,
                                    }}>
                                        {p.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "white", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {p.name}
                                        </p>
                                    </div>
                                    <div style={{ display: "flex", gap: "0.35rem" }}>
                                        <span style={{ fontSize: "0.9rem" }}>🎤</span>
                                        <span style={{ fontSize: "0.9rem" }}>📹</span>
                                    </div>
                                </div>
                            ))}

                            {remoteParticipants.length === 0 && (
                                <div style={{
                                    padding: "2rem 1.25rem",
                                    textAlign: "center",
                                    color: "#64748b",
                                    fontSize: "0.875rem",
                                }}>
                                    Waiting for others to join...
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

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
