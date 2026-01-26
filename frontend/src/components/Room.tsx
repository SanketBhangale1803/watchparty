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
    const [remoteCameraTrack, setRemoteCameraTrack] = useState<MediaStreamTrack | null>(null);
    const [, setRemoteScreenTrack] = useState<MediaStreamTrack | null>(null);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [screenTrack, setScreenTrack] = useState<MediaStreamTrack | null>(null);
    const [screenAudioTrack, setScreenAudioTrack] = useState<MediaStreamTrack | null>(null);
    const [remoteIsScreenSharing, setRemoteIsScreenSharing] = useState(false);
    const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const screenShareRef = useRef<HTMLVideoElement>(null);
    const sidebarRemoteVideoRef = useRef<HTMLVideoElement>(null);
    const sidebarRemoteCameraRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Keep persistent refs for peer connections (needed for renegotiation)
    const sendingPcRef = useRef<RTCPeerConnection | null>(null);
    const receivingPcRef = useRef<RTCPeerConnection | null>(null);
    const remoteCameraTrackRef = useRef<MediaStreamTrack | null>(null);
    //const remoteStreamRef = useRef<MediaStream | null>(null);

    // Keep separate streams for main (screen/camera) and sidebar (remote camera)
    //const remoteMainStreamRef = useRef<MediaStream | null>(null);
    //const remoteCameraStreamRef = useRef<MediaStream | null>(null);

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

    useEffect(() => {
        const socket = io(URL);
        socket.on('send-offer', async ({roomId}) => {
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
        });

        socket.on("offer", async ({roomId, sdp: remoteSdp}) => {
            console.log("received offer");
            setLobby(false);
            setCurrentRoomId(roomId);

            // Reuse existing receiving PC if present (renegotiation), else create new one
            let pc = receivingPcRef.current;
            if (!pc) {
                pc = new RTCPeerConnection();
                receivingPcRef.current = pc;
                setReceivingPc(pc);
                
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
                        console.log("Stream or camera track not found", {stream: !!stream, cameraTrack: !!cameraTrack});
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
            {!isFullscreen && <div>Hi {name}</div>}
            {lobby ? <div>Waiting to connect you to someone</div> : null}
            
            {/* Main video container */}
            <div style={{ 
                position: 'relative', 
                display: 'flex',
                width: isFullscreen ? '100%' : 'auto',
                height: isFullscreen ? '100%' : 'auto',
            }}>
                {/* Main view - shows screen share when I'M sharing, otherwise remote video */}
                {isScreenSharing ? (
                    <video 
                        autoPlay 
                        playsInline
                        muted
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
                
                {/* Side panel */}
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
                    {/* Local video (your camera) - always visible in fullscreen */}
                    {isFullscreen && (
                        <div style={{
                            position: 'relative',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            border: isScreenSharing ? '2px solid #4CAF50' : (remoteIsScreenSharing ? '2px solid #2196F3' : '2px solid #333'),
                            flexShrink: 0
                        }}>
                            <video 
                                autoPlay 
                                muted
                                playsInline
                                ref={localVideoRef}
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
                                You {isScreenSharing && '(Sharing)'}
                            </div>
                        </div>
                    )}

                    {/* 
                        Remote video in sidebar - show when:
                        1. I'M sharing (isScreenSharing) - show guest's camera in sidebar
                        2. Remote is sharing (remoteIsScreenSharing) - their track was replaced with screen,
                           so we can't show their camera, but we show indicator
                    */}
                    {isFullscreen && isScreenSharing && (
                        <div style={{
                            position: 'relative',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            border: '2px solid #333',
                            flexShrink: 0
                        }}>
                            <video 
                                autoPlay 
                                playsInline
                                ref={sidebarRemoteVideoRef}
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
                                Guest
                            </div>
                        </div>
                    )}

                    {/* When remote is sharing - show their camera in sidebar */}
                    {isFullscreen && remoteIsScreenSharing && !isScreenSharing && (
                        <div style={{
                            position: 'relative',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            border: '2px solid #4CAF50',
                            flexShrink: 0
                        }}>
                            <video 
                                autoPlay 
                                playsInline
                                ref={sidebarRemoteCameraRef}
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
                                Host (Sharing)
                            </div>
                        </div>
                    )}

                    {/* Non-fullscreen: show local video */}
                    {!isFullscreen && (
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
                                    width: 400,
                                    height: 400,
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