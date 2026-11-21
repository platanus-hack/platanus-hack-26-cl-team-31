import { useCallback, useEffect, useRef, useState } from "react";

export function useFlowViewport(fill: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 880, root: 1200 });
  const [nativeFull, setNativeFull] = useState(false);
  const [cssFull, setCssFull] = useState(false);
  const [frame, setFrame] = useState({ width: 0, height: 0, available: 0 });
  const layoutRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(true);

  // Tamaño del contenedor (responsive) y visibilidad (la repetición se detiene fuera de pantalla).
  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const frameEl = frameRef.current;
    const layoutEl = layoutRef.current;
    if (!root || !stage || !frameEl || !layoutEl) return;
    const measure = () => {
      setSize({ width: Math.round(stage.clientWidth) || 880, root: Math.round(frameEl.clientWidth) || 1200 });
      setFrame((current) => {
        const next = { width: root.clientWidth, height: root.clientHeight, available: layoutEl.clientHeight };
        return current.width === next.width && current.height === next.height && current.available === next.available ? current : next;
      });
    };
    measure();
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    resize?.observe(root);
    resize?.observe(stage);
    resize?.observe(layoutEl);
    const intersection = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => { visibleRef.current = entry?.isIntersecting ?? true; })
      : undefined;
    intersection?.observe(root);
    return () => {
      resize?.disconnect();
      intersection?.disconnect();
    };
  }, []);

  // ---------- Pantalla completa ----------
  const full = nativeFull || cssFull;
  const fillMode = fill || full;
  useEffect(() => {
    const onChange = () => setNativeFull(typeof document !== "undefined" && document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (cssFull) {
      setCssFull(false);
      return;
    }
    // Sin la API (iframe sin allowfullscreen, Safari iOS) se usa un modo expandido con CSS.
    if (document.fullscreenEnabled && root.requestFullscreen) root.requestFullscreen().catch(() => setCssFull(true));
    else setCssFull(true);
  }, [cssFull]);

  // En pantalla completa y embed todo escala desde un lienzo lógico de 1440 × 810 para que se lea a distancia.
  const scale = fillMode && frame.width > 0 ? Math.min(1.75, Math.max(1, Math.min(frame.width / 1440, frame.height / 810))) : 1;

  return { rootRef, stageRef, layoutRef, frameRef, visibleRef, full, fillMode, cssFull, toggleFullscreen, frame, size, scale };
}
