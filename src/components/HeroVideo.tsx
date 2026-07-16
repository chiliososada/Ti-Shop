"use client";

import { useEffect, useRef } from "react";

// Background hero video tuned for mobile + WeChat/X5 inline autoplay.
// - Poster is the video's exact first frame → no visible "flash" on takeover.
// - Desktop loads crisp 1080p; phones load the lighter 720p for fast start.
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    // Pick the right resolution for this device (crisp on desktop, light on mobile).
    const wantHd =
      window.matchMedia("(min-width: 1024px)").matches &&
      !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    v.src = wantHd ? "/video/hero-1080.mp4" : "/video/hero-720.mp4";
    v.load();

    const tryPlay = () => {
      v.play().catch(() => {
        /* autoplay blocked — poster stays, retried on interaction */
      });
    };

    tryPlay();

    // WeChat browser only allows programmatic play after its bridge is ready.
    const w = window as unknown as { WeixinJSBridge?: unknown };
    if (w.WeixinJSBridge) {
      tryPlay();
    } else {
      document.addEventListener("WeixinJSBridgeReady", tryPlay, { once: true });
    }

    // Last-resort: start on the first user interaction.
    const onInteract = () => {
      tryPlay();
      window.removeEventListener("touchstart", onInteract);
      window.removeEventListener("click", onInteract);
    };
    window.addEventListener("touchstart", onInteract, { passive: true });
    window.addEventListener("click", onInteract);

    return () => {
      document.removeEventListener("WeixinJSBridgeReady", tryPlay);
      window.removeEventListener("touchstart", onInteract);
      window.removeEventListener("click", onInteract);
    };
  }, []);

  // WeChat / Tencent X5 inline playback hints (non-standard attributes).
  const x5Attrs: Record<string, string> = {
    "webkit-playsinline": "true",
    "x5-playsinline": "true",
    "x5-video-player-type": "h5-page",
    "x5-video-player-fullscreen": "false",
  };

  return (
    <video
      ref={ref}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      poster="/video/hero-poster.jpg"
      className="absolute inset-0 h-full w-full object-cover"
      {...x5Attrs}
    />
  );
}
