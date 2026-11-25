"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowUpLeft, ChevronLeft, ChevronRight, Circle, Hand, LoaderCircle, Maximize2, Minus, PenLine, Plus, Save, Square, Trash2, Undo2, X } from "lucide-react";
import { shrinkToJpeg } from "@/lib/property-data";

export type ViewerImage = { src: string; label?: string };

const MIN_ZOOM = 1, MAX_ZOOM = 8;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Wheel zooms toward the pointer, dragging moves the picture, double-click toggles 1× / 2.5×. */
function useZoom() {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const reset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  // The point under the pointer stays put: pan' = p − (p − pan)·(z'/z), p measured from the box centre.
  const state = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  state.current = { zoom, pan };
  const zoomAt = useCallback((next: number, box: DOMRect, clientX: number, clientY: number) => {
    const { zoom: current, pan: old } = state.current;
    const target = clamp(next, MIN_ZOOM, MAX_ZOOM);
    const px = clientX - (box.left + box.width / 2), py = clientY - (box.top + box.height / 2);
    setZoom(target);
    setPan(target === 1 ? { x: 0, y: 0 } : { x: px - (px - old.x) * (target / current), y: py - (py - old.y) * (target / current) });
  }, []);
  const onWheel = (event: ReactWheelEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    zoomAt(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2), box, event.clientX, event.clientY);
  };
  const step = (factor: number, box: HTMLElement | null) => {
    if (!box) return;
    const rect = box.getBoundingClientRect();
    zoomAt(zoom * factor, rect, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  return { zoom, pan, setPan, reset, zoomAt, onWheel, step };
}

const zoomButton = "grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25 disabled:opacity-30";

/** Full-screen photo viewer with zoom; when onSaveEdit is given it can open the drawing editor. */
export function ImageViewer({ images, index, onIndex, onClose, onSaveEdit, editLabel = "رسم وتعليم على الصورة" }: { images: ViewerImage[]; index: number; onIndex: (index: number) => void; onClose: () => void; onSaveEdit?: (dataUrl: string) => Promise<void>; editLabel?: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const { zoom, pan, setPan, reset, zoomAt, onWheel, step } = useZoom();
  const [editing, setEditing] = useState(false);
  const image = images[index];

  useEffect(() => { reset(); }, [index, reset]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing) return;
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && index < images.length - 1) onIndex(index + 1);
      else if (event.key === "ArrowRight" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, index, images.length, onClose, onIndex]);

  if (!image || typeof document === "undefined") return null;
  if (editing && onSaveEdit) return <ImageAnnotator src={image.src} onCancel={() => setEditing(false)} onSave={async dataUrl => { await onSaveEdit(dataUrl); setEditing(false); }}/>;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom === 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start) setPan({ x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y });
  };

  return createPortal(<div role="dialog" aria-modal="true" aria-label="الصورة مكبّرة" className="fixed inset-0 z-[110] flex flex-col bg-slate-950/95 text-white" dir="rtl">
    <div className="flex flex-wrap items-center gap-2 p-3">
      <button type="button" onClick={onClose} aria-label="إغلاق الصورة" className={zoomButton}><X size={20}/></button>
      {image.label && <span className="rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-bold">{image.label}</span>}
      <div className="mr-auto flex items-center gap-2">
        {onSaveEdit && <button type="button" onClick={() => setEditing(true)} className="flex h-10 items-center gap-2 rounded-full bg-teal-500 px-4 text-[13px] font-bold text-white hover:bg-teal-400"><PenLine size={16}/>{editLabel}</button>}
        <button type="button" onClick={() => step(1 / 1.5, box.current)} disabled={zoom <= MIN_ZOOM} aria-label="تصغير" className={zoomButton}><Minus size={18}/></button>
        <span className="w-14 text-center text-[13px] font-bold tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => step(1.5, box.current)} disabled={zoom >= MAX_ZOOM} aria-label="تكبير" className={zoomButton}><Plus size={18}/></button>
        <button type="button" onClick={reset} disabled={zoom === 1} aria-label="الحجم الأصلي" className={zoomButton}><Maximize2 size={16}/></button>
      </div>
    </div>
    <div ref={box} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }} onDoubleClick={event => zoomAt(zoom > 1 ? 1 : 2.5, event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)} onMouseDown={event => { if (event.target === event.currentTarget && zoom === 1) onClose(); }} className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}>
      <img src={image.src} alt={image.label || `صورة ${index + 1}`} draggable={false} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} className="absolute inset-0 m-auto max-h-full max-w-full object-contain transition-transform duration-75"/>
      {images.length > 1 && <>
        <button type="button" disabled={index <= 0} onClick={() => onIndex(index - 1)} aria-label="الصورة السابقة" className={`absolute right-4 top-1/2 -translate-y-1/2 ${zoomButton} h-11 w-11`}><ChevronRight size={22}/></button>
        <button type="button" disabled={index >= images.length - 1} onClick={() => onIndex(index + 1)} aria-label="الصورة التالية" className={`absolute left-4 top-1/2 -translate-y-1/2 ${zoomButton} h-11 w-11`}><ChevronLeft size={22}/></button>
      </>}
    </div>
    <div className="flex items-center justify-center gap-3 p-3 text-xs text-white/70">
      {images.length > 1 && <span className="rounded-full bg-white/15 px-3 py-1 font-bold text-white">{(index + 1).toLocaleString("ar-KW")} / {images.length.toLocaleString("ar-KW")}</span>}
      <span>عجلة الماوس للتكبير · اسحب لتحريك الصورة · دبل كليك للتكبير السريع</span>
    </div>
  </div>, document.body);
}

type Tool = "move" | "pen" | "arrow" | "circle" | "rect";
type Shape = { tool: Exclude<Tool, "move">; color: string; width: number; points: [number, number][] };
const COLORS = ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#111827", "#ffffff"];
const SIZES = [{ label: "رفيع", factor: .004 }, { label: "متوسط", factor: .008 }, { label: "عريض", factor: .014 }];
const TOOLS: { id: Tool; label: string; icon: typeof Hand }[] = [
  { id: "arrow", label: "سهم", icon: ArrowUpLeft },
  { id: "pen", label: "قلم (رسم حر)", icon: PenLine },
  { id: "circle", label: "دائرة", icon: Circle },
  { id: "rect", label: "مستطيل", icon: Square },
  { id: "move", label: "تحريك الصورة", icon: Hand },
];

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape) {
  const [start, end] = [shape.points[0], shape.points[shape.points.length - 1]];
  if (!start) return;
  ctx.strokeStyle = shape.color; ctx.fillStyle = shape.color; ctx.lineWidth = shape.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  if (shape.tool === "pen") {
    ctx.moveTo(start[0], start[1]);
    for (const [x, y] of shape.points.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  } else if (shape.tool === "rect") {
    ctx.strokeRect(Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]));
  } else if (shape.tool === "circle") {
    ctx.ellipse((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, Math.abs(end[0] - start[0]) / 2, Math.abs(end[1] - start[1]) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Arrow: the head sits where the drag ended, pointing at the marked house.
    const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
    const head = Math.max(shape.width * 4, 14);
    const base: [number, number] = [end[0] - head * .8 * Math.cos(angle), end[1] - head * .8 * Math.sin(angle)];
    ctx.moveTo(start[0], start[1]); ctx.lineTo(base[0], base[1]); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(end[0], end[1]);
    ctx.lineTo(end[0] - head * Math.cos(angle - Math.PI / 7), end[1] - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(end[0] - head * Math.cos(angle + Math.PI / 7), end[1] - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath(); ctx.fill();
  }
}

/** Draw arrows, circles, boxes or free lines on a copy of the photo; the original stays untouched. */
export function ImageAnnotator({ src, onCancel, onSave }: { src: string; onCancel: () => void; onSave: (dataUrl: string) => Promise<void> }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const [picture, setPicture] = useState<HTMLImageElement | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(1);
  const [fit, setFit] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const { zoom, pan, setPan, reset, onWheel, step } = useZoom();

  useEffect(() => {
    const img = new Image();
    img.onload = () => setPicture(img);
    img.onerror = () => setError("تعذر فتح الصورة للتعديل.");
    img.src = src;
  }, [src]);

  // Fit the whole picture in the editing area at 100%.
  useEffect(() => {
    if (!picture || !box.current) return;
    const measure = () => { const rect = box.current!.getBoundingClientRect(); setFit(Math.min(rect.width / picture.width, rect.height / picture.height, 1)); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [picture]);

  useEffect(() => {
    const node = canvas.current;
    if (!node || !picture) return;
    node.width = picture.width; node.height = picture.height;
    const ctx = node.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(picture, 0, 0);
    for (const shape of draft ? [...shapes, draft] : shapes) drawShape(ctx, shape);
  }, [picture, shapes, draft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); setShapes(old => old.slice(0, -1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Screen point → picture pixel (works at any zoom, because the canvas box is measured as drawn).
  const toPicture = (event: ReactPointerEvent): [number, number] => {
    const node = canvas.current!, rect = node.getBoundingClientRect();
    return [(event.clientX - rect.left) * node.width / rect.width, (event.clientY - rect.top) * node.height / rect.height];
  };
  const strokeWidth = picture ? Math.max(2, Math.round(Math.max(picture.width, picture.height) * SIZES[size].factor)) : 4;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!picture || event.button === 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "move" || event.button === 1) { drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; return; }
    const point = toPicture(event);
    setDraft({ tool, color, width: strokeWidth, points: [point, point] });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start) { setPan({ x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y }); return; }
    if (!draft) return;
    const point = toPicture(event);
    setDraft(old => old && (old.tool === "pen" ? { ...old, points: [...old.points, point] } : { ...old, points: [old.points[0], point] }));
  };
  const onPointerUp = () => {
    drag.current = null;
    if (!draft) return;
    const [a, b] = [draft.points[0], draft.points[draft.points.length - 1]];
    if (draft.tool === "pen" ? draft.points.length > 2 : Math.hypot(b[0] - a[0], b[1] - a[1]) > 4) setShapes(old => [...old, draft]);
    setDraft(null);
  };

  const save = async () => {
    if (!canvas.current || !picture) return;
    setSaving(true); setError("");
    try { await onSave(shrinkToJpeg(canvas.current, picture.width, picture.height)); }
    catch (cause) { setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "تعذر حفظ الصورة."); }
    finally { setSaving(false); }
  };

  if (typeof document === "undefined") return null;
  const toolButton = (active: boolean) => `flex h-10 items-center gap-1.5 rounded-xl px-3 text-[13px] font-bold ${active ? "bg-teal-500 text-white" : "bg-white/10 text-white hover:bg-white/20"}`;

  return createPortal(<div role="dialog" aria-modal="true" aria-label="تعديل الصورة" className="fixed inset-0 z-[120] flex flex-col bg-slate-950 text-white" dir="rtl">
    <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
      {TOOLS.map(item => <button key={item.id} type="button" onClick={() => setTool(item.id)} aria-pressed={tool === item.id} title={item.label} className={toolButton(tool === item.id)}><item.icon size={17}/><span className="hidden sm:inline">{item.label}</span></button>)}
      <span className="mx-1 h-8 w-px bg-white/20"/>
      {COLORS.map(value => <button key={value} type="button" onClick={() => setColor(value)} aria-label={`لون ${value}`} aria-pressed={color === value} style={{ background: value }} className={`h-8 w-8 rounded-full border-2 ${color === value ? "border-teal-300 ring-2 ring-teal-300" : "border-white/40"}`}/>)}
      <span className="mx-1 h-8 w-px bg-white/20"/>
      {SIZES.map((item, i) => <button key={item.label} type="button" onClick={() => setSize(i)} aria-pressed={size === i} className={toolButton(size === i)}>{item.label}</button>)}
      <span className="mx-1 h-8 w-px bg-white/20"/>
      <button type="button" onClick={() => setShapes(old => old.slice(0, -1))} disabled={!shapes.length} title="تراجع (Ctrl+Z)" className={`${toolButton(false)} disabled:opacity-30`}><Undo2 size={16}/>تراجع</button>
      <button type="button" onClick={() => setShapes([])} disabled={!shapes.length} className={`${toolButton(false)} disabled:opacity-30`}><Trash2 size={16}/>امسح الرسم</button>
      <div className="mr-auto flex items-center gap-2">
        <button type="button" onClick={() => step(1 / 1.5, box.current)} disabled={zoom <= MIN_ZOOM} aria-label="تصغير" className={zoomButton}><Minus size={18}/></button>
        <span className="w-14 text-center text-[13px] font-bold tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => step(1.5, box.current)} disabled={zoom >= MAX_ZOOM} aria-label="تكبير" className={zoomButton}><Plus size={18}/></button>
        <button type="button" onClick={reset} disabled={zoom === 1} aria-label="الحجم الأصلي" className={zoomButton}><Maximize2 size={16}/></button>
      </div>
    </div>
    <div ref={box} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onContextMenu={event => event.preventDefault()} className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${tool === "move" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"}`}>
      {!picture && !error && <div className="grid h-full place-items-center"><LoaderCircle className="animate-spin"/></div>}
      {picture && <canvas ref={canvas} style={{ width: picture.width * fit, height: picture.height * fit, transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} className="absolute left-1/2 top-1/2 shadow-2xl"/>}
    </div>
    <div className="flex flex-wrap items-center gap-3 border-t border-white/10 p-3">
      <span className="text-xs text-white/70">اختار أداة وارسم على الصورة · عجلة الماوس للتكبير · زرار الماوس الأوسط أو «تحريك الصورة» للتحريك. الأصل مش هيتغير، التعديل بيتحفظ كصورة جديدة.</span>
      {error && <span role="alert" className="text-[13px] font-bold text-rose-300">{error}</span>}
      <div className="mr-auto flex gap-2">
        <button type="button" onClick={onCancel} className="h-10 rounded-xl px-4 text-[13px] font-bold text-white/80 hover:bg-white/10">إلغاء</button>
        <button type="button" onClick={() => void save()} disabled={saving || !picture || !shapes.length} className="flex h-10 items-center gap-2 rounded-xl bg-teal-500 px-5 text-[13px] font-bold text-white disabled:opacity-40">{saving ? <LoaderCircle size={15} className="animate-spin"/> : <Save size={15}/>}حفظ كصورة جديدة</button>
      </div>
    </div>
  </div>, document.body);
}
