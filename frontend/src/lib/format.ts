import type { PixType } from '../types';

export function formatMoney(cents: number): string {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR');
}

export function formatCurrencyInput(value: string): string {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  digits = digits.replace(/^0+/, '');
  if (!digits) digits = '0';
  if (digits.length < 3) digits = digits.padStart(3, '0');
  return formatMoney(Number.parseInt(digits, 10));
}

export function centsFromCurrencyInput(value: string): number {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? Number.parseInt(digits, 10) : 0;
}

export function formatCpf(value: string): string {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  const p1 = digits.slice(0, 3);
  const p2 = digits.slice(3, 6);
  const p3 = digits.slice(6, 9);
  const p4 = digits.slice(9, 11);

  let output = '';
  if (p1) output = p1;
  if (p2) output += `.${p2}`;
  if (p3) output += `.${p3}`;
  if (p4) output += `-${p4}`;
  return output;
}

export function formatPhoneBr(value: string): string {
  const digits = String(value || '').replace(/\D/g, '').slice(-11);
  const hasNine = digits.length === 11;
  const ddd = digits.slice(0, 2);
  const middle = hasNine ? digits.slice(2, 7) : digits.slice(2, 6);
  const end = hasNine ? digits.slice(7) : digits.slice(6);

  let output = '';
  if (ddd) output = `(${ddd}`;
  if (ddd && (middle || end)) output += ') ';
  if (middle) output += middle;
  if (end) output += `-${end}`;
  return output;
}

export function normalizePixKeyByType(type: PixType | '', raw: string): string {
  let value = String(raw || '').trim();
  if (!value) return '';

  if (type === 'cpf' || type === 'phone') {
    value = value.replace(/\D/g, '');
  } else if (type === 'email') {
    value = value.toLowerCase();
  }

  return value;
}
