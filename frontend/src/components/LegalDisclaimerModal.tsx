import { useState } from "react";

export const LegalDisclaimerModal = () => {
    const [isOpen, setIsOpen] = useState(true);

    const handleAccept = () => {
        setIsOpen(false);
    };

    if (!isOpen) return null;

    return (
        <div
            className="legal-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-modal-title"
        >
            <div className="legal-modal">
                <h2 id="legal-modal-title" className="legal-modal__title">
                    Closr Terms of Service & Legal Disclaimer
                </h2>

                <div className="legal-modal__content">
                    <p>
                        <strong>Please read and accept the following terms before using Closr:</strong>
                    </p>

                    <p>
                        Closr is a decentralized, peer-to-peer (P2P) real-time video communications
                        application. By design, all video, audio, and screen-sharing data flows directly
                        between participants&apos; web browsers. Closr servers do not intercept, transmit,
                        stream, or store any media content.
                    </p>

                    <p>
                        As a user, you retain sole legal liability and responsibility for any data,
                        imagery, or copyrighted material you transmit or display using the platform&apos;s
                        screen-sharing or camera feeds.
                    </p>

                    <blockquote className="legal-modal__quote">
                        <strong>Notice Regarding Third-Party Content:</strong> Closr is not affiliated
                        with, endorsed by, or partnered with Netflix, YouTube, TikTok, Disney+, or any
                        other streaming and media platforms. Closr operates strictly as a conduit tool,
                        identical in infrastructure to platforms like Google Meet or Zoom.
                    </blockquote>

                    <p>
                        The developers, owners, and hosting providers of Closr explicitly disclaim all
                        liability for intellectual property infringement, unauthorized broadcasts, or
                        illegal distribution of media perpetrated by individual users within private
                        communication rooms.
                    </p>
                </div>

                <button type="button" className="btn btn-primary legal-modal__accept" onClick={handleAccept}>
                    I Understand & Accept
                </button>
            </div>
        </div>
    );
};
