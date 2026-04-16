import type { PixType } from '../types';

function toAsciiUpper(value: string): string {
  const normalized = value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return normalized
    .replace(/[^A-Za-z0-9 .,_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function cleanPixKey(value: string): string {
  let key = String(value || '').trim();
  if (/^\+?\d[\d\s().-]*$/.test(key)) {
    key = key.replace(/\D/g, '');
  }
  return key;
}

function tlv(id: string, value: string): string {
  const content = String(value ?? '');
  return `${id}${String(content.length).padStart(2, '0')}${content}`;
}

function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function formatPixPhone(value: string): string {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) {
    digits = `55${digits}`;
  }
  return `+${digits}`;
}

export function buildPixPayload(input: {
  chave: string;
  valorCents: number;
  nome: string;
  cidade?: string;
  txid?: string;
  tipo?: PixType;
}): string {
  const { chave, valorCents, nome, cidade = 'BRASILIA', txid = '***', tipo = null } = input;

  const normalizedKey =
    tipo === 'phone'
      ? formatPixPhone(chave)
      : tipo === 'cpf'
        ? String(chave || '').replace(/\D/g, '')
        : cleanPixKey(chave);

  const receiverName = toAsciiUpper(nome || 'RECEBEDOR').slice(0, 25) || 'RECEBEDOR';
  const receiverCity = toAsciiUpper(cidade).slice(0, 15) || 'BRASILIA';
  const safeTxid =
    txid === '***'
      ? '***'
      : String(txid)
          .replace(/[^A-Za-z0-9.-]/g, '')
          .slice(0, 25) || '***';

  const merchantAccountInfo = tlv(
    '26',
    tlv('00', 'br.gov.bcb.pix') + tlv('01', normalizedKey)
  );

  const payloadWithoutCrc =
    tlv('00', '01') +
    tlv('01', '11') +
    merchantAccountInfo +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', (Number(valorCents || 0) / 100).toFixed(2)) +
    tlv('58', 'BR') +
    tlv('59', receiverName) +
    tlv('60', receiverCity) +
    tlv('62', tlv('05', safeTxid)) +
    '6304';

  return payloadWithoutCrc + crc16Ccitt(payloadWithoutCrc);
}
