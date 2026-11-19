export function formatPhone(digits: string) {
  return digits.length === 11 && digits.startsWith("965")
    ? `+965 ${digits.slice(3, 7)} ${digits.slice(7)}`
    : `+${digits}`;
}

export function dialable(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("965")) return digits;
  return digits.length === 8 ? `965${digits}` : digits;
}
