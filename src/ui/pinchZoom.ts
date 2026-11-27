// Zooming by pinching (or ⌘/Ctrl and scrolling), for the PDF reader and a note's pages (see
// tests/pdf-reader.test.tsx › Zooming by pinching). While the gesture lasts, what's shown is scaled
// at once, around the point under the pointer; when it ends, `onZoom` says the zoom to draw it at.

import { type RefObject, useEffect, useRef } from "react";

type Options = {
  /** What scrolls (gestures over it zoom), and what's scaled while pinching (inside it). */
  scroller: RefObject<HTMLElement | null>;
  content: RefObject<HTMLElement | null>;
  /** The zoom now, and how far it can go. */
  scale: number;
  smallest: number;
  biggest: number;
  /** A gesture starts at a point of the window (to keep what's there under it after). */
  onStart?: (clientX: number, clientY: number) => void;
  /** It ended at a new zoom: draw it at that (and stop scaling `content`). */
  onZoom: (scale: number) => void;
  /** It ended where it started: nothing to draw. */
  onCancel?: () => void;
};

/** Clears the scaling done while pinching (once drawn at the new zoom). */
export function stopScaling(content: HTMLElement | null) {
  if (content) content.style.transform = "";
}

export function usePinchZoom(options: Options) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const box = latest.current.scroller.current;
    if (!box) return;
    type Pinch = { by: number; startedBy: number; timer?: number };
    let pinch: Pinch | null = null;

    const begin = (clientX: number, clientY: number): Pinch | null => {
      if (pinch) return pinch;
      const content = latest.current.content.current;
      if (!content) return null;
      const rect = content.getBoundingClientRect();
      content.style.transformOrigin = `${clientX - rect.left}px ${clientY - rect.top}px`;
      latest.current.onStart?.(clientX, clientY);
      return (pinch = { by: 1, startedBy: 1 });
    };
    const show = (gesture: Pinch, by: number) => {
      const { scale, smallest, biggest, content } = latest.current;
      gesture.by = Math.min(biggest / scale, Math.max(smallest / scale, by));
      if (content.current) content.current.style.transform = `scale(${Number(gesture.by.toFixed(4))})`;
    };
    const finish = () => {
      const gesture = pinch;
      pinch = null;
      if (!gesture) return;
      window.clearTimeout(gesture.timer);
      const { scale, content, onZoom, onCancel } = latest.current;
      const next = Math.round(scale * gesture.by * 100) / 100;
      if (next === Math.round(scale * 100) / 100) {
        stopScaling(content.current);
        onCancel?.();
        return;
      }
      onZoom(next);
    };
    // A trackpad's pinch comes as the wheel with Ctrl held (in Chromium, and on Windows and Linux);
    // a mouse's wheel with ⌘ or Ctrl held zooms too.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const gesture = begin(event.clientX, event.clientY);
      if (!gesture) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      show(gesture, gesture.by * Math.min(1.25, Math.max(0.8, Math.exp(-delta / 100))));
      window.clearTimeout(gesture.timer);
      gesture.timer = window.setTimeout(finish, 150);
    };
    // Safari's webview (the app on a Mac) sends gesture events, with how much bigger it is now.
    type Gesture = Event & { scale?: number; clientX?: number; clientY?: number };
    const centre = () => {
      const rect = box.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const gestureStart = (event: Gesture) => {
      event.preventDefault();
      const gesture = begin(event.clientX ?? centre().x, event.clientY ?? centre().y);
      if (gesture) gesture.startedBy = gesture.by;
    };
    const gestureChange = (event: Gesture) => {
      event.preventDefault();
      if (pinch) show(pinch, pinch.startedBy * (event.scale ?? 1));
    };
    const gestureEnd = (event: Gesture) => {
      event.preventDefault();
      finish();
    };
    box.addEventListener("wheel", wheel, { passive: false });
    box.addEventListener("gesturestart", gestureStart);
    box.addEventListener("gesturechange", gestureChange);
    box.addEventListener("gestureend", gestureEnd);
    return () => {
      box.removeEventListener("wheel", wheel);
      box.removeEventListener("gesturestart", gestureStart);
      box.removeEventListener("gesturechange", gestureChange);
      box.removeEventListener("gestureend", gestureEnd);
      window.clearTimeout(pinch?.timer);
    };
  }, []);
}
