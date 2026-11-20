"use client";

import type { Property } from "@/lib/types";
import type { ExportRow } from "@/lib/property-data";

const headers = ["الرمز", "اسم العميل", "رقم التليفون", "رقم ٢", "رقم ٣", "نوع العقار", "نوع العرض", "المنطقة", "القطاع", "التوزيع", "القطعة", "القسيمة", "الشارع", "الجادة", "نوع الموقع", "التوابع", "المساحة م²", "السعر د.ك", "الحالة", "الموظف", "تاريخ الإدخال", "التفاصيل", "رابط الخريطة"];

const mapLink = (lat: number | null | undefined, lng: number | null | undefined) =>
  lat !== null && lat !== undefined && lng !== null && lng !== undefined ? `https://maps.google.com/?q=${lat},${lng}` : "";

function fromExportRow(r: ExportRow) {
  return [r.code, r.client, r.phone_1 ?? "", r.phone_2 ?? "", r.phone_3 ?? "", r.type, r.offer, r.area, r.sector, r.distribution, r.block, r.plot, r.street, r.avenue, r.location_type, r.annexes, r.size === null ? "" : Number(r.size), r.price === null ? "" : Number(r.price), r.status, r.employee, r.entry_date, r.details, mapLink(r.latitude, r.longitude)];
}

function fromProperty(p: Property) {
  const status = p.status === "available" ? "متاح" : p.status === "sold" ? "مباع" : "مفقود";
  return [p.code, p.client, p.phones[0] ?? "", p.phones[1] ?? "", p.phones[2] ?? "", p.type, p.offer, p.area, p.sector ?? "", p.distribution ?? "", p.block, p.plot, p.street, p.avenue ?? "", p.locationType, p.annexes ?? "", p.size, p.price ?? "", status, p.employee, p.date, p.details, mapLink(p.latitude, p.longitude)];
}

/** Writes every plot (with its phone numbers) to an .xlsx file the browser downloads. */
export async function downloadPropertiesWorkbook(rows: ExportRow[] | Property[], remote: boolean) {
  const XLSX = await import("xlsx");
  const body = remote ? (rows as ExportRow[]).map(fromExportRow) : (rows as Property[]).map(fromProperty);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body]);
  sheet["!cols"] = headers.map(h => ({ wch: h === "التفاصيل" ? 50 : h === "رابط الخريطة" ? 38 : Math.max(10, h.length + 4) }));
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: headers.length - 1 } }) };
  const book = XLSX.utils.book_new();
  book.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(book, sheet, "كل القطع");
  XLSX.writeFile(book, `كل-القطع-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
