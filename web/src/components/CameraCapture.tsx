import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./ui.tsx";

/** Live camera only works in secure contexts (https or localhost) with getUserMedia support. */
export const canUseLiveCamera = () => window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);

const SIZE = 512;

function cameraErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow the camera for this site in your browser settings, or upload a photo instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "We couldn't find a camera on this device.";
  if (name === "NotReadableError") return "Your camera is busy in another app. Close it there and try again.";
  return "The camera couldn't be started. You can upload a photo instead.";
}

/**
 * Live viewfinder with a square crop. The front camera preview is mirrored like a mirror,
 * and the snapshot is saved exactly as previewed.
 */
export function CameraDialog({ onCapture, onClose }: { onCapture: (photo: Blob) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [hasMultiple, setHasMultiple] = useState(false);
  const [status, setStatus] = useState<"starting" | "live" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (shot) return;
    let cancelled = false;
    setStatus("starting");
    setError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then(async (stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => {});
        setStatus("live");
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) setHasMultiple(devices.filter((d) => d.kind === "videoinput").length > 1);
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus("error");
        setError(cameraErrorMessage(e));
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, shot, stop]);

  // Free the preview URL when the snapshot is replaced or the dialog closes.
  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(SIZE, side);
    const ctx = canvas.getContext("2d")!;
    if (facing === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return setError("Couldn't capture the photo. Please try again.");
      stop();
      setShot({ blob, url: URL.createObjectURL(blob) });
    }, "image/jpeg", 0.88);
  }

  return (
    <Modal title="Take a photo" onClose={onClose}>
      <div className="stack">
        <div className="camera-frame">
          {shot
            ? <img src={shot.url} alt="Your new photo" />
            : (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={facing === "user" ? "mirrored" : undefined}
                aria-label="Camera preview"
              />
            )}
          {!shot && status === "starting" && <div className="camera-overlay">Starting camera…</div>}
          {!shot && status === "live" && <div className="camera-guide" aria-hidden="true" />}
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {shot
          ? (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShot(null)}>Retake</button>
              <button type="button" className="btn btn-primary" onClick={() => onCapture(shot.blob)}>Use this photo</button>
            </div>
          )
          : (
            <div className="row" style={{ justifyContent: "space-between" }}>
              {hasMultiple
                ? (
                  <button type="button" className="btn btn-ghost" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}>
                    🔄 Switch camera
                  </button>
                )
                : <span />}
              <button type="button" className="btn btn-primary" onClick={snap} disabled={status !== "live"}>📸 Snap</button>
            </div>
          )}
        <p className="faint" style={{ margin: 0 }}>Centre your face in the circle. The photo stays on this device until you press “Use this photo”.</p>
      </div>
    </Modal>
  );
}
