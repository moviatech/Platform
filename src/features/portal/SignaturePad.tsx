"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useTranslations } from "next-intl";

type Point = [number, number];

function ink(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111";
  return ctx;
}

function redraw(canvas: HTMLCanvasElement, strokes: Point[][]) {
  const { width, height } = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = ink(canvas);
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const stroke of strokes) {
    ctx.beginPath();
    stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height)));
    ctx.stroke();
  }
}

function exportPng(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.min(Math.round(rect.width * 2), 900);
  const height = Math.round((width * rect.height) / rect.width);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(canvas, 0, 0, width, height);
  return out.toDataURL("image/png");
}

export function SignaturePad({ onChange }: { onChange?: (hasInk: boolean) => void }) {
  const t = useTranslations("portal.agreement");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const last = useRef<Point | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => redraw(canvas, strokes.current);
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const trace = (event: PointerEvent<HTMLCanvasElement>, from: Point | null) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const point: Point = [event.clientX - rect.left, event.clientY - rect.top];
    strokes.current[strokes.current.length - 1].push([point[0] / rect.width, point[1] / rect.height]);
    const ctx = ink(canvas);
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(...(from ?? point));
      ctx.lineTo(...point);
      ctx.stroke();
    }
    last.current = point;
  };

  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    strokes.current.push([]);
    trace(event, null);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (last.current) trace(event, last.current);
  };

  const up = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    last.current = null;
    setValue(exportPng(event.currentTarget));
    onChange?.(true);
  };

  const clear = () => {
    strokes.current = [];
    last.current = null;
    if (canvasRef.current) redraw(canvasRef.current, []);
    setValue("");
    onChange?.(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-charcoal">{t("signHere")}</span>
        <button type="button" onClick={clear} disabled={!value} className="text-xs text-muted hover:text-ink disabled:opacity-40">
          {t("clear")}
        </button>
      </div>
      <div className="relative h-40 w-full overflow-hidden rounded-xl border border-ink/10 bg-white">
        <div className="pointer-events-none absolute inset-x-5 bottom-9 border-t border-dashed border-ink/15" />
        <canvas ref={canvasRef} className="absolute inset-0 size-full cursor-crosshair touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>
      <input type="hidden" name="signature" value={value} />
    </div>
  );
}
