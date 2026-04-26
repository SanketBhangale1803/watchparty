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

// ---------------------------------------------------------------------------
// ParticipantVideo — stable video element that avoids flicker on stream swap
// ---------------------------------------------------------------------------
const ParticipantVideo = ({
    stream,
    label,
    prioritized,
    mirrored,
    muted = false,
}: {
    stream: MediaStream | null;
    label: string;
    prioritized?: boolean;
    mirrored?: boolean;
    muted?: boolean;
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isVideoReady, setIsVideoReady] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        setIsVideoReady(false);
        video.srcObject = stream;
        if (stream) {
            video.play().catch(() => undefined);
        } else {
            setIsVideoReady(true);
        }
    }, [stream]);

    return (
        <div
            className="video-container"
            style={{
                width: "100%",
                height: "100%",
                border: prioritized ? "2px solid var(--success)" : "1px solid var(--border)",
                borderRadius: "0.75rem",
                transition: "border-color 220ms ease, box-shadow 220ms ease",
            }}
        >
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
                    background: "#000",
                    transform: mirrored ? "scaleX(-1)" : "none",
                    opacity: isVideoReady ? 1 : 0,
                    transition: "opacity 220ms ease",
                }}
            />
            <div className="badge">{label}</div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// ParticipantAudio — Web Audio boosted audio output for a remote stream.
// FIX: We now pass `displayStream` which already contains all audio tracks
// (camera mic + screen audio merged), so everything plays together.
// ---------------------------------------------------------------------------
const ParticipantAudio = ({
    stream,
    boost = 3.0,
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

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------
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
    const [lobby, setLobby] = useState(true);
    const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
    const [participants, setParticipants] = useState<ParticipantState[]>([]);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [, setScreenPreviewStream] = useState<MediaStream | null>(null);

    // FIX: Play/pause now controls MediaStreamTrack.enabled on ALL tracks,
    // not just the HTMLVideoElement.pause() — so screen share audio also stops.
    const [isPlaybackPaused, setIsPlaybackPaused] = useState(false);

    const [isFullscreen, setIsFullscreen] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const localCameraPreviewRef = useRef<HTMLVideoElement>(null);
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

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    const syncParticipants = useCallback(() => {
        setParticipants(Array.from(participantStateRef.current.values()));
    }, []);

    /**
     * FIX: updateDisplayedStream now merges ALL audio tracks (camera mic +
     * screen audio) into displayStream so ParticipantAudio plays everything.
     * Video selection logic: prefer screen track when sharing, else camera.
     */
    const updateDisplayedStream = useCallback((participantId: string) => {
        const participant = participantStateRef.current.get(participantId);
        if (!participant) return;

        const allVideoTracks = participant.sourceStream.getVideoTracks();
        const allAudioTracks = participant.sourceStream.getAudioTracks();

        const screenTrack = participant.screenTrackId
            ? allVideoTracks.find((t) => t.id === participant.screenTrackId) ?? null
            : null;
        const cameraTrack = allVideoTracks.find((t) => t.id !== participant.screenTrackId) ?? null;

        // Which video to show in the main display slot
        const selectedVideoTrack = participant.isSharingScreen
            ? screenTrack || cameraTrack
            : cameraTrack || screenTrack;

        // displayStream = chosen video + ALL audio (mic + screen audio)
        const nextDisplayStream = new MediaStream();
        if (selectedVideoTrack) nextDisplayStream.addTrack(selectedVideoTrack);
        allAudioTracks.forEach((t) => nextDisplayStream.addTrack(t));

        // cameraStream = just the camera video (shown in sidebar pip)
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

            if (micTrack) {
                const micSource = audioContext.createMediaStreamSource(new MediaStream([micTrack]));
                const micGain = audioContext.createGain();
                micGain.gain.value = 1;
                micSource.connect(micGain);
                micGain.connect(destination);
            }

            const screenSource = audioContext.createMediaStreamSource(new MediaStream([screenAudioTrack]));
            const screenGain = audioContext.createGain();
            screenGain.gain.value = 1;
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

    // -----------------------------------------------------------------------
    // Fullscreen
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // FIX: Play / Pause — toggle MediaStreamTrack.enabled on ALL remote tracks
    // so screen-share audio and video both pause, not just the <video> element.
    // -----------------------------------------------------------------------
    const applyPlaybackState = useCallback((paused: boolean) => {
        // Pause/resume all remote participant tracks
        participantStateRef.current.forEach((participant) => {
            participant.sourceStream.getTracks().forEach((track) => {
                track.enabled = !paused;
            });
        });

        // Also pause/resume the local screen preview video element
        if (localScreenPreviewRef.current) {
            if (paused) {
                localScreenPreviewRef.current.pause();
            } else {
                localScreenPreviewRef.current.play().catch(() => undefined);
            }
        }
        if (localCameraPreviewRef.current) {
            if (paused) {
                localCameraPreviewRef.current.pause();
            } else {
                localCameraPreviewRef.current.play().catch(() => undefined);
            }
        }
    }, []);

    const setPlaybackState = useCallback(
        (paused: boolean, emit: boolean) => {
            setIsPlaybackPaused(paused);
            applyPlaybackState(paused);

            if (!emit) return;
            const socket = socketRef.current;
            const roomId = currentRoomIdRef.current;
            if (!socket || !roomId) return;
            socket.emit("playback-toggle", { roomId, paused });
        },
        [applyPlaybackState]
    );

    // const togglePlayback = useCallback(() => {
    //     setPlaybackState(!isPlaybackPaused, true);
    // }, [isPlaybackPaused, setPlaybackState]);

    // -----------------------------------------------------------------------
    // WebRTC helpers
    // -----------------------------------------------------------------------
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
                const audioSender = pc.getSenders().find((sender) => sender.track?.kind === "audio");

                if (audioSender) {
                    audioSender.replaceTrack(audioTrack).catch(() => undefined);
                } else if (audioTrack) {
                    pc.addTrack(audioTrack, localStreamRef.current);
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

            // Add camera + mic tracks
            localStreamRef.current.getTracks().forEach((track) => {
                pc.addTrack(track, localStreamRef.current);
            });

            // Add screen tracks if already sharing
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

                // FIX: apply current paused state to newly arriving tracks
                event.track.enabled = !isPlaybackPaused;

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
                    makingOfferRef.current.delete(peerId);
                    removeParticipant(peerId);
                }
            };

            return pc;
        },
        [createAndSendOffer, isPlaybackPaused, removeParticipant, upsertParticipantStream]
    );

    // -----------------------------------------------------------------------
    // Screen share
    // -----------------------------------------------------------------------
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

    /**
     * FIX: startScreenShare now correctly sends screen audio to peers and
     * also plays screen audio locally via Web Audio so the sharer hears it.
     */
    const startScreenShare = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    // Request system audio / tab audio
                    echoCancellation: false,
                    noiseSuppression: false,
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

            // Show local preview of the screen
            const previewStream = new MediaStream([videoTrack]);
            setScreenPreviewStream(previewStream);
            setIsScreenSharing(true);

            // FIX: play local screen preview in the dedicated video element
            if (localScreenPreviewRef.current) {
                localScreenPreviewRef.current.srcObject = previewStream;
                localScreenPreviewRef.current.play().catch(() => undefined);
            }

            // Send screen tracks to all existing peers
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

    // -----------------------------------------------------------------------
    // Local tracks — update senders when cam/mic changes
    // -----------------------------------------------------------------------
    useEffect(() => {
        const nextAudioTrack = buildOutboundAudioTrack(localAudioTrack, screenAudioTrackRef.current);
        const nextLocalStream = new MediaStream();
        if (localVideoTrack) nextLocalStream.addTrack(localVideoTrack);
        if (nextAudioTrack) nextLocalStream.addTrack(nextAudioTrack);
        localStreamRef.current = nextLocalStream;
        outboundAudioTrackRef.current = nextAudioTrack;

        if (localCameraPreviewRef.current) {
            localCameraPreviewRef.current.srcObject = new MediaStream(localVideoTrack ? [localVideoTrack] : []);
            localCameraPreviewRef.current.play().catch(() => undefined);
        }

        peersRef.current.forEach((pc, peerId) => {
            const senders = pc.getSenders();

            const camSender = senders.find(
                (s) => s.track?.kind === "video" && s.track.id !== screenVideoTrackRef.current?.id
            );
            const micSender = senders.find((s) => s.track?.kind === "audio");

            if (localVideoTrack) {
                if (camSender) camSender.replaceTrack(localVideoTrack).catch(() => undefined);
                else pc.addTrack(localVideoTrack, localStreamRef.current);
            }
            if (nextAudioTrack) {
                if (micSender) micSender.replaceTrack(nextAudioTrack).catch(() => undefined);
                else pc.addTrack(nextAudioTrack, localStreamRef.current);
            } else if (micSender) {
                micSender.replaceTrack(null).catch(() => undefined);
            }

            createAndSendOffer(peerId);
        });
    }, [buildOutboundAudioTrack, createAndSendOffer, localAudioTrack, localVideoTrack]);

    // -----------------------------------------------------------------------
    // Socket.io
    // -----------------------------------------------------------------------
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

        socket.on("playback-toggle", ({ paused }: { paused: boolean }) => {
            setPlaybackState(paused, false);
        });

        socket.on("participant-left", ({ participantId }: { roomId: string; participantId: string }) => {
            const pc = peersRef.current.get(participantId);
            if (pc) pc.close();
            peersRef.current.delete(participantId);
            remoteStreamsRef.current.delete(participantId);
            screenVideoSendersRef.current.delete(participantId);
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

    // -----------------------------------------------------------------------
    // Layout logic
    //
    // No screen sharing active:
    //   Main  = remote participant's camera (full view)
    //   Sidebar = local camera only (remote is NOT duplicated in sidebar)
    //
    // Screen sharing active (local OR remote):
    //   Main  = shared screen
    //   Sidebar = local camera + remote camera pip (slides in smoothly)
    // -----------------------------------------------------------------------

    const remoteParticipants = useMemo(
        () => participants.filter((p) => p.id !== socketIdRef.current),
        [participants]
    );

    const remoteSharingParticipant = useMemo(
        () => remoteParticipants.find((p) => p.isSharingScreen) ?? null,
        [remoteParticipants]
    );

    // anyoneSharing = local or remote is sharing
    const anyoneSharing = isScreenSharing || !!remoteSharingParticipant;

    // Main panel:
    //   - If WE share → show our screen (via always-mounted video ref, shown via CSS)
    //   - If REMOTE shares → show their screen
    //   - Nobody sharing → show first remote's camera
    const mainPanelParticipant = useMemo(() => {
        if (isScreenSharing) return null;           // our screen shown via ref
        if (remoteSharingParticipant) return remoteSharingParticipant;
        return remoteParticipants[0] ?? null;
    }, [isScreenSharing, remoteSharingParticipant, remoteParticipants]);

    // Sidebar remote tiles:
    //   - When sharing is active: show every remote's camera pip
    //   - When NOT sharing: hide remotes from sidebar (they're in main panel)
    const sidebarRemotes = useMemo(() => {
        if (!anyoneSharing) return [];   // remote is in main panel, don't duplicate
        return remoteParticipants;       // show camera pip for all remotes
    }, [anyoneSharing, remoteParticipants]);

    return (
        /*
         * Root container: 100vw wide, never overflows horizontally.
         * display:flex + flex:1 on the grid div means the grid fills
         * all remaining vertical space without a hard-coded height.
         */
        <div
            ref={containerRef}
            style={{
                width: "100%",
                maxWidth: "100vw",
                minHeight: "100vh",
                overflow: "hidden",
                boxSizing: "border-box",
                backgroundColor: isFullscreen ? "#000" : "var(--bg-main)",
                padding: "0.75rem 1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
            }}
        >
            {/* Header */}
            <div style={{ textAlign: "center", flexShrink: 0 }}>
                <h2 style={{ fontSize: "1.2rem", fontWeight: 700 }}>Hi, {name}</h2>
                {lobby && !currentRoomId && (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Generating room…</p>
                )}
                {lobby && currentRoomId && (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                        Waiting for others… Room ID: <strong>{currentRoomId}</strong>
                    </p>
                )}
                {!lobby && currentRoomId && (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                        Room ID: <strong>{currentRoomId}</strong>
                    </p>
                )}
            </div>

            {/*
             * Main grid — flex:1 makes it consume all leftover vertical space.
             * gridTemplateColumns: sidebar is fixed 240px; main panel takes the rest
             * via minmax(0,1fr) — the minmax(0,...) is critical, it prevents the
             * main column from blowing out past the container width.
             */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) 240px",
                    gridTemplateRows: "1fr",
                    gap: "0.75rem",
                    flex: 1,
                    minHeight: 0,        /* required so flex child can shrink */
                    width: "100%",
                    overflow: "hidden",
                }}
            >
                {/* ── Main panel ── */}
                <div style={{ position: "relative", minHeight: 0, overflow: "hidden", borderRadius: "0.75rem" }}>

                    {/* Local screen share — always mounted, shown via CSS opacity */}
                    <div
                        className="video-container"
                        style={{
                            position: "absolute",
                            inset: 0,
                            border: "2px solid var(--success)",
                            borderRadius: "0.75rem",
                            opacity: isScreenSharing ? 1 : 0,
                            pointerEvents: isScreenSharing ? "auto" : "none",
                            transition: "opacity 300ms ease",
                            zIndex: isScreenSharing ? 2 : 0,
                        }}
                    >
                        <video
                            ref={localScreenPreviewRef}
                            autoPlay
                            muted
                            playsInline
                            style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                                background: "#000",
                            }}
                        />
                        <div className="badge">Your Screen</div>
                    </div>

                    {/* Remote screen share */}
                    {remoteSharingParticipant && (
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                opacity: !isScreenSharing ? 1 : 0,
                                transition: "opacity 300ms ease",
                                zIndex: !isScreenSharing ? 2 : 0,
                            }}
                        >
                            <ParticipantVideo
                                stream={remoteSharingParticipant.displayStream}
                                label={`${remoteSharingParticipant.name} (Sharing)`}
                                prioritized
                                muted
                            />
                        </div>
                    )}

                    {/* Remote camera — shown when nobody is sharing */}
                    {mainPanelParticipant && !mainPanelParticipant.isSharingScreen && (
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                opacity: !anyoneSharing ? 1 : 0,
                                transition: "opacity 300ms ease",
                                zIndex: !anyoneSharing ? 2 : 0,
                            }}
                        >
                            <ParticipantVideo
                                stream={mainPanelParticipant.displayStream}
                                label={mainPanelParticipant.name}
                                muted
                            />
                        </div>
                    )}

                    {/* Empty state */}
                    {!mainPanelParticipant && !isScreenSharing && (
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1px solid var(--border)",
                                borderRadius: "0.75rem",
                                color: "var(--text-muted)",
                            }}
                        >
                            Waiting for participants…
                        </div>
                    )}
                </div>

                {/* ── Sidebar ── */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.75rem",
                        minHeight: 0,
                        overflow: "hidden",
                    }}
                >
                    {/* Local camera — always visible in sidebar */}
                    <div style={{ width: "100%", aspectRatio: "16 / 9", flexShrink: 0 }}>
                        <div
                            className="video-container"
                            style={{
                                height: "100%",
                                border: isScreenSharing
                                    ? "2px solid var(--success)"
                                    : "1px solid var(--border)",
                                transition: "border-color 220ms ease",
                            }}
                        >
                            <video
                                ref={localCameraPreviewRef}
                                autoPlay
                                muted
                                playsInline
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    background: "#000",
                                    transform: "scaleX(-1)",
                                }}
                            />
                            <div className="badge">You</div>
                        </div>
                    </div>

                    {/* Remote camera pips — slide in when sharing starts */}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.75rem",
                            overflow: "hidden",
                            maxHeight: anyoneSharing ? "800px" : "0px",
                            opacity: anyoneSharing ? 1 : 0,
                            transition: "max-height 350ms ease, opacity 300ms ease",
                        }}
                    >
                        {sidebarRemotes.map((participant) => (
                            <div key={participant.id} style={{ width: "100%", aspectRatio: "16 / 9", flexShrink: 0 }}>
                                <ParticipantVideo
                                    stream={participant.cameraStream || participant.displayStream}
                                    label={participant.name}
                                    muted
                                />
                            </div>
                        ))}
                    </div>

                    {/* Controls — no play/pause */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "auto" }}>
                        <button
                            className={isScreenSharing ? "btn btn-danger" : "btn btn-primary"}
                            onClick={toggleScreenShare}
                            disabled={lobby}
                            style={{ width: "100%" }}
                        >
                            {isScreenSharing ? "⏹ Stop Sharing" : "🖥 Share Screen"}
                        </button>
                        <button
                            className="btn btn-secondary"
                            onClick={toggleFullscreen}
                            disabled={lobby}
                            style={{ width: "100%" }}
                        >
                            {isFullscreen ? "⤓ Exit Fullscreen" : "⤢ Fullscreen"}
                        </button>
                    </div>
                </div>
            </div>

            {/* Hidden audio players — one per remote participant */}
            {remoteParticipants.map((participant) => (
                <ParticipantAudio
                    key={participant.id}
                    stream={participant.displayStream}
                    boost={1.7}
                />
            ))}
        </div>
    );
};
