"use client";

import type { InputHTMLAttributes } from "react";
import { optionLabel, type CodeLists, type CodeOption } from "@/lib/code-lists";

type Props = {
  /** Field id from CODE_FIELDS (e.g. "area", "block"). */
  field: string;
  lists: CodeLists;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Values used when the admin has not coded this field yet. */
  fallback?: string[];
  /** First option of the dropdown (e.g. "أي منطقة"); defaults to an empty "—". */
  emptyLabel?: string;
  /** Hide the empty option (the field always has a value). */
  required?: boolean;
  disabled?: boolean;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

/**
 * A field that becomes a dropdown as soon as the admin adds codes for it in
 * Settings, and stays a plain text box otherwise. A stored value that is not
 * in the list is kept as an extra option so editing never loses data.
 */
export function CodedInput({ field, lists, value, onChange, className, fallback, emptyLabel, required, disabled, inputProps }: Props) {
  const coded = lists[field];
  const options: CodeOption[] = coded?.length ? coded : (fallback ?? []).map(item => ({ value: item, code: null }));
  if (!options.length) {
    return <input value={value} onChange={e => onChange(e.target.value)} disabled={disabled} className={className} {...inputProps}/>;
  }
  const known = !value || options.some(option => option.value === value);
  return <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled} className={className}>
    {!required && <option value="">{emptyLabel ?? "—"}</option>}
    {!known && <option value={value}>{value}</option>}
    {options.map(option => <option key={option.value} value={option.value}>{optionLabel(option)}</option>)}
  </select>;
}
