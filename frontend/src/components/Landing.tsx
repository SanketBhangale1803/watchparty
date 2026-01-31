import { useEffect, useRef, useState } from "react"
import { Room } from "./Room";

export const Landing = () => {
    const [name, setName] = useState("");
    const [localAudioTrack, setLocalAudioTrack] = useState<MediaStreamTrack | null>(null);
    const [localVideoTrack, setlocalVideoTrack] = useState<MediaStreamTrack | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [joined, setJoined] = useState(false);

    const getCam = async () => {
        try {
            const stream = await window.navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            })
            const audioTrack = stream.getAudioTracks()[0]
            const videoTrack = stream.getVideoTracks()[0]
            setLocalAudioTrack(audioTrack);
            setlocalVideoTrack(videoTrack);
            if (!videoRef.current) {
                return;
            }
            videoRef.current.srcObject = new MediaStream([videoTrack])
            videoRef.current.play();
        } catch (e) {
            console.error("Error accessing media devices:", e);
        }
    }

    useEffect(() => {
        if (videoRef && videoRef.current) {
            getCam()
        }
    }, [videoRef]);

    const [roomId, setRoomId] = useState("");

    if (!joined) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px"
            }}>
                <div className="card" style={{ width: "100%", maxWidth: "500px", textAlign: "center" }}>
                    <h1 style={{ marginBottom: "1.5rem", fontSize: "1.75rem", fontWeight: "700" }}>
                        Join the Party
                    </h1>

                    <div className="video-container" style={{ aspectRatio: "16/9", marginBottom: "2rem" }}>
                        <video
                            autoPlay
                            muted
                            playsInline
                            ref={videoRef}
                            style={{ transform: "scaleX(-1)" }} // Mirror effect
                        />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                        <input
                            className="input"
                            type="text"
                            placeholder="Enter your name..."
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />

                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                            <div style={{ flex: 1 }}>
                                <input
                                    className="input"
                                    type="text"
                                    placeholder="Room ID (to join)"
                                    value={roomId}
                                    onChange={(e) => setRoomId(e.target.value)}
                                />
                            </div>
                            <button
                                className="btn btn-primary"
                                disabled={!name || !roomId}
                                onClick={() => setJoined(true)}
                                style={{ minWidth: "100px" }}
                            >
                                Join
                            </button>
                        </div>

                        <div style={{ position: "relative", margin: "10px 0" }}>
                            <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: "1px", background: "#e2e8f0" }} />
                            <span style={{ position: "relative", background: "white", padding: "0 10px", color: "#64748b", fontSize: "0.875rem" }}>
                                or
                            </span>
                        </div>

                        <button
                            className="btn btn-secondary"
                            disabled={!name}
                            onClick={() => {
                                setRoomId(""); // Clear room ID to signal creation
                                setJoined(true);
                            }}
                        >
                            Create New Room
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return <Room name={name} localAudioTrack={localAudioTrack} localVideoTrack={localVideoTrack} demoRoomId={roomId} />
}