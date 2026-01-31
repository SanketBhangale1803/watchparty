import { useEffect, useRef, useState } from "react";
import { Socket, io } from "socket.io-client";

const URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

export const Room = ({
    name,
    localAudioTrack,
    localVideoTrack,
    demoRoomId
}: {
    name: string,
    localAudioTrack: MediaStreamTrack | null,
    localVideoTrack: MediaStreamTrack | null,
    demoRoomId?: string,
}) => {
    const [lobby, setLobby] = useState(true);
    const [socket, setSocket] = useState<null | Socket>(null);
    const [sendingPc, setSendingPc] = useState<null | RTCPeerConnection>(null);
    const [, setReceivingPc] = useState<null | RTCPeerConnection>(null);
    const [remoteVideoTrack, setRemoteVideoTrack] = useState<MediaStreamTrack | null>(null);
    const [remoteAudioTrack, setRemoteAudioTrack] = useState<MediaStreamTrack | null>(null);
    const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);
    const [remoteCameraTrack, setRemoteCameraTrack] = useState<MediaStreamTrack | null>(null);
    const [, setRemoteScreenTrack] = useState<MediaStreamTrack | null>(null);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [screenTrack, setScreenTrack] = useState<MediaStreamTrack | null>(null);
    const [screenAudioTrack, setScreenAudioTrack] = useState<MediaStreamTrack | null>(null);
    const [remoteIsScreenSharing, setRemoteIsScreenSharing] = useState(false);
    const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
    const [mixedAudioTrack, setMixedAudioTrack] = useState<MediaStreamTrack | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const screenShareRef = useRef<HTMLVideoElement>(null);
    const sidebarRemoteVideoRef = useRef<HTMLVideoElement>(null);
    const sidebarRemoteCameraRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const remoteAudioRef = useRef<HTMLAudioElement>(null);

    // Keep persistent refs for peer connections (needed for renegotiation)
    const sendingPcRef = useRef<RTCPeerConnection | null>(null);
    const receivingPcRef = useRef<RTCPeerConnection | null>(null);
    const remoteCameraTrackRef = useRef<MediaStreamTrack | null>(null);

    const toggleFullscreen = async () => {
        if (!containerRef.current) return;

        try {
            if (!document.fullscreenElement) {
                await containerRef.current.requestFullscreen();
                setIsFullscreen(true);
            } else {
                await document.exitFullscreen();
                setIsFullscreen(false);
            }
        } catch (error) {
            console.error("Error toggling fullscreen:", error);
        }
    };

    // Listen for fullscreen changes (e.g., user presses Escape)
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    // Update local video stream (always show camera)
    useEffect(() => {
        if (localVideoRef.current && localVideoTrack) {
            localVideoRef.current.srcObject = new MediaStream([localVideoTrack]);
            localVideoRef.current.play().catch(console.error);
        }
    }, [localVideoTrack, isFullscreen]);

    // Update screen share preview (for the person sharing)
    useEffect(() => {
        if (screenShareRef.current && screenTrack) {
            screenShareRef.current.srcObject = new MediaStream([screenTrack]);
            screenShareRef.current.play().catch(console.error);
        }
    }, [screenTrack, isFullscreen]);

    // Update remote video when track changes
    useEffect(() => {
        if (remoteVideoRef.current && remoteMediaStream) {
            remoteVideoRef.current.srcObject = remoteMediaStream;
            remoteVideoRef.current.play().catch(console.error);
        }
    }, [remoteMediaStream, remoteVideoTrack, remoteAudioTrack, isFullscreen, remoteIsScreenSharing]);

    // Update sidebar remote video (for both host sharing and guest viewing)
    useEffect(() => {
        if (sidebarRemoteVideoRef.current && remoteMediaStream && isScreenSharing && isFullscreen) {
            sidebarRemoteVideoRef.current.srcObject = remoteMediaStream;
            sidebarRemoteVideoRef.current.play().catch(console.error);
        }
    }, [remoteMediaStream, isScreenSharing, isFullscreen]);

    // Update sidebar with remote camera when viewing their screen share
    useEffect(() => {
        if (sidebarRemoteCameraRef.current && remoteCameraTrack && remoteIsScreenSharing && isFullscreen) {
            sidebarRemoteCameraRef.current.srcObject = new MediaStream([remoteCameraTrack]);
            sidebarRemoteCameraRef.current.play().catch(console.error);
        }
    }, [remoteCameraTrack, remoteIsScreenSharing, isFullscreen]);

    // Dedicated audio handling
    useEffect(() => {
        if (remoteAudioRef.current && remoteAudioTrack) {
            remoteAudioRef.current.srcObject = new MediaStream([remoteAudioTrack]);
            remoteAudioRef.current.play().catch(console.error);
        }
    }, [remoteAudioTrack]);

    useEffect(() => {
        const socket = io(URL);

        socket.on('connect', () => {
            console.log("connected to socket");
            if (demoRoomId) {
                console.log("joining room " + demoRoomId);
                socket.emit("join-room", { roomId: demoRoomId, name });
            } else {
                console.log("creating room");
                socket.emit("create-room", { name });
            }
        });

        socket.on("room-created", ({ roomId }) => {
            console.log("Current room id is " + roomId);
            setCurrentRoomId(roomId);
        });

        socket.on("room-join-error", ({ message }) => {
            alert(message);
            // Ideally handle error state to redirect back to landing
            setLobby(true);
        });

        socket.on('send-offer', async ({ roomId }) => {
            console.log("sending offer");
            setLobby(false);
            setCurrentRoomId(roomId);
            const pc = new RTCPeerConnection();

            setSendingPc(pc);
            sendingPcRef.current = pc;

            if (localVideoTrack) {
                console.error("added tack");
                console.log(localVideoTrack)
                pc.addTrack(localVideoTrack)
            }
            if (localAudioTrack) {
                console.error("added tack");
                console.log(localAudioTrack)
                pc.addTrack(localAudioTrack)
            }

            pc.onicecandidate = async (e) => {
                console.log("receiving ice candidate locally");
                if (e.candidate) {
                    socket.emit("add-ice-candidate", {
                        candidate: e.candidate,
                        type: "sender",
                        roomId
                    })
                }
            }

            pc.onnegotiationneeded = async () => {
                console.log("on negotiation neeeded, sending offer");
                const sdp = await pc.createOffer();
                //@ts-ignore
                pc.setLocalDescription(sdp)
                socket.emit("offer", {
                    sdp,
                    roomId
                })
            }

            pc.ontrack = (event) => {
                const track = event.track;
                console.log("ontrack received:", track.kind, track.id);

                // Initialize remote media stream if not exists
                // Note: We might want to use a state setter or ref to ensure we don't recreate it unnecessarily
                // But for now, we rely on the stream construction logic in the handler
                let stream = remoteVideoRef.current?.srcObject as MediaStream;
                if (!stream) {
                    stream = new MediaStream();
                    setRemoteMediaStream(stream);
                }

                if (track.kind === 'video') {
                    const existingVideoTracks = stream.getVideoTracks();

                    if (existingVideoTracks.length === 0) {
                        // First video track - this is the camera
                        console.log("First video track (camera):", track.id);
                        setRemoteCameraTrack(track);
                        remoteCameraTrackRef.current = track;
                        setRemoteVideoTrack(track);
                        stream.addTrack(track);
                    } else {
                        // Second video track - this is the screen share
                        console.log("Second video track (screen):", track.id);
                        setRemoteScreenTrack(track);
                        // Replace main view with screen share, keep camera in sidebar
                        existingVideoTracks.forEach(t => stream.removeTrack(t));
                        stream.addTrack(track);
                        setRemoteVideoTrack(track);
                    }

                    // Listen for track ending (when host stops sharing)
                    track.onended = () => {
                        console.log("Track ended:", track.kind, track.id);
                        if (track.kind === 'video') {
                            // If screen share track ended, switch back to camera
                            stream.removeTrack(track);
                            const cameraTrack = remoteCameraTrackRef.current;
                            if (cameraTrack) {
                                console.log("Switching back to camera:", cameraTrack.id);
                                stream.addTrack(cameraTrack);
                                setRemoteVideoTrack(cameraTrack);
                                setRemoteScreenTrack(null);
                            }
                        }
                    };
                } else if (track.kind === 'audio') {
                    setRemoteAudioTrack(track);
                    stream.addTrack(track);
                }

                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = stream;
                    remoteVideoRef.current.play().catch(console.error);
                }
            };

        });

        socket.on("offer", async ({ roomId, sdp: remoteSdp }) => {
            console.log("received offer");
            setLobby(false);
            setCurrentRoomId(roomId);

            // Reuse existing receiving PC if present (renegotiation), else create new one
            let pc = receivingPcRef.current;
            if (!pc) {
                pc = new RTCPeerConnection();
                receivingPcRef.current = pc;
                setReceivingPc(pc);

                if (localVideoTrack) {
                    pc.addTrack(localVideoTrack);
                }
                if (localAudioTrack) {
                    pc.addTrack(localAudioTrack);
                }

                const stream = new MediaStream();
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = stream;
                }
                setRemoteMediaStream(stream);

                // Handle incoming tracks - camera, audio, and screen share
                pc.ontrack = (event) => {
                    const track = event.track;
                    console.log("ontrack received:", track.kind, track.id);

                    if (track.kind === 'video') {
                        const existingVideoTracks = stream.getVideoTracks();

                        if (existingVideoTracks.length === 0) {
                            // First video track - this is the camera
                            console.log("First video track (camera):", track.id);
                            setRemoteCameraTrack(track);
                            remoteCameraTrackRef.current = track;
                            setRemoteVideoTrack(track);
                            stream.addTrack(track);
                        } else {
                            // Second video track - this is the screen share
                            console.log("Second video track (screen):", track.id);
                            setRemoteScreenTrack(track);
                            // Replace main view with screen share, keep camera in sidebar
                            existingVideoTracks.forEach(t => stream.removeTrack(t));
                            stream.addTrack(track);
                            setRemoteVideoTrack(track);
                        }

                        // Listen for track ending (when host stops sharing)
                        track.onended = () => {
                            console.log("Track ended:", track.kind, track.id);
                            if (track.kind === 'video') {
                                // If screen share track ended, switch back to camera
                                stream.removeTrack(track);
                                const cameraTrack = remoteCameraTrackRef.current;
                                if (cameraTrack) {
                                    console.log("Switching back to camera:", cameraTrack.id);
                                    stream.addTrack(cameraTrack);
                                    setRemoteVideoTrack(cameraTrack);
                                    setRemoteScreenTrack(null);
                                }
                            }
                        };
                    } else if (track.kind === 'audio') {
                        setRemoteAudioTrack(track);
                        stream.addTrack(track);
                    }

                    if (remoteVideoRef.current) {
                        remoteVideoRef.current.srcObject = stream;
                        remoteVideoRef.current.play().catch(console.error);
                    }
                };

                pc.onicecandidate = async (e) => {
                    if (!e.candidate) return;
                    console.log("on ice candidate on receiving side");
                    socket.emit("add-ice-candidate", {
                        candidate: e.candidate,
                        type: "receiver",
                        roomId
                    });
                };

                //@ts-ignore
                window.pcr = pc;
            }

            await pc.setRemoteDescription(remoteSdp);
            const sdp = await pc.createAnswer();
            //@ts-ignore
            await pc.setLocalDescription(sdp);

            socket.emit("answer", { roomId, sdp });
        });

        socket.on("answer", ({ sdp: remoteSdp }) => {
            setLobby(false);
            setSendingPc(pc => {
                pc?.setRemoteDescription(remoteSdp)
                return pc;
            });
            console.log("loop closed");
        })

        socket.on("lobby", () => {
            setLobby(true);
        })

        socket.on("add-ice-candidate", ({ candidate, type }) => {
            console.log("add ice candidate from remote");
            console.log({ candidate, type })
            if (type == "sender") {
                setReceivingPc(pc => {
                    if (!pc) {
                        console.error("receicng pc nout found")
                    } else {
                        console.error(pc.ontrack)
                    }
                    pc?.addIceCandidate(candidate)
                    return pc;
                });
            } else {
                setSendingPc(pc => {
                    if (!pc) {
                        console.error("sending pc nout found")
                    } else {
                        // console.error(pc.ontrack)
                    }
                    pc?.addIceCandidate(candidate)
                    return pc;
                });
            }
        })

        // Listen for remote screen share status
        socket.on("screen-share-status", ({ isSharing }) => {
            console.log("Remote screen share status changed:", isSharing);
            setRemoteIsScreenSharing(isSharing);

            // When remote stops sharing, switch back to camera in main view
            if (!isSharing) {
                setTimeout(() => {
                    const stream = remoteVideoRef.current?.srcObject as MediaStream;
                    const cameraTrack = remoteCameraTrackRef.current;

                    if (stream && cameraTrack) {
                        console.log("Switching back to camera after remote stopped sharing");
                        const videoTracks = stream.getVideoTracks();
                        console.log("Current video tracks:", videoTracks.length);

                        // Remove all video tracks
                        videoTracks.forEach(t => {
                            console.log("Removing track:", t.id);
                            stream.removeTrack(t);
                        });

                        // Add camera track back
                        console.log("Adding camera track back:", cameraTrack.id);
                        stream.addTrack(cameraTrack);
                        setRemoteVideoTrack(cameraTrack);

                        // Force video element to refresh
                        if (remoteVideoRef.current) {
                            remoteVideoRef.current.srcObject = stream;
                            remoteVideoRef.current.play().catch(console.error);
                        }
                    } else {
                        console.log("Stream or camera track not found", { stream: !!stream, cameraTrack: !!cameraTrack });
                    }
                }, 500);
            }
        })

        setSocket(socket)
    }, [name])

    const startScreenShare = async () => {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

            const screenVideoTrack = screenStream.getVideoTracks()[0];
            const screenAudio = screenStream.getAudioTracks()[0];

            setScreenTrack(screenVideoTrack);

            if (sendingPc) {
                // Add screen share as a NEW track (don't replace camera)
                // This triggers renegotiation and sends both camera and screen
                sendingPc.addTrack(screenVideoTrack, screenStream);

                // If screen has audio, replace the audio track so guest can hear tab audio
                if (screenAudio) {
                    setScreenAudioTrack(screenAudio);
                    const audioSender = sendingPc.getSenders().find(
                        sender => sender.track?.kind === 'audio'
                    );
                    if (audioSender) {
                        await audioSender.replaceTrack(screenAudio);
                    }
                }

                // Mix microphone and screen audio
                if (localAudioTrack && screenAudio) {
                    const audioContext = new AudioContext();
                    audioContextRef.current = audioContext;

                    const destination = audioContext.createMediaStreamDestination();
                    const localAudioSource = audioContext.createMediaStreamSource(new MediaStream([localAudioTrack]));
                    const screenAudioSource = audioContext.createMediaStreamSource(new MediaStream([screenAudio]));

                    // Create gain nodes to boost microphone volume
                    const micGain = audioContext.createGain();
                    const screenGain = audioContext.createGain();

                    // Boost microphone volume (3x louder)
                    micGain.gain.value = 3.0;
                    // Keep screen audio at normal level
                    screenGain.gain.value = 1.0;

                    localAudioSource.connect(micGain);
                    micGain.connect(destination);

                    screenAudioSource.connect(screenGain);
                    screenGain.connect(destination);

                    const mixedTrack = destination.stream.getAudioTracks()[0];
                    setMixedAudioTrack(mixedTrack);

                    const audioSender = sendingPc.getSenders().find(
                        sender => sender.track?.kind === 'audio'
                    );
                    if (audioSender) {
                        await audioSender.replaceTrack(mixedTrack);
                    }
                }
            }

            setIsScreenSharing(true);

            if (socket && currentRoomId) {
                socket.emit("screen-share-status", { isSharing: true, roomId: currentRoomId });
            }

            screenVideoTrack.onended = () => {
                stopScreenShare();
            };
        } catch (error) {
            console.error("Error starting screen share:", error);
        }
    };

    const stopScreenShare = async () => {
        if (sendingPc && screenTrack) {
            // Remove the screen share track
            const screenSender = sendingPc.getSenders().find(
                sender => sender.track === screenTrack
            );
            if (screenSender) {
                sendingPc.removeTrack(screenSender);
            }
        }

        if (screenTrack) {
            screenTrack.stop();
        }
        if (screenAudioTrack) {
            screenAudioTrack.stop();
        }
        if (mixedAudioTrack) {
            mixedAudioTrack.stop();
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        if (sendingPc) {
            // Replace back with mic audio track
            if (localAudioTrack) {
                const audioSender = sendingPc.getSenders().find(
                    sender => sender.track?.kind === 'audio'
                );
                if (audioSender) {
                    await audioSender.replaceTrack(localAudioTrack);
                }
            }
        }

        setScreenTrack(null);
        setScreenAudioTrack(null);
        setMixedAudioTrack(null);
        setIsScreenSharing(false);

        if (socket && currentRoomId) {
            socket.emit("screen-share-status", { isSharing: false, roomId: currentRoomId });
        }
    };

    const toggleScreenShare = () => {
        if (isScreenSharing) {
            stopScreenShare();
        } else {
            startScreenShare();
        }
    };

    return (
        <div
            ref={containerRef}
            className={isFullscreen ? "fullscreen-container" : ""}
            style={{
                backgroundColor: isFullscreen ? '#000' : 'var(--bg-main)',
                width: isFullscreen ? '100vw' : '100%',
                height: isFullscreen ? '100vh' : '100vh',
                position: isFullscreen ? 'fixed' : 'relative',
                top: 0,
                left: 0,
                display: 'flex',
                flexDirection: isFullscreen ? 'row' : 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: isFullscreen ? 9999 : 1
            }}
        >
            {!isFullscreen && (
                <div style={{ marginBottom: "1rem", textAlign: "center" }}>
                    <h2 style={{ fontSize: "1.5rem", fontWeight: "600" }}>Hi, {name}</h2>
                    {lobby && !currentRoomId && <p style={{ color: "var(--text-muted)" }}>Generating room...</p>}
                    {lobby && currentRoomId && (
                        <div>
                            <p style={{ color: "var(--text-muted)", marginBottom: "10px" }}>Waiting for someone to join...</p>
                            <div style={{
                                background: "#f1f5f9",
                                padding: "10px 20px",
                                borderRadius: "8px",
                                display: "inline-block",
                                border: "1px solid #e2e8f0"
                            }}>
                                <span style={{ fontWeight: "600", marginRight: "10px" }}>Room ID:</span>
                                <span style={{ fontFamily: "monospace", fontSize: "1.2rem" }}>{currentRoomId}</span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Main video container */}
            <div style={{
                position: 'relative',
                display: 'flex',
                width: isFullscreen ? '100%' : 'auto',
                height: isFullscreen ? '100%' : 'auto',
                gap: isFullscreen ? '0' : '20px',
                alignItems: !isFullscreen ? 'flex-start' : 'stretch'
            }}>
                {/* Main view */}
                <div className={!isFullscreen ? "video-container" : ""} style={{
                    position: 'relative',
                    width: isFullscreen ? 'calc(100% - 240px)' : '800px',
                    height: isFullscreen ? '100%' : '500px',
                    borderRadius: isFullscreen ? '0' : '1rem',
                    overflow: 'hidden',
                    backgroundColor: '#000',
                    boxShadow: isFullscreen ? 'none' : 'var(--shadow-lg)'
                }}>
                    {isScreenSharing ? (
                        <video
                            autoPlay
                            playsInline
                            muted
                            ref={screenShareRef}
                            onDoubleClick={toggleFullscreen}
                            style={{
                                width: '100%',
                                height: '100%',
                                cursor: 'pointer',
                                objectFit: isFullscreen ? 'contain' : 'cover'
                            }}
                        />
                    ) : (
                        <video
                            autoPlay
                            playsInline
                            muted
                            ref={remoteVideoRef}
                            onDoubleClick={toggleFullscreen}
                            style={{
                                width: '100%',
                                height: '100%',
                                cursor: 'pointer',
                                objectFit: isFullscreen ? 'contain' : 'cover'
                            }}
                        />
                    )}

                    {!lobby && !isFullscreen && (
                        <button
                            className="btn"
                            onClick={toggleFullscreen}
                            style={{
                                position: 'absolute',
                                bottom: '1rem',
                                right: '1rem',
                                background: 'rgba(0, 0, 0, 0.6)',
                                color: 'white',
                                padding: '0.5rem',
                                borderRadius: '0.5rem',
                                backdropFilter: 'blur(4px)'
                            }}
                            title="Enter Fullscreen"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
                        </button>
                    )}
                </div>

                {/* Side panel */}
                <div style={{
                    width: isFullscreen ? '240px' : '300px',
                    height: isFullscreen ? '100%' : '500px',
                    backgroundColor: isFullscreen ? '#111' : 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: isFullscreen ? '1rem' : '0',
                    borderLeft: isFullscreen ? '1px solid #333' : 'none',
                    gap: '1rem',
                    overflowY: 'auto'
                }}>
                    {/* Local video (your camera) - always visible in fullscreen */}
                    {(isFullscreen || !isFullscreen) && (
                        <div className={!isFullscreen ? "video-container" : ""} style={{
                            position: 'relative',
                            borderRadius: '0.75rem',
                            overflow: 'hidden',
                            border: isFullscreen ? (isScreenSharing ? '2px solid var(--success)' : '1px solid #333') : 'none',
                            height: isFullscreen ? '150px' : '200px',
                            flexShrink: 0
                        }}>
                            <video
                                autoPlay
                                muted
                                playsInline
                                ref={localVideoRef}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    backgroundColor: '#000',
                                    display: 'block'
                                }}
                            />
                            <div className="badge">
                                You {isScreenSharing && '(Sharing)'}
                            </div>
                        </div>
                    )}

                    {/* Remote video in sidebar */}
                    {isFullscreen && isScreenSharing && (
                        <div style={{
                            position: 'relative',
                            borderRadius: '0.75rem',
                            overflow: 'hidden',
                            border: '1px solid #333',
                            height: '150px',
                            flexShrink: 0
                        }}>
                            <video
                                autoPlay
                                playsInline
                                muted
                                ref={sidebarRemoteVideoRef}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    backgroundColor: '#000',
                                    display: 'block'
                                }}
                            />
                            <div style={{
                                position: 'absolute',
                                bottom: '0.5rem',
                                left: '0.5rem',
                                background: 'rgba(0,0,0,0.6)',
                                color: 'white',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '0.25rem',
                                fontSize: '0.75rem'
                            }}>
                                Guest
                            </div>
                        </div>
                    )}

                    {isFullscreen && remoteIsScreenSharing && !isScreenSharing && (
                        <div style={{
                            position: 'relative',
                            borderRadius: '0.75rem',
                            overflow: 'hidden',
                            border: '2px solid var(--success)',
                            height: '150px',
                            flexShrink: 0
                        }}>
                            <video
                                autoPlay
                                playsInline
                                ref={sidebarRemoteCameraRef}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    backgroundColor: '#000',
                                    display: 'block'
                                }}
                            />
                            <div style={{
                                position: 'absolute',
                                bottom: '0.5rem',
                                left: '0.5rem',
                                background: 'rgba(0,0,0,0.6)',
                                color: 'white',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '0.25rem',
                                fontSize: '0.75rem'
                            }}>
                                Host (Sharing)
                            </div>
                        </div>
                    )}

                    {/* Controls in sidebar (fullscreen mode) */}
                    {isFullscreen && (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.75rem',
                            marginTop: 'auto'
                        }}>
                            <button
                                className={isScreenSharing ? "btn btn-danger" : "btn btn-primary"}
                                onClick={toggleScreenShare}
                                style={{ width: '100%' }}
                            >
                                {isScreenSharing ? 'Stop Share' : 'Share Screen'}
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={toggleFullscreen}
                                style={{ width: '100%', background: '#333', color: 'white', border: '1px solid #444' }}
                            >
                                Exit Fullscreen
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Controls bar (non-fullscreen mode) */}
            {!lobby && !isFullscreen && (
                <div style={{
                    marginTop: '1.5rem',
                    display: 'flex',
                    gap: '1rem'
                }}>
                    <button
                        className={isScreenSharing ? "btn btn-danger" : "btn btn-primary"}
                        onClick={toggleScreenShare}
                        style={{ minWidth: '150px' }}
                    >
                        {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
                    </button>
                    {/* Fullscreen button is also available on the video hover, but keeping this for accessibility */}
                </div>
            )}
            <audio ref={remoteAudioRef} autoPlay />
        </div>
    );
}