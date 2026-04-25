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
    isSharingScreen: boolean;
    screenTrackId: string | null;
};

const ParticipantVideo = ({
    stream,
    label,
    muted,
    prioritized,
    paused
}: {
    stream: MediaStream | null;
    label: string;
    muted: boolean;
    prioritized?: boolean;
    paused?: boolean;
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (!videoRef.current) {
            return;
        }
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => undefined);
    }, [stream]);

    useEffect(() => {
        if (!videoRef.current) {
            return;
        }
        if (paused) {
            videoRef.current.pause();
            return;
        }
        videoRef.current.play().catch(() => undefined);
    }, [paused]);

    return (
        <div
            className="video-container"
            style={{
                width: "100%",
                height: "100%",
                border: prioritized ? "2px solid var(--success)" : "1px solid var(--border)",
                borderRadius: "0.75rem"
            }}
        >
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={muted}
                style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
            />
            <div className="badge">{label}</div>
        </div>
    );
};

export const Room = ({
    name,
    localAudioTrack,
    localVideoTrack,
    demoRoomId
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
    const [screenPreviewStream, setScreenPreviewStream] = useState<MediaStream | null>(null);
    const [isPlaybackPaused, setIsPlaybackPaused] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const localPreviewRef = useRef<HTMLVideoElement>(null);
    const socketRef = useRef<Socket | null>(null);
    const currentRoomIdRef = useRef<string | null>(null);

    const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    const peerNamesRef = useRef<Map<string, string>>(new Map());
    const participantStateRef = useRef<Map<string, ParticipantState>>(new Map());
    const screenStatusRef = useRef<Map<string, { isSharing: boolean; trackId: string | null }>>(new Map());

    const localStreamRef = useRef<MediaStream>(new MediaStream());
    const screenStreamRef = useRef<MediaStream | null>(null);
    const screenVideoTrackRef = useRef<MediaStreamTrack | null>(null);
    const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
    const screenVideoSendersRef = useRef<Map<string, RTCRtpSender>>(new Map());
    const screenAudioSendersRef = useRef<Map<string, RTCRtpSender>>(new Map());

    const syncParticipants = useCallback(() => {
        setParticipants(Array.from(participantStateRef.current.values()));
    }, []);

    const updateDisplayedStream = useCallback((participantId: string) => {
        const participant = participantStateRef.current.get(participantId);
        if (!participant) {
            return;
        }

        const allVideoTracks = participant.sourceStream.getVideoTracks();
        const allAudioTracks = participant.sourceStream.getAudioTracks();
        let selectedVideoTrack: MediaStreamTrack | null = allVideoTracks[0] ?? null;

        if (participant.isSharingScreen && participant.screenTrackId) {
            selectedVideoTrack =
                allVideoTracks.find((track) => track.id === participant.screenTrackId) ?? selectedVideoTrack;
        }

        const nextDisplayStream = new MediaStream();
        if (selectedVideoTrack) {
            nextDisplayStream.addTrack(selectedVideoTrack);
        }
        allAudioTracks.forEach((track) => nextDisplayStream.addTrack(track));

        participant.displayStream = nextDisplayStream;
        participantStateRef.current.set(participantId, participant);
    }, []);

    const upsertParticipantStream = useCallback(
        (participantId: string, stream: MediaStream, participantName?: string) => {
            const existing = participantStateRef.current.get(participantId);
            const nextState: ParticipantState = existing
                ? {
                      ...existing,
                      sourceStream: stream
                  }
                : {
                      id: participantId,
                      name: participantName || peerNamesRef.current.get(participantId) || "Guest",
                      sourceStream: stream,
                      displayStream: new MediaStream(),
                      isSharingScreen: screenStatusRef.current.get(participantId)?.isSharing ?? false,
                      screenTrackId: screenStatusRef.current.get(participantId)?.trackId ?? null
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

    const emitScreenShareStatus = useCallback(
        (isSharing: boolean, trackId: string | null) => {
            const socket = socketRef.current;
            const roomId = currentRoomIdRef.current;
            if (!socket || !roomId) {
                return;
            }
            socket.emit("screen-share-status", { roomId, isSharing, trackId });
        },
        []
    );

    const toggleFullscreen = useCallback(async () => {
        if (!containerRef.current) {
            return;
        }

        try {
            if (!document.fullscreenElement) {
                await containerRef.current.requestFullscreen();
                setIsFullscreen(true);
            } else {
                await document.exitFullscreen();
                setIsFullscreen(false);
            }
        } catch (error) {
            console.error("Failed to toggle fullscreen", error);
        }
    }, []);

    const setPlaybackState = useCallback((paused: boolean, emit: boolean) => {
        setIsPlaybackPaused(paused);
        if (!emit) {
            return;
        }

        const socket = socketRef.current;
        const roomId = currentRoomIdRef.current;
        if (!socket || !roomId) {
            return;
        }

        socket.emit("playback-toggle", {
            roomId,
            paused
        });
    }, []);

    const togglePlayback = useCallback(() => {
        setPlaybackState(!isPlaybackPaused, true);
    }, [isPlaybackPaused, setPlaybackState]);

    const createAndSendOffer = useCallback(async (peerId: string) => {
        const socket = socketRef.current;
        const roomId = currentRoomIdRef.current;
        const peerConnection = peersRef.current.get(peerId);
        if (!socket || !roomId || !peerConnection) {
            return;
        }

        if (peerConnection.signalingState !== "stable") {
            return;
        }

        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit("offer", {
                roomId,
                targetId: peerId,
                sdp: peerConnection.localDescription
            });
        } catch (error) {
            console.error("Failed to create offer", error);
        }
    }, []);

    const ensurePeerConnection = useCallback(
        (peerId: string, peerName?: string) => {
            const existing = peersRef.current.get(peerId);
            if (existing) {
                if (peerName) {
                    peerNamesRef.current.set(peerId, peerName);
                }
                return existing;
            }

            if (peerName) {
                peerNamesRef.current.set(peerId, peerName);
            }

            const socket = socketRef.current;
            const peerConnection = new RTCPeerConnection();
            peersRef.current.set(peerId, peerConnection);

            localStreamRef.current.getTracks().forEach((track) => {
                peerConnection.addTrack(track, localStreamRef.current);
            });

            if (screenStreamRef.current && screenVideoTrackRef.current) {
                const sender = peerConnection.addTrack(screenVideoTrackRef.current, screenStreamRef.current);
                screenVideoSendersRef.current.set(peerId, sender);
            }

            if (screenStreamRef.current && screenAudioTrackRef.current) {
                const sender = peerConnection.addTrack(screenAudioTrackRef.current, screenStreamRef.current);
                screenAudioSendersRef.current.set(peerId, sender);
            }

            peerConnection.onicecandidate = (event) => {
                if (!event.candidate || !socket || !currentRoomIdRef.current) {
                    return;
                }

                socket.emit("ice-candidate", {
                    roomId: currentRoomIdRef.current,
                    targetId: peerId,
                    candidate: event.candidate
                });
            };

            peerConnection.ontrack = (event) => {
                const incomingStream = event.streams[0] || new MediaStream([event.track]);
                upsertParticipantStream(peerId, incomingStream);
            };

            peerConnection.onnegotiationneeded = () => {
                createAndSendOffer(peerId);
            };

            peerConnection.onconnectionstatechange = () => {
                const state = peerConnection.connectionState;
                if (state === "failed" || state === "closed" || state === "disconnected") {
                    peerConnection.close();
                    peersRef.current.delete(peerId);
                    screenVideoSendersRef.current.delete(peerId);
                    screenAudioSendersRef.current.delete(peerId);
                    removeParticipant(peerId);
                }
            };

            return peerConnection;
        },
        [removeParticipant, upsertParticipantStream]
    );

    const stopScreenShare = useCallback(() => {
        const screenStream = screenStreamRef.current;
        if (!screenStream) {
            setScreenPreviewStream(null);
            setIsScreenSharing(false);
            return;
        }

        peersRef.current.forEach((peerConnection, peerId) => {
            const videoSender = screenVideoSendersRef.current.get(peerId);
            if (videoSender) {
                peerConnection.removeTrack(videoSender);
                screenVideoSendersRef.current.delete(peerId);
            }

            const audioSender = screenAudioSendersRef.current.get(peerId);
            if (audioSender) {
                peerConnection.removeTrack(audioSender);
                screenAudioSendersRef.current.delete(peerId);
            }

            createAndSendOffer(peerId);
        });

        screenStream.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
        screenVideoTrackRef.current = null;
        screenAudioTrackRef.current = null;
        setScreenPreviewStream(null);
        setIsScreenSharing(false);
        emitScreenShareStatus(false, null);
    }, [createAndSendOffer, emitScreenShareStatus]);

    const startScreenShare = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

            const videoTrack = stream.getVideoTracks()[0] ?? null;
            const audioTrack = stream.getAudioTracks()[0] ?? null;

            if (!videoTrack) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            screenStreamRef.current = stream;
            screenVideoTrackRef.current = videoTrack;
            screenAudioTrackRef.current = audioTrack;
            setScreenPreviewStream(new MediaStream([videoTrack]));
            setIsScreenSharing(true);

            peersRef.current.forEach((peerConnection, peerId) => {
                const videoSender = peerConnection.addTrack(videoTrack, stream);
                screenVideoSendersRef.current.set(peerId, videoSender);

                if (audioTrack) {
                    const audioSender = peerConnection.addTrack(audioTrack, stream);
                    screenAudioSendersRef.current.set(peerId, audioSender);
                }

                createAndSendOffer(peerId);
            });

            emitScreenShareStatus(true, videoTrack.id);
            videoTrack.onended = () => {
                stopScreenShare();
            };
        } catch (error) {
            console.error("Failed to start screen share", error);
        }
    }, [createAndSendOffer, emitScreenShareStatus, stopScreenShare]);

    const toggleScreenShare = useCallback(() => {
        if (isScreenSharing) {
            stopScreenShare();
            return;
        }
        startScreenShare();
    }, [isScreenSharing, startScreenShare, stopScreenShare]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => {
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
        };
    }, []);

    useEffect(() => {
        const nextLocalStream = new MediaStream();
        if (localVideoTrack) {
            nextLocalStream.addTrack(localVideoTrack);
        }
        if (localAudioTrack) {
            nextLocalStream.addTrack(localAudioTrack);
        }
        localStreamRef.current = nextLocalStream;

        if (localPreviewRef.current) {
            localPreviewRef.current.srcObject = new MediaStream(localVideoTrack ? [localVideoTrack] : []);
            localPreviewRef.current.play().catch(() => undefined);
        }

        peersRef.current.forEach((peerConnection, peerId) => {
            const senders = peerConnection.getSenders();
            const cameraSender = senders.find(
                (sender) =>
                    sender.track?.kind === "video" &&
                    sender.track.id !== screenVideoTrackRef.current?.id
            );
            const micSender = senders.find(
                (sender) =>
                    sender.track?.kind === "audio" &&
                    sender.track.id !== screenAudioTrackRef.current?.id
            );

            if (localVideoTrack) {
                if (cameraSender) {
                    cameraSender.replaceTrack(localVideoTrack).catch(() => undefined);
                } else {
                    peerConnection.addTrack(localVideoTrack, localStreamRef.current);
                }
            }

            if (localAudioTrack) {
                if (micSender) {
                    micSender.replaceTrack(localAudioTrack).catch(() => undefined);
                } else {
                    peerConnection.addTrack(localAudioTrack, localStreamRef.current);
                }
            }

            createAndSendOffer(peerId);
        });
    }, [createAndSendOffer, localAudioTrack, localVideoTrack]);

    useEffect(() => {
        if (!localPreviewRef.current) {
            return;
        }

        if (isPlaybackPaused) {
            localPreviewRef.current.pause();
            return;
        }

        localPreviewRef.current.play().catch(() => undefined);
    }, [isPlaybackPaused]);

    useEffect(() => {
        const socket = io(URL);
        socketRef.current = socket;

        socket.on("connect", () => {
            if (demoRoomId) {
                socket.emit("join-room", { roomId: demoRoomId, name });
            } else {
                socket.emit("create-room", { name });
            }
        });

        socket.on("room-created", ({ roomId }: { roomId: string }) => {
            setCurrentRoomId(roomId);
            currentRoomIdRef.current = roomId;
        });

        socket.on(
            "room-joined",
            ({ roomId, participants: existingParticipants }: { roomId: string; participants: PeerSummary[] }) => {
                setLobby(false);
                setCurrentRoomId(roomId);
                currentRoomIdRef.current = roomId;
                existingParticipants.forEach((participant) => {
                    peerNamesRef.current.set(participant.id, participant.name);
                    ensurePeerConnection(participant.id, participant.name);
                });
            }
        );

        socket.on(
            "participant-joined",
            ({ participant }: { roomId: string; participant: PeerSummary }) => {
                peerNamesRef.current.set(participant.id, participant.name);
                ensurePeerConnection(participant.id, participant.name);
                createAndSendOffer(participant.id);
            }
        );

        socket.on(
            "offer",
            async ({ fromId, sdp }: { roomId: string; fromId: string; sdp: RTCSessionDescriptionInit }) => {
                const peerConnection = ensurePeerConnection(fromId, peerNamesRef.current.get(fromId));
                if (!peerConnection) {
                    return;
                }

                try {
                    if (peerConnection.signalingState !== "stable") {
                        await peerConnection.setLocalDescription({ type: "rollback" });
                    }

                    await peerConnection.setRemoteDescription(sdp);
                    const answer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answer);

                    socket.emit("answer", {
                        roomId: currentRoomIdRef.current,
                        targetId: fromId,
                        sdp: peerConnection.localDescription
                    });
                } catch (error) {
                    console.error("Failed to handle offer", error);
                }
            }
        );

        socket.on(
            "answer",
            async ({ fromId, sdp }: { roomId: string; fromId: string; sdp: RTCSessionDescriptionInit }) => {
                const peerConnection = peersRef.current.get(fromId);
                if (!peerConnection) {
                    return;
                }
                try {
                    await peerConnection.setRemoteDescription(sdp);
                } catch (error) {
                    console.error("Failed to handle answer", error);
                }
            }
        );

        socket.on(
            "ice-candidate",
            async ({ fromId, candidate }: { roomId: string; fromId: string; candidate: RTCIceCandidateInit }) => {
                const peerConnection = ensurePeerConnection(fromId, peerNamesRef.current.get(fromId));
                if (!peerConnection || !candidate) {
                    return;
                }

                try {
                    await peerConnection.addIceCandidate(candidate);
                } catch (error) {
                    console.error("Failed to add ICE candidate", error);
                }
            }
        );

        socket.on(
            "screen-share-status",
            ({ senderId, isSharing, trackId }: { roomId: string; senderId: string; isSharing: boolean; trackId: string | null }) => {
                screenStatusRef.current.set(senderId, { isSharing, trackId });
                const participant = participantStateRef.current.get(senderId);
                if (!participant) {
                    return;
                }
                participant.isSharingScreen = isSharing;
                participant.screenTrackId = trackId;
                participantStateRef.current.set(senderId, participant);
                updateDisplayedStream(senderId);
                syncParticipants();
            }
        );

        socket.on(
            "playback-toggle",
            ({ paused }: { roomId: string; senderId: string; paused: boolean }) => {
                setPlaybackState(paused, false);
            }
        );

        socket.on("participant-left", ({ participantId }: { roomId: string; participantId: string }) => {
            const peerConnection = peersRef.current.get(participantId);
            if (peerConnection) {
                peerConnection.close();
            }
            peersRef.current.delete(participantId);
            screenVideoSendersRef.current.delete(participantId);
            screenAudioSendersRef.current.delete(participantId);
            peerNamesRef.current.delete(participantId);
            removeParticipant(participantId);
        });

        socket.on("room-join-error", ({ message }: { message: string }) => {
            alert(message);
            setLobby(true);
        });

        return () => {
            stopScreenShare();
            peersRef.current.forEach((peerConnection) => peerConnection.close());
            peersRef.current.clear();
            participantStateRef.current.clear();
            screenStatusRef.current.clear();
            socket.disconnect();
            socketRef.current = null;
        };
    }, [createAndSendOffer, demoRoomId, ensurePeerConnection, name, removeParticipant, stopScreenShare, syncParticipants, updateDisplayedStream]);

    const mainParticipant = useMemo(() => {
        if (participants.length === 0) {
            return null;
        }
        const sharing = participants.find((participant) => participant.isSharingScreen);
        return sharing || participants[0];
    }, [participants]);

    const sideParticipants = useMemo(() => {
        if (!mainParticipant) {
            return [];
        }
        return participants.filter((participant) => participant.id !== mainParticipant.id);
    }, [mainParticipant, participants]);

    return (
        <div
            ref={containerRef}
            style={{
                minHeight: isFullscreen ? "100vh" : "100vh",
                backgroundColor: isFullscreen ? "#000" : "var(--bg-main)",
                padding: "1.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "1rem"
            }}
        >
            <div style={{ textAlign: "center" }}>
                <h2 style={{ fontSize: "1.4rem", fontWeight: 700 }}>Hi, {name}</h2>
                {lobby && !currentRoomId && <p style={{ color: "var(--text-muted)" }}>Generating room...</p>}
                {lobby && currentRoomId && <p style={{ color: "var(--text-muted)" }}>Waiting for others to join... Room ID: {currentRoomId}</p>}
                {!lobby && currentRoomId && <p style={{ color: "var(--text-muted)" }}>Room ID: {currentRoomId}</p>}
            </div>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) 280px",
                    gap: "1rem",
                    minHeight: "70vh"
                }}
            >
                <div style={{ minHeight: "100%", height: "100%" }}>
                    {isScreenSharing ? (
                        <ParticipantVideo stream={screenPreviewStream} label="You (Sharing)" muted={true} prioritized paused={isPlaybackPaused} />
                    ) : (
                        <ParticipantVideo
                            stream={mainParticipant?.displayStream || null}
                            label={mainParticipant ? `${mainParticipant.name}${mainParticipant.isSharingScreen ? " (Sharing)" : ""}` : "Waiting for participants"}
                            muted={false}
                            prioritized={mainParticipant?.isSharingScreen}
                            paused={isPlaybackPaused}
                        />
                    )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <div style={{ height: "180px" }}>
                        <div
                            className="video-container"
                            style={{
                                borderRadius: "0.75rem",
                                border: isScreenSharing ? "2px solid var(--success)" : "1px solid var(--border)",
                                height: "100%"
                            }}
                        >
                            <video
                                ref={localPreviewRef}
                                autoPlay
                                muted
                                playsInline
                                style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
                            />
                            <div className="badge">You</div>
                        </div>
                    </div>

                    {sideParticipants.map((participant) => (
                        <div key={participant.id} style={{ height: "180px" }}>
                            <ParticipantVideo
                                stream={participant.displayStream}
                                label={`${participant.name}${participant.isSharingScreen ? " (Sharing)" : ""}`}
                                muted={false}
                                prioritized={participant.isSharingScreen}
                                paused={isPlaybackPaused}
                            />
                        </div>
                    ))}

                    <button className="btn btn-secondary" onClick={togglePlayback} disabled={lobby}>
                        {isPlaybackPaused ? "Play" : "Pause"}
                    </button>
                    <button className={isScreenSharing ? "btn btn-danger" : "btn btn-primary"} onClick={toggleScreenShare} disabled={lobby}>
                        {isScreenSharing ? "Stop Sharing" : "Share Screen"}
                    </button>
                    <button className="btn btn-secondary" onClick={toggleFullscreen} disabled={lobby}>
                        {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                    </button>
                </div>
            </div>
        </div>
    );
};
