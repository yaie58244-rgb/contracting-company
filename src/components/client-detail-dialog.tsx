"use client";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, MessageCircle, Phone, RefreshCw,
  Trash2, UserRound, X,
} from "lucide-react";
import {
  addClientComment, claimClient, fetchClientActivity, fetchClientPhones, releaseClient,
  type ClientComment, type ClientRecord,
} from "@/lib/client-data";
import {
  canManageClientImages, deleteClientImage, fetchClientImages, replaceClientImage, uploadClientImage,
  type ClientImage,
} from "@/lib/client-image-data";
import { dialable, formatPhone } from "@/lib/phone-format";

export function ClientDetailDialog({
  clients, index, onIndexChange, onClose, userId, onRefresh,
}: {
  clients: ClientRecord[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  userId: string;
  onRefresh: () => Promise<void>;
}) {
  const client = clients[index];
  const [phones, setPhones] = useState<string[]>([]);
  const [comments, setComments] = useState<ClientComment[]>([]);
  const [claim, setClaim] = useState<ClientRecord["claim"]>(null);
  const [images, setImages] = useState<ClientImage[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ClientImage | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<ClientImage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const previous = index > 0;
  const next = index < clients.length - 1;

  useEffect(() => { void canManageClientImages().then(setCanManage).catch(() => setCanManage(false)); }, []);

  useEffect(() => {
    if (!client) return;
    let active = true;
    setError(""); setDraft(""); setPreview(null);
    setPhones(client.phones ?? []);
    setComments(client.comments ?? []);
    setClaim(client.claim ?? null);
    setImages([]);
    void (async () => {
      const [phoneMap, activity, imageRows] = await Promise.all([
        fetchClientPhones([client.id]).catch(() => ({}) as Record<string, string[]>),
        fetchClientActivity(client.id).catch(() => null),
        fetchClientImages(client.id).catch(() => [] as ClientImage[]),
      ]);
      if (!active) return;
      setPhones(phoneMap[client.id] ?? client.phones ?? []);
      if (activity) { setComments(activity.comments); setClaim(activity.claim); }
      setImages(imageRows);
    })();
    return () => { active = false; };
    // The record identity changes on every refresh, so key the load on the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && index > 0) onIndexChange(index - 1);
      if (event.key === "ArrowLeft" && index < clients.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clients.length, index, onClose, onIndexChange]);

  const submitComment = async () => {
    const body = draft.trim();
    if (body.length < 2 || busy) return;
    setBusy("comment"); setError("");
    try {
      await addClientComment(client.id, body);
      setDraft("");
      const activity = await fetchClientActivity(client.id);
      setComments(activity.comments);
      setClaim(activity.claim);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ التعليق.");
    } finally { setBusy(""); }
  };

  const toggleClaim = async (release: boolean) => {
    if (busy) return;
    setBusy("claim"); setError("");
    try {
      if (release) await releaseClient(client.id); else await claimClient(client.id);
      const activity = await fetchClientActivity(client.id);
      setClaim(activity.claim);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحديث متابعة العميل.");
    } finally { setBusy(""); }
  };

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    const replacing = replaceTarget;
    setReplaceTarget(null);
    setBusy(replacing ? replacing.id : "upload"); setError("");
    try {
      if (replacing) await replaceClientImage(replacing, client.id, file);
      else await uploadClientImage(client.id, file);
      setImages(await fetchClientImages(client.id));
      if (replacing && preview?.id === replacing.id) setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر رفع الصورة.");
    } finally { setBusy(""); }
  };

  const removeImage = async (image: ClientImage) => {
    if (busy) return;
    if (!window.confirm("حذف هذه الصورة نهائياً؟")) return;
    setBusy(image.id); setError("");
    try {
      await deleteClientImage(image);
      setImages(current => current.filter(row => row.id !== image.id));
      if (preview?.id === image.id) setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حذف الصورة.");
    } finally { setBusy(""); }
  };

  if (!client) return null;
  const isMine = claim?.employeeId === userId;
  const address = client.address;
  const addressLine = address ? [
    address.governorate, address.area, address.sector && `قطاع ${address.sector}`,
    address.distribution && `توزيع ${address.distribution}`, address.block && `قطعة ${address.block}`,
    address.street, address.avenue, address.building && `مبنى ${address.building}`,
    address.floor && `دور ${address.floor}`, address.apartment && `شقة ${address.apartment}`,
    address.postalCode && `بريدي ${address.postalCode}`, address.landmark,
  ].filter(Boolean).join(" · ") : "";

  return (
    <motion.div
      className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-2 backdrop-blur-sm sm:p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
        className="glass panel flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden"
      >
        <header className="flex items-center gap-2 border-b border-slate-200/60 px-3 py-3 dark:border-slate-700 sm:px-5">
          <button
            type="button" onClick={() => onIndexChange(index - 1)} disabled={!previous}
            aria-label="العميل السابق" title="العميل السابق (السهم الأيمن)"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200/70 text-slate-600 transition hover:bg-white/70 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          ><ChevronRight size={20} /></button>
          <div className="min-w-0 flex-1 text-center">
            <h2 className="truncate text-sm font-black">{client.name}</h2>
            <div className="mt-0.5 text-[10px] text-slate-400">
              {index + 1} من {clients.length} · {client.source || "مصدر غير محدد"}
            </div>
          </div>
          <button
            type="button" onClick={() => onIndexChange(index + 1)} disabled={!next}
            aria-label="العميل التالي" title="العميل التالي (السهم الأيسر)"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200/70 text-slate-600 transition hover:bg-white/70 disabled:opacity-30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          ><ChevronLeft size={20} /></button>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-white/70 dark:hover:bg-slate-800"><X size={18} /></button>
        </header>

        <div className="grid flex-1 gap-4 overflow-y-auto p-4 sm:p-5 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-3">
            <div className="flex items-start gap-3 rounded-2xl bg-white/40 p-3 dark:bg-slate-900/30">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600"><UserRound size={22} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-slate-400">{client.source || "مصدر غير محدد"}</div>
                {(client.sourceNames ?? []).length > 0 && (
                  <div className="mt-1 text-[10px] leading-5 text-slate-500">أسماء أخرى: {(client.sourceNames ?? []).join("، ")}</div>
                )}
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-teal-50/70 px-2.5 py-2 dark:bg-teal-950/25">
                  <span className="text-[10px] font-bold">{claim ? `قيد المتابعة: ${claim.employeeName}` : "متاح لمندوب المبيعات"}</span>
                  {isMine
                    ? <button type="button" disabled={busy === "claim"} onClick={() => void toggleClaim(true)} className="rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-bold text-teal-700 disabled:opacity-50">إنهاء التعامل</button>
                    : !claim
                      ? <button type="button" disabled={busy === "claim"} onClick={() => void toggleClaim(false)} className="rounded-lg bg-teal-600 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-50">إضافته لمفضلتي</button>
                      : null}
                </div>
              </div>
            </div>

            {addressLine && <p className="rounded-xl bg-violet-50/50 p-3 text-[11px] leading-6 text-slate-600 dark:bg-violet-950/20 dark:text-slate-300">{addressLine}</p>}

            <div className="space-y-2">
              <h3 className="text-[11px] font-extrabold">بيانات التواصل</h3>
              {phones.length ? phones.map((phone, position) => {
                const digits = dialable(phone);
                return (
                  <div key={`${phone}-${position}`} className="flex items-center gap-2 rounded-xl bg-slate-100/60 p-2 dark:bg-slate-800/60">
                    <a href={`tel:+${digits}`} className="flex flex-1 items-center gap-2 px-1 py-1" dir="ltr">
                      <span className="text-sm font-black tabular-nums tracking-tight">{formatPhone(digits)}</span>
                      <Phone size={14} className="text-teal-600" />
                    </a>
                    <a href={`tel:+${digits}`} className="rounded-lg bg-teal-500/10 px-3 py-1.5 text-[10px] font-bold text-teal-700">اتصال</a>
                    <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold text-emerald-700"><MessageCircle size={13} />واتساب</a>
                  </div>
                );
              }) : <p className="rounded-xl bg-slate-100 px-3 py-2 text-[10px] text-slate-500">لا يوجد رقم هاتف مسجل لهذا العميل.</p>}
            </div>

            {(client.tags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {client.tags.map(tag => <span key={tag} className="rounded-full bg-violet-50 px-2 py-1 text-[9px] text-violet-700">{tag}</span>)}
              </div>
            )}

            {client.notes && <p className="rounded-xl bg-slate-100/60 p-3 text-[10px] leading-5 text-slate-500 dark:bg-slate-800/50">{client.notes}</p>}
          </section>

          <section className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-extrabold">صور العميل <span className="text-slate-400">({images.length})</span></h3>
                {canManage && (
                  <>
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={event => void pickFile(event)} />
                    <button
                      type="button" disabled={busy === "upload"} onClick={() => fileRef.current?.click()}
                      className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-[10px] font-bold text-white disabled:opacity-50"
                    >
                      {busy === "upload" ? <LoaderCircle size={13} className="animate-spin" /> : <ImagePlus size={13} />} إضافة صورة
                    </button>
                  </>
                )}
              </div>
              {images.length ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {images.map(image => (
                    <div key={image.id} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200/70 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                      <button type="button" onClick={() => setPreview(image)} className="h-full w-full">
                        {image.url
                          ? <img src={image.url} alt={image.caption || client.name} className="h-full w-full object-cover" loading="lazy" />
                          : <span className="grid h-full w-full place-items-center text-[9px] text-slate-400">تعذر التحميل</span>}
                      </button>
                      {canManage && (
                        <div className="absolute left-1 top-1 flex gap-1">
                          <button
                            type="button" onClick={() => { setReplaceTarget(image); fileRef.current?.click(); }} disabled={Boolean(busy)}
                            aria-label="استبدال الصورة" title="استبدال الصورة"
                            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-950/60 text-white opacity-90 transition hover:bg-teal-600 disabled:opacity-50"
                          >{busy === image.id ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}</button>
                          <button
                            type="button" onClick={() => void removeImage(image)} disabled={Boolean(busy)}
                            aria-label="حذف الصورة" title="حذف الصورة"
                            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-950/60 text-white opacity-90 transition hover:bg-rose-600 disabled:opacity-50"
                          >{busy === image.id ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-300/70 px-3 py-6 text-center text-[10px] text-slate-400 dark:border-slate-700">
                  {canManage ? "لا توجد صور بعد. اضغط «إضافة صورة» لإرفاق صورة لهذا العميل." : "لا توجد صور لهذا العميل."}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/60 p-3 dark:border-slate-700">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-extrabold">تعليقات الفريق</h3>
                <span className="text-[9px] text-slate-400">{comments.length} تعليق</span>
              </div>
              <div className="mb-2 max-h-56 space-y-2 overflow-y-auto">
                {comments.map(comment => (
                  <div key={comment.id} className="rounded-lg bg-white/60 p-2 dark:bg-slate-900/50">
                    <div className="text-[10px] leading-5">{comment.body}</div>
                    <div className="mt-1 text-[9px] text-slate-400">{comment.authorName} · {new Date(comment.createdAt).toLocaleString("ar-KW")}</div>
                  </div>
                ))}
                {!comments.length && <p className="text-[10px] text-slate-400">لا توجد تعليقات بعد. أول تعليق يظهر لكل الفريق.</p>}
              </div>
              <textarea
                value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} rows={2}
                placeholder="اكتب تعليقاً يراه فريق العمل…"
                className="focus-ring w-full rounded-lg border border-slate-200 bg-white/70 p-2 text-[10px] outline-none dark:border-slate-700 dark:bg-slate-900"
              />
              <button
                type="button" disabled={draft.trim().length < 2 || busy === "comment"} onClick={() => void submitComment()}
                className="mt-2 flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-40 dark:bg-slate-700"
              >
                {busy === "comment" && <LoaderCircle size={13} className="animate-spin" />} إضافة تعليق للفريق
              </button>
            </div>

            {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[10px] text-rose-600 dark:bg-rose-950/30">{error}</p>}
          </section>
        </div>
      </motion.div>

      {preview && (
        <div className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/80 p-4" onMouseDown={event => event.target === event.currentTarget && setPreview(null)}>
          <div className="relative max-h-full max-w-3xl">
            {preview.url && <img src={preview.url} alt={client.name} className="max-h-[85vh] rounded-2xl object-contain" />}
            <button type="button" onClick={() => setPreview(null)} aria-label="إغلاق الصورة" className="absolute -top-3 left-0 grid h-9 w-9 place-items-center rounded-full bg-white text-slate-900 shadow"><X size={17} /></button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
