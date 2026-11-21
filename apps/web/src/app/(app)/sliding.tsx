"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Box = { x: number; y: number; width: number; height: number };

export function useSliding<T extends HTMLElement>(key: unknown) {
  const root = useRef<T>(null);
  const [box, setBox] = useState<Box>();
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const active = root.current?.querySelector<HTMLElement>("[aria-current='page']");
      if (!active || !root.current) return setBox(undefined);
      setBox({ x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight });
    };
    measure();
    const frame = requestAnimationFrame(() => setReady(true));
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [key]);
  return { root, box, ready };
}

export function SlidingIndicator({ box, ready, className }: { box?: Box; ready: boolean; className: string }) {
  if (!box) return null;
  return (
    <span aria-hidden="true" className={`pointer-events-none absolute top-0 left-0 ${ready ? "transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]" : ""} ${className}`}
      style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, height: box.height }} />
  );
}

export function Segmented({ label, items }: { label: string; items: { href: string; label: ReactNode; active: boolean; key: string }[] }) {
  const active = items.find((item) => item.active)?.key;
  const [selected, setSelected] = useState(active);
  const [seen, setSeen] = useState(active);
  if (seen !== active) {
    setSeen(active);
    setSelected(active);
  }
  const { root, box, ready } = useSliding<HTMLElement>(selected);
  return (
    <nav ref={root} aria-label={label} className="relative flex gap-1">
      <SlidingIndicator box={box} ready={ready} className="rounded-full bg-white/12 indicator" />
      {items.map((item) => (
        <Link key={item.key} href={item.href} aria-current={selected === item.key ? "page" : undefined} scroll={false} onClick={() => setSelected(item.key)}
          className={`relative inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-200 ${selected === item.key ? "text-[#fbfbfb]" : "text-[#979797] hover:text-ink"}`}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
