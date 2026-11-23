import type { AuthorizedUserRecord } from '../types/erp';

export interface ERPUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'partner';
  title: string;
  phone: string;
  avatarBg: string;
}

export const MAIN_ADMIN_EMAIL = 'jesusalbertocesararanda@gmail.com';
export const SECONDARY_ADMIN_EMAIL = 'x4sportvefutbol@gmail.com';
export const AUTHORIZED_ADMIN_EMAILS: readonly string[] = [
  MAIN_ADMIN_EMAIL,
  SECONDARY_ADMIN_EMAIL,
  'jesus@x4sport.app',
];

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function hashPasswordSha256Sync(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

export async function hashPasswordSha256Async(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const encoded = new TextEncoder().encode(input);
    const buffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return hashPasswordSha256Sync(input);
}

export function verifyUserPassword(
  plainPassword: string,
  record: Pick<AuthorizedUserRecord, 'password' | 'passwordHash'>,
): boolean {
  if (!plainPassword) return false;
  if (typeof record.passwordHash === 'string' && record.passwordHash.trim().length > 0) {
    return hashPasswordSha256Sync(plainPassword) === record.passwordHash.trim().toLowerCase();
  }
  if (typeof record.password === 'string' && record.password.length > 0) {
    return record.password === plainPassword;
  }
  return false;
}

export const DEFAULT_AUTHORIZED_USERS: readonly AuthorizedUserRecord[] = [
  {
    id: 'user-jesus-main',
    email: MAIN_ADMIN_EMAIL,
    name: 'Jesús César',
    role: 'admin',
    title: 'Administrador Principal',
    phone: '+58 412-4612132',
    passwordHash: '632be5e7df180b51682e87b6a1ece695c8662a782dd6ea3597b63e3cd88a567c',
    firstLoginPending: false,
    avatarBg: 'bg-blue-600',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'user-jesus-x4sportve',
    email: SECONDARY_ADMIN_EMAIL,
    name: 'Jesús César (X4SPORT)',
    role: 'admin',
    title: 'Administrador Principal',
    phone: '+58 412-4612132',
    passwordHash: '632be5e7df180b51682e87b6a1ece695c8662a782dd6ea3597b63e3cd88a567c',
    firstLoginPending: false,
    avatarBg: 'bg-blue-600',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'user-jesus-alias',
    email: 'jesus@x4sport.app',
    name: 'Jesús César',
    role: 'admin',
    title: 'Administrador Principal',
    phone: '+58 412-4612132',
    passwordHash: '632be5e7df180b51682e87b6a1ece695c8662a782dd6ea3597b63e3cd88a567c',
    firstLoginPending: false,
    avatarBg: 'bg-blue-600',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'user-josue',
    email: 'josue@x4sport.app',
    name: 'Josué Ojeda',
    role: 'partner',
    title: 'Socio Operativo',
    phone: '+58 412-4588754',
    passwordHash: '0c7039d7128c3899d661eb3602ea6baa1330d2c4f0d1b6a0f59c9238f48348e9',
    firstLoginPending: false,
    avatarBg: 'bg-emerald-600',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'user-gabriel',
    email: 'gabriel@x4sport.app',
    name: 'Gabriel Guevara',
    role: 'partner',
    title: 'Socio Operativo',
    phone: '+58 412-0000000',
    passwordHash: '303ef03c7d48380e69e60df18b0f8e1645416eddec1cc7071d330032ed2562fe',
    firstLoginPending: false,
    avatarBg: 'bg-indigo-600',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
] as const;

export const ERP_USERS: readonly ERPUser[] = DEFAULT_AUTHORIZED_USERS.map((u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  title: u.title || 'Socio ERP',
  phone: u.phone || '',
  avatarBg: u.avatarBg || 'bg-blue-600',
}));

export const SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_USER_STORAGE_KEY = 'x4sport_active_user_v1';
export const LAST_ACTIVITY_STORAGE_KEY = 'x4sport_last_activity_v1';
export const AUTHORIZED_USERS_STORAGE_KEY = 'x4sport_authorized_users_v2';
export const OTP_STORAGE_KEY = 'x4sport_otp_pending_v2';


export function getAuthorizedUsersFromStorage(): AuthorizedUserRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [...DEFAULT_AUTHORIZED_USERS];
  }
  try {
    const raw = window.localStorage.getItem(AUTHORIZED_USERS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_AUTHORIZED_USERS];
    const parsed = JSON.parse(raw) as AuthorizedUserRecord[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Merge with defaults to guarantee main admin is always present
      const map = new Map<string, AuthorizedUserRecord>();
      for (const def of DEFAULT_AUTHORIZED_USERS) {
        map.set(def.email.toLowerCase(), { ...def });
      }
      for (const item of parsed) {
        if (item && item.email) {
          map.set(item.email.toLowerCase(), { ...item });
        }
      }
      return Array.from(map.values());
    }
  } catch {
    // Ignore error
  }
  return [...DEFAULT_AUTHORIZED_USERS];
}

export function saveAuthorizedUsersToStorage(users: AuthorizedUserRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(AUTHORIZED_USERS_STORAGE_KEY, JSON.stringify(users));
  } catch {
    // Ignore error
  }
}

export function getMergedAuthorizedUsers(stateUsers?: AuthorizedUserRecord[]): AuthorizedUserRecord[] {
  const map = new Map<string, AuthorizedUserRecord>();
  // 1. Defaults
  for (const def of DEFAULT_AUTHORIZED_USERS) {
    map.set(def.email.toLowerCase(), { ...def });
  }
  // 2. Local storage cache
  const localList = getAuthorizedUsersFromStorage();
  for (const loc of localList) {
    map.set(loc.email.toLowerCase(), { ...loc });
  }
  // 3. State users (synced via Firebase / AppState)
  if (Array.isArray(stateUsers)) {
    for (const su of stateUsers) {
      if (su && su.email) {
        map.set(su.email.toLowerCase(), { ...su });
      }
    }
  }
  return Array.from(map.values());
}

export function findAuthorizedUser(
  email: string,
  stateUsers?: AuthorizedUserRecord[],
): AuthorizedUserRecord | undefined {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return undefined;
  const list = getMergedAuthorizedUsers(stateUsers);
  return list.find((u) => u.email.toLowerCase() === cleanEmail);
}

export function isSessionExpired(
  lastActivityMs: number | null | undefined,
  nowMs = Date.now(),
  timeoutMs = SESSION_IDLE_TIMEOUT_MS,
): boolean {
  if (
    typeof lastActivityMs !== 'number' ||
    !Number.isFinite(lastActivityMs) ||
    lastActivityMs <= 0
  ) {
    return true;
  }
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    return true;
  }
  return nowMs - lastActivityMs >= timeoutMs;
}

export function getStoredLastActivityMs(): number | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function touchUserActivity(nowMs = Date.now()): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || nowMs <= 0) {
    return;
  }
  try {
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(nowMs));
  } catch {
    // Ignore storage quota or access errors
  }
}

export function getStoredActiveUser(nowMs = Date.now()): ERPUser | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ERPUser;
    if (!parsed || typeof parsed.email !== 'string') {
      storeActiveUser(null);
      return null;
    }

    const lastActivityMs = getStoredLastActivityMs();
    if (isSessionExpired(lastActivityMs, nowMs)) {
      storeActiveUser(null);
      return null;
    }

    touchUserActivity(nowMs);

    const match = findAuthorizedUser(parsed.email);
    if (match) {
      return {
        id: match.id,
        email: match.email,
        name: match.name,
        role: match.role,
        title:
          match.title ||
          (match.role === 'admin' ? 'Administrador Principal' : 'Socio Operativo'),
        phone: match.phone || '',
        avatarBg: match.avatarBg || 'bg-blue-600',
      };
    }
    return parsed;
  } catch {
    // Ignore parse error
  }
  return null;
}

export function storeActiveUser(user: ERPUser | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!user) {
      window.localStorage.removeItem(ACTIVE_USER_STORAGE_KEY);
      window.localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_USER_STORAGE_KEY, JSON.stringify(user));
      window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

export const OTP_EXPIRATION_MS = 5 * 60 * 1000;
export const OTP_MAX_FAILED_ATTEMPTS = 5;

interface OtpStoreEntry {
  code: string;
  expiresAt: number;
  failedAttempts: number;
}

const inMemoryOtpStore = new Map<string, OtpStoreEntry>();

function readOtpEntry(cleanEmail: string): OtpStoreEntry | null {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const raw = window.sessionStorage.getItem(`${OTP_STORAGE_KEY}_${cleanEmail}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<OtpStoreEntry>;
        if (
          parsed &&
          typeof parsed.code === 'string' &&
          typeof parsed.expiresAt === 'number' &&
          Number.isFinite(parsed.expiresAt)
        ) {
          return {
            code: parsed.code,
            expiresAt: parsed.expiresAt,
            failedAttempts:
              typeof parsed.failedAttempts === 'number' &&
              Number.isFinite(parsed.failedAttempts)
                ? parsed.failedAttempts
                : 0,
          };
        }
      }
    } catch {
      // Ignore parse error and fallback to in-memory store
    }
  }
  return inMemoryOtpStore.get(cleanEmail) ?? null;
}

function writeOtpEntry(cleanEmail: string, entry: OtpStoreEntry): void {
  inMemoryOtpStore.set(cleanEmail, entry);
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(
        `${OTP_STORAGE_KEY}_${cleanEmail}`,
        JSON.stringify(entry),
      );
    } catch {
      // Ignore storage quota errors
    }
  }
}

export function clearOtpEntry(email: string): void {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return;
  inMemoryOtpStore.delete(cleanEmail);
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(`${OTP_STORAGE_KEY}_${cleanEmail}`);
    } catch {
      // Ignore storage errors
    }
  }
}

function generateSixDigitOtp(): string {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return String(100000 + (buf[0] % 900000));
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function generateOtpCode(email: string, nowMs = Date.now()): string {
  const cleanEmail = email.trim().toLowerCase();
  const code = generateSixDigitOtp();
  writeOtpEntry(cleanEmail, {
    code,
    expiresAt: nowMs + OTP_EXPIRATION_MS,
    failedAttempts: 0,
  });
  return code;
}

export function isAiStudioPreviewEnvironment(locationLike?: {
  hostname?: string;
}): boolean {
  const rawHost =
    locationLike?.hostname ??
    (typeof window !== 'undefined' ? window.location?.hostname : '') ??
    '';
  const hostname = rawHost.trim().toLowerCase();
  if (!hostname) return false;

  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.run.app') ||
    hostname.includes('ais-dev-') ||
    hostname.includes('ais-pre-') ||
    hostname.includes('aistudio.google.com') ||
    hostname.includes('googleusercontent.com')
  );
}

export interface OtpDeliveryResult {
  code: string;
  emailSent: boolean;
  showTemporaryCodeOnScreen: boolean;
  reason: 'preview_environment' | 'email_delivery_unavailable' | 'email_sent';
  message: string;
}

export function requestOtpDelivery(
  email: string,
  options?: {
    hostname?: string;
    emailTransportAvailable?: boolean;
    emailSendFailed?: boolean;
    nowMs?: number;
  },
): OtpDeliveryResult {
  const code = generateOtpCode(email, options?.nowMs);
  const inPreview = isAiStudioPreviewEnvironment(
    options?.hostname !== undefined ? { hostname: options.hostname } : undefined,
  );
  const transportAvailable = options?.emailTransportAvailable ?? false;
  const sendFailed = options?.emailSendFailed ?? !transportAvailable;
  const emailSent = transportAvailable && !sendFailed;
  // Seguridad crítica: jamás exponer el código OTP en pantalla fuera de vista previa AI Studio / localhost
  const showTemporaryCodeOnScreen = inPreview === true;

  const reason: OtpDeliveryResult['reason'] = inPreview
    ? 'preview_environment'
    : !emailSent
      ? 'email_delivery_unavailable'
      : 'email_sent';

  const message = inPreview
    ? 'Entorno de vista previa de AI Studio detectado: usa este código temporal en pantalla para iniciar sesión sin bloqueos.'
    : !emailSent
      ? 'No se pudo enviar el código OTP al correo autorizado. Ingresa con tu Contraseña o revisa la configuración de EmailJS en Configuración.'
      : `Código OTP enviado al correo autorizado (${email.trim()}).`;

  return {
    code,
    emailSent,
    showTemporaryCodeOnScreen,
    reason,
    message,
  };
}

export interface OtpEmailConfigInput {
  serviceId: string;
  templateId: string;
  publicKey: string;
}

export function resolveEmailJsConfig(
  config?: Partial<OtpEmailConfigInput>,
): OtpEmailConfigInput | null {
  const env =
    typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env!
      : {};

  const serviceId = (
    config?.serviceId ||
    env.VITE_EMAILJS_SERVICE_ID ||
    ''
  ).trim();
  const templateId = (
    config?.templateId ||
    env.VITE_EMAILJS_TEMPLATE_ID ||
    ''
  ).trim();
  const publicKey = (
    config?.publicKey ||
    env.VITE_EMAILJS_PUBLIC_KEY ||
    ''
  ).trim();

  if (!serviceId || !templateId || !publicKey) {
    return null;
  }

  return { serviceId, templateId, publicKey };
}

export async function sendOtpViaEmailJs(params: {
  toEmail: string;
  toName: string;
  otpCode: string;
  config?: OtpEmailConfigInput;
}): Promise<{ ok: boolean; error?: string }> {
  const resolved = resolveEmailJsConfig(params.config);
  if (!resolved) {
    return {
      ok: false,
      error:
        'EmailJS no está configurado (faltan Service ID, Template ID o Public Key).',
    };
  }

  const toEmail = params.toEmail.trim();
  const toName = params.toName.trim() || toEmail;
  const otpCode = params.otpCode.trim();
  if (!toEmail || !otpCode) {
    return {
      ok: false,
      error: 'Correo destino o código OTP inválido.',
    };
  }

  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        service_id: resolved.serviceId,
        template_id: resolved.templateId,
        user_id: resolved.publicKey,
        template_params: {
          to_email: toEmail,
          to_name: toName,
          otp_code: otpCode,
          app_name: 'X4SPORT ERP',
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        ok: false,
        error: detail
          ? `EmailJS rechazó el envío (${response.status}): ${detail}`
          : `EmailJS rechazó el envío (HTTP ${response.status}).`,
      };
    }

    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Error de red al enviar el código OTP vía EmailJS.',
    };
  }
}

export function verifyOtpCode(
  email: string,
  code: string,
  nowMs = Date.now(),
): boolean {
  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = code.trim();
  if (!cleanEmail || !cleanCode) return false;

  const entry = readOtpEntry(cleanEmail);
  if (!entry) return false;

  if (nowMs >= entry.expiresAt) {
    clearOtpEntry(cleanEmail);
    return false;
  }

  if (entry.failedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
    clearOtpEntry(cleanEmail);
    return false;
  }

  if (entry.code === cleanCode) {
    clearOtpEntry(cleanEmail);
    return true;
  }

  const nextFailed = entry.failedAttempts + 1;
  if (nextFailed >= OTP_MAX_FAILED_ATTEMPTS) {
    clearOtpEntry(cleanEmail);
  } else {
    writeOtpEntry(cleanEmail, {
      ...entry,
      failedAttempts: nextFailed,
    });
  }

  return false;
}

export function authenticateByPassword(
  email: string,
  pass: string,
  stateUsers?: AuthorizedUserRecord[],
): { ok: boolean; user?: ERPUser; error?: string; isFirstLoginPending?: boolean } {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPass = pass.trim();

  const record = findAuthorizedUser(cleanEmail, stateUsers);
  if (!record) {
    return {
      ok: false,
      error: `El correo "${email}" no está registrado en el sistema. Solicita al Administrador Principal (${MAIN_ADMIN_EMAIL}) que te pre-registre desde Configuración.`,
    };
  }

  if (record.firstLoginPending) {
    return {
      ok: false,
      isFirstLoginPending: true,
      error: `Es tu primer ingreso al sistema. Debes verificar el código OTP enviado a tu correo y configurar tu contraseña personal.`,
    };
  }

  if (!cleanPass) {
    return { ok: false, error: 'Ingresa tu contraseña de acceso.' };
  }

  if (verifyUserPassword(cleanPass, record)) {
    const erpUser: ERPUser = {
      id: record.id,
      email: record.email,
      name: record.name,
      role: record.role,
      title: record.title || (record.role === 'admin' ? 'Administrador Principal' : 'Socio Operativo'),
      phone: record.phone || '',
      avatarBg: record.avatarBg || (record.role === 'admin' ? 'bg-blue-600' : 'bg-emerald-600'),
    };
    return { ok: true, user: erpUser };
  }

  return { ok: false, error: 'Contraseña incorrecta. Verifica tus datos o ingresa mediante código OTP.' };
}

export function completeFirstTimeLogin(
  email: string,
  code: string,
  newPassword: string,
  stateUsers?: AuthorizedUserRecord[],
): { ok: boolean; user?: ERPUser; updatedUsers?: AuthorizedUserRecord[]; error?: string } {
  const cleanEmail = email.trim().toLowerCase();
  const record = findAuthorizedUser(cleanEmail, stateUsers);
  if (!record) {
    return { ok: false, error: 'Usuario no encontrado en los registros del sistema.' };
  }

  if (!verifyOtpCode(cleanEmail, code)) {
    return { ok: false, error: 'El código OTP ingresado es inválido o ha expirado.' };
  }

  if (!newPassword || newPassword.trim().length < 4) {
    return { ok: false, error: 'La nueva contraseña debe tener al menos 4 caracteres.' };
  }

  const passwordHash = hashPasswordSha256Sync(newPassword.trim());
  const allUsers = getMergedAuthorizedUsers(stateUsers);
  const updatedUsers: AuthorizedUserRecord[] = allUsers.map((u) => {
    if (u.email.toLowerCase() === cleanEmail) {
      const { password: _legacyPassword, ...rest } = u;
      return {
        ...rest,
        passwordHash,
        firstLoginPending: false,
      };
    }
    return u;
  });

  saveAuthorizedUsersToStorage(updatedUsers);

  const erpUser: ERPUser = {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
    title: record.title || (record.role === 'admin' ? 'Administrador Principal' : 'Socio Operativo'),
    phone: record.phone || '',
    avatarBg: record.avatarBg || (record.role === 'admin' ? 'bg-blue-600' : 'bg-emerald-600'),
  };

  return { ok: true, user: erpUser, updatedUsers };
}

export function isProtectedAdminEmail(email: string): boolean {
  const clean = email.trim().toLowerCase();
  return AUTHORIZED_ADMIN_EMAILS.includes(clean);
}

export function canAccessConfiguration(user: ERPUser | null | undefined): boolean {
  if (!user) return false;
  return isProtectedAdminEmail(user.email);
}

export function isAdminUser(user: ERPUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' || isProtectedAdminEmail(user.email);
}
