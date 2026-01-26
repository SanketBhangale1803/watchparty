import { useEffect, useRef, useState } from "react";
import { Socket, io } from "socket.io-client";

const URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

export const Room = ({
    name,
    localAudioTrack,
    localVideoTrack
}: {
    name: string,
    localAudioTrack: MediaStreamTrack | null,
    localVideoTrack: MediaStreamTrack | null,
}) => {
    const [lobby, setLobby] = useState(true);
    const [socket, setSocket] = useState<null | Socket>(null);
    const [sendingPc, setSendingPc] = useState<null | RTCPeerConnection>(null);
    const [, setReceivingPc] = useState<null | RTCPeerConnection>(null);
    const [remoteVideoTrack, setRemoteVideoTrack] = useState<MediaStreamTrack | null>(null);
    const [remoteAudioTrack, setRemoteAudioTrack] = useState<MediaStreamTrack | null>(null);
    const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [screenTrack, setScreenTrack] = useState<MediaStreamTrack | null>(null);
    const [screenAudioTrack, setScreenAudioTrack] = useState<MediaStreamTrack | null>(null);
    const [remoteIsScreenSharing, setRemoteIsScreenSharing] = useState(false);
    const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const screenShareRef = useRef<HTMLVideoElement>(null);
    const screenAudioRef = useRef<HTMLAudioElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

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

    // Update local video stream (always show camera, not screen share)
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

    // Play screen audio separately (so both mic and screen audio can be heard)
    useEffect(() => {
        if (screenAudioRef.current && screenAudioTrack) {
            screenAudioRef.current.srcObject = new MediaStream([screenAudioTrack]);
            screenAudioRef.current.play().catch(console.error);
        }
    }, [screenAudioTrack]);

    // Update remote video when track changes or screen sharing status changes
    useEffect(() => {
        if (remoteVideoRef.current && remoteMediaStream) {
            remoteVideoRef.current.srcObject = remoteMediaStream;
            remoteVideoRef.current.play().catch(console.error);
        }
    }, [remoteMediaStream, remoteVideoTrack, remoteAudioTrack, isFullscreen, remoteIsScreenSharing]);

    useEffect(() => {
        const socket = io(URL);
        socket.on('send-offer', async ({roomId}) => {
            console.log("sending offer");
            setLobby(false);
            setCurrentRoomId(roomId);
            const pc = new RTCPeerConnection();

            setSendingPc(pc);
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
        });

        socket.on("offer", async ({roomId, sdp: remoteSdp}) => {
            console.log("received offer");
            setLobby(false);
            setCurrentRoomId(roomId);
            const pc = new RTCPeerConnection();
            pc.setRemoteDescription(remoteSdp)
            const sdp = await pc.createAnswer();
            //@ts-ignore
            pc.setLocalDescription(sdp)
            const stream = new MediaStream();
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = stream;
            }

            setRemoteMediaStream(stream);
            // trickle ice 
            setReceivingPc(pc);
            //@ts-ignore
            window.pcr = pc;
            pc.ontrack = () => {
                alert("ontrack");
            }

            pc.onicecandidate = async (e) => {
                if (!e.candidate) {
                    return;
                }
                console.log("omn ice candidate on receiving seide");
                if (e.candidate) {
                   socket.emit("add-ice-candidate", {
                    candidate: e.candidate,
                    type: "receiver",
                    roomId
                   })
                }
            }

            socket.emit("answer", {
                roomId,
                sdp: sdp
            });
            setTimeout(() => {
                const track1 = pc.getTransceivers()[0].receiver.track
                const track2 = pc.getTransceivers()[1].receiver.track
                console.log(track1);
                if (track1.kind === "video") {
                    setRemoteAudioTrack(track2)
                    setRemoteVideoTrack(track1)
                } else {
                    setRemoteAudioTrack(track1)
                    setRemoteVideoTrack(track2)
                }
                //@ts-ignore
                remoteVideoRef.current.srcObject.addTrack(track1)
                //@ts-ignore
                remoteVideoRef.current.srcObject.addTrack(track2)
                //@ts-ignore
                remoteVideoRef.current.play();
            }, 5000)
        });

        socket.on("answer", ({sdp: remoteSdp}) => {
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

        socket.on("add-ice-candidate", ({candidate, type}) => {
            console.log("add ice candidate from remote");
            console.log({candidate, type})
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
        socket.on("screen-share-status", ({isSharing}) => {
            setRemoteIsScreenSharing(isSharing);
        })

        setSocket(socket)
    }, [name])

    const startScreenShare = async () => {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true  // Get screen audio if available
            });
            
            const screenVideoTrack = screenStream.getVideoTracks()[0];
            const screenAudio = screenStream.getAudioTracks()[0];
            
            setScreenTrack(screenVideoTrack);
            if (screenAudio) {
                setScreenAudioTrack(screenAudio);
            }
            
            // Replace ONLY the video track - keep mic audio intact
            if (sendingPc) {
                const videoSender = sendingPc.getSenders().find(
                    sender => sender.track?.kind === 'video'
                );
                if (videoSender) {
                    await videoSender.replaceTrack(screenVideoTrack);
                }
                
                // Note: Adding screen audio would require renegotiation
                // For simplicity, we only share video. Mic audio continues working.
            }
            
            setIsScreenSharing(true);
            
            // Notify the other user that screen sharing started
            if (socket && currentRoomId) {
                socket.emit("screen-share-status", { isSharing: true, roomId: currentRoomId });
            }
            
            // Handle when user stops screen share via browser UI
            screenVideoTrack.onended = () => {
                stopScreenShare();
            };
        } catch (error) {
            console.error("Error starting screen share:", error);
        }
    };

    const stopScreenShare = async () => {
        // Stop screen tracks
        if (screenTrack) {
            screenTrack.stop();
        }
        if (screenAudioTrack) {
            screenAudioTrack.stop();
        }
        
        // Clear screen audio
        if (screenAudioRef.current) {
            screenAudioRef.current.srcObject = null;
        }

        // Replace back with camera video track
        if (sendingPc && localVideoTrack) {
            const videoSender = sendingPc.getSenders().find(
                sender => sender.track?.kind === 'video'
            );
            if (videoSender) {
                await videoSender.replaceTrack(localVideoTrack);
            }
        }
        
        setScreenTrack(null);
        setScreenAudioTrack(null);
        setIsScreenSharing(false);
        
        // Notify the other user that screen sharing stopped
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
            style={{
                backgroundColor: isFullscreen ? '#000' : 'transparent',
                width: isFullscreen ? '100vw' : 'auto',
                height: isFullscreen ? '100vh' : 'auto',
                position: 'relative',
                display: 'flex',
                flexDirection: isFullscreen ? 'row' : 'column',
                alignItems: 'center',
                justifyContent: 'center'
            }}
        >
            {/* Hidden audio element for screen share audio */}
            <audio ref={screenAudioRef} autoPlay style={{ display: 'none' }} />

            {!isFullscreen && <div>Hi {name}</div>}
            {lobby ? <div>Waiting to connect you to someone</div> : null}
            
            {/* Main video container */}
            <div style={{ 
                position: 'relative', 
                display: 'flex',
                width: isFullscreen ? '100%' : 'auto',
                height: isFullscreen ? '100%' : 'auto',
            }}>
                {/* Main view - shows screen share when active, otherwise remote video */}
                {isScreenSharing ? (
                    // Show my screen share as main view (for the sharer)
                    <video 
                        autoPlay 
                        playsInline
                        ref={screenShareRef}
                        onDoubleClick={toggleFullscreen}
                        style={{ 
                            width: isFullscreen ? 'calc(100% - 220px)' : 400,
                            height: isFullscreen ? '100%' : 400,
                            cursor: 'pointer',
                            objectFit: isFullscreen ? 'contain' : 'cover',
                            backgroundColor: '#000'
                        }}
                    />
                ) : (
                    // Show remote video as main view (could be their camera or their screen share)
                    <video 
                        autoPlay 
                        playsInline
                        ref={remoteVideoRef}
                        onDoubleClick={toggleFullscreen}
                        style={{ 
                            width: isFullscreen ? 'calc(100% - 220px)' : 400,
                            height: isFullscreen ? '100%' : 400,
                            cursor: 'pointer',
                            objectFit: isFullscreen ? 'contain' : 'cover',
                            backgroundColor: '#000'
                        }}
                    />
                )}
                
                {/* Side panel - contains BOTH local and remote videos */}
                <div style={{
                    width: isFullscreen ? '220px' : 'auto',
                    height: isFullscreen ? '100%' : 'auto',
                    backgroundColor: isFullscreen ? '#1a1a1a' : 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: isFullscreen ? '10px' : '0',
                    marginLeft: isFullscreen ? '0' : '10px',
                    boxSizing: 'border-box',
                    gap: '10px',
                    overflowY: 'auto'
                }}>
                    {/* Local video (your camera) - always visible */}
                    <div style={{
                        position: 'relative',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        border: isScreenSharing ? '2px solid #4CAF50' : '2px solid #333',
                        flexShrink: 0
                    }}>
                        <video 
                            autoPlay 
                            muted
                            playsInline
                            ref={localVideoRef}
                            style={{ 
                                width: isFullscreen ? '100%' : 400,
                                height: isFullscreen ? '120px' : 400,
                                objectFit: 'cover',
                                backgroundColor: '#000',
                                display: 'block'
                            }}
                        />
                        <div style={{
                            position: 'absolute',
                            bottom: '5px',
                            left: '5px',
                            backgroundColor: 'rgba(0,0,0,0.6)',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px'
                        }}>
                            You {isScreenSharing && '(Sharing)'}
                        </div>
                    </div>

                    {/* Remote video in sidebar - visible in fullscreen when screen is being shared */}
                    {isFullscreen && (isScreenSharing || remoteIsScreenSharing) && (
                        <div style={{
                            position: 'relative',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            border: remoteIsScreenSharing ? '2px solid #4CAF50' : '2px solid #333',
                            flexShrink: 0
                        }}>
                            <video 
                                autoPlay 
                                playsInline
                                ref={isScreenSharing ? remoteVideoRef : undefined}
                                srcObject={isScreenSharing ? undefined : (localVideoTrack ? new MediaStream([localVideoTrack]) : null)}
                                muted={!isScreenSharing}
                                style={{ 
                                    width: '100%',
                                    height: '120px',
                                    objectFit: 'cover',
                                    backgroundColor: '#000',
                                    display: 'block'
                                }}
                            />
                            <div style={{
                                position: 'absolute',
                                bottom: '5px',
                                left: '5px',
                                backgroundColor: 'rgba(0,0,0,0.6)',
                                color: 'white',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px'
                            }}>
                                {isScreenSharing ? 'Guest' : 'You'}
                            </div>
                        </div>
                    )}

                    {/* Controls in sidebar (fullscreen mode) */}
                    {isFullscreen && (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            marginTop: 'auto'
                        }}>
                            <button 
                                onClick={toggleScreenShare}
                                style={{
                                    padding: '10px',
                                    fontSize: '14px',
                                    cursor: 'pointer',
                                    backgroundColor: isScreenSharing ? '#ff4444' : '#4CAF50',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '5px'
                                }}
                            >
                                {isScreenSharing ? '⏹ Stop Share' : '🖥 Share Screen'}
                            </button>
                            <button 
                                onClick={toggleFullscreen}
                                style={{
                                    padding: '10px',
                                    fontSize: '14px',
                                    cursor: 'pointer',
                                    backgroundColor: '#2196F3',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '5px'
                                }}
                            >
                                ⛶ Exit Fullscreen
                            </button>
                        </div>
                    )}
                </div>

                {/* Fullscreen button overlay (only in non-fullscreen mode) */}
                {!lobby && !isFullscreen && (
                    <button
                        onClick={toggleFullscreen}
                        style={{
                            position: 'absolute',
                            bottom: '10px',
                            left: '10px',
                            padding: '8px 12px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            backgroundColor: 'rgba(0, 0, 0, 0.6)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px'
                        }}
                        title="Enter Fullscreen"
                    >
                        ⛶ Fullscreen
                    </button>
                )}
            </div>
            
            {/* Controls bar (non-fullscreen mode) */}
            {!lobby && !isFullscreen && (
                <div style={{ 
                    marginTop: '10px',
                    display: 'flex',
                    gap: '10px'
                }}>
                    <button 
                        onClick={toggleScreenShare}
                        style={{
                            padding: '10px 20px',
                            fontSize: '16px',
                            cursor: 'pointer',
                            backgroundColor: isScreenSharing ? '#ff4444' : '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px'
                        }}
                    >
                        {isScreenSharing ? '⏹ Stop Sharing' : '🖥 Share Screen'}
                    </button>
                    <button 
                        onClick={toggleFullscreen}
                        style={{
                            padding: '10px 20px',
                            fontSize: '16px',
                            cursor: 'pointer',
                            backgroundColor: '#2196F3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px'
                        }}
                    >
                        ⛶ Fullscreen
                    </button>
                </div>
            )}
        </div>
    );
}