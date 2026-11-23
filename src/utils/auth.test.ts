import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_USER_STORAGE_KEY,
  authenticateByPassword,
  canAccessConfiguration,
  clearOtpEntry,
  completeFirstTimeLogin,
  DEFAULT_AUTHORIZED_USERS,
  findAuthorizedUser,
  generateOtpCode,
  getStoredActiveUser,
  getStoredLastActivityMs,
  hashPasswordSha256Async,
  hashPasswordSha256Sync,
  isAdminUser,
  isAiStudioPreviewEnvironment,
  isSessionExpired,
  LAST_ACTIVITY_STORAGE_KEY,
  MAIN_ADMIN_EMAIL,
  OTP_EXPIRATION_MS,
  OTP_MAX_FAILED_ATTEMPTS,
  requestOtpDelivery,
  SECONDARY_ADMIN_EMAIL,
  sendOtpViaEmailJs,
  SESSION_IDLE_TIMEOUT_MS,
  storeActiveUser,
  verifyOtpCode,
  type ERPUser,
} from './auth';
import type { AuthorizedUserRecord } from '../types/erp';

test('auth: MAIN_ADMIN_EMAIL is jesusalbertocesararanda@gmail.com', () => {
  assert.equal(MAIN_ADMIN_EMAIL, 'jesusalbertocesararanda@gmail.com');
  const mainAdmin = DEFAULT_AUTHORIZED_USERS.find(
    (u) => u.email === MAIN_ADMIN_EMAIL,
  );
  assert.ok(mainAdmin, 'Main admin must exist in default authorized users');
  assert.equal(mainAdmin?.role, 'admin');
});

test('auth: canAccessConfiguration strictly enforces main admin email', () => {
  const mainAdminUser: ERPUser = {
    id: 'u-main',
    email: 'jesusalbertocesararanda@gmail.com',
    name: 'Jesús César',
    role: 'admin',
    title: 'Administrador Principal',
    phone: '',
    avatarBg: 'bg-blue-600',
  };
  const aliasUser: ERPUser = {
    id: 'u-alias',
    email: 'jesus@x4sport.app',
    name: 'Jesús César',
    role: 'admin',
    title: 'Administrador Principal',
    phone: '',
    avatarBg: 'bg-blue-600',
  };
  const partnerUser: ERPUser = {
    id: 'u-partner',
    email: 'josue@x4sport.app',
    name: 'Josué Ojeda',
    role: 'partner',
    title: 'Socio Operativo',
    phone: '',
    avatarBg: 'bg-emerald-600',
  };
  const otherAdmin: ERPUser = {
    id: 'u-other',
    email: 'otheradmin@x4sport.app',
    name: 'Otro Admin',
    role: 'admin',
    title: 'Administrador',
    phone: '',
    avatarBg: 'bg-indigo-600',
  };

  assert.equal(canAccessConfiguration(mainAdminUser), true);
  assert.equal(canAccessConfiguration(aliasUser), true);
  assert.equal(canAccessConfiguration(partnerUser), false);
  assert.equal(canAccessConfiguration(otherAdmin), false);
  assert.equal(canAccessConfiguration(null), false);
  assert.equal(canAccessConfiguration(undefined), false);
});

test('auth: isAdminUser permits admin roles', () => {
  const partnerUser: ERPUser = {
    id: 'u-partner',
    email: 'josue@x4sport.app',
    name: 'Josué Ojeda',
    role: 'partner',
    title: 'Socio Operativo',
    phone: '',
    avatarBg: 'bg-emerald-600',
  };
  const adminUser: ERPUser = {
    id: 'u-admin',
    email: 'jesusalbertocesararanda@gmail.com',
    name: 'Jesús César',
    role: 'admin',
    title: 'Administrador Principal',
    phone: '',
    avatarBg: 'bg-blue-600',
  };

  assert.equal(isAdminUser(adminUser), true);
  assert.equal(isAdminUser(partnerUser), false);
  assert.equal(isAdminUser(null), false);
});

test('auth: authenticateByPassword rejects unregistered emails', () => {
  const res = authenticateByPassword('unknown@x4sport.app', 'pass123');
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes('no está registrado'));
});

test('auth: authenticateByPassword detects firstLoginPending', () => {
  const preRegistered: AuthorizedUserRecord[] = [
    {
      id: 'user-new',
      email: 'newuser@x4sport.app',
      name: 'Nuevo Socio',
      role: 'partner',
      firstLoginPending: true,
      createdAt: '2026-11-17T00:00:00.000Z',
    },
  ];

  const res = authenticateByPassword('newuser@x4sport.app', 'anypass', preRegistered);
  assert.equal(res.ok, false);
  assert.equal(res.isFirstLoginPending, true);
  assert.ok(res.error?.includes('primer ingreso'));
});

test('auth: authenticateByPassword validates correct credentials', () => {
  const res = authenticateByPassword('jesusalbertocesararanda@gmail.com', 'jesus2026');
  assert.equal(res.ok, true);
  assert.equal(res.user?.email, 'jesusalbertocesararanda@gmail.com');
  assert.equal(res.user?.role, 'admin');

  const badRes = authenticateByPassword('jesusalbertocesararanda@gmail.com', 'wrongpassword');
  assert.equal(badRes.ok, false);
  assert.ok(badRes.error?.includes('Contraseña incorrecta'));
});

test('auth: completeFirstTimeLogin verifies OTP and saves new password hash', () => {
  const preRegistered: AuthorizedUserRecord[] = [
    {
      id: 'user-test',
      email: 'testpartner@x4sport.app',
      name: 'Test Partner',
      role: 'partner',
      firstLoginPending: true,
      createdAt: '2026-11-17T00:00:00.000Z',
    },
  ];

  const otpCode = generateOtpCode('testpartner@x4sport.app');
  const res = completeFirstTimeLogin(
    'testpartner@x4sport.app',
    otpCode,
    'mypassword2026',
    preRegistered,
  );

  assert.equal(res.ok, true);
  assert.equal(res.user?.email, 'testpartner@x4sport.app');
  assert.ok(res.updatedUsers, 'updatedUsers must be returned');

  const updatedTarget = res.updatedUsers?.find(
    (u) => u.email === 'testpartner@x4sport.app',
  );
  assert.equal(updatedTarget?.firstLoginPending, false);
  assert.equal(updatedTarget?.password, undefined);
  assert.equal(
    updatedTarget?.passwordHash,
    hashPasswordSha256Sync('mypassword2026'),
  );

  const loginRes = authenticateByPassword(
    'testpartner@x4sport.app',
    'mypassword2026',
    res.updatedUsers,
  );
  assert.equal(loginRes.ok, true);
});

test('auth: x4sportvefutbol@gmail.com is included as authorized admin', () => {
  assert.equal(SECONDARY_ADMIN_EMAIL, 'x4sportvefutbol@gmail.com');
  const found = findAuthorizedUser('x4sportvefutbol@gmail.com');
  assert.ok(found, 'x4sportvefutbol@gmail.com must exist in authorized users');
  assert.equal(found?.role, 'admin');

  const authRes = authenticateByPassword('x4sportvefutbol@gmail.com', 'jesus2026');
  assert.equal(authRes.ok, true);
  assert.equal(authRes.user?.email, 'x4sportvefutbol@gmail.com');
  assert.equal(authRes.user?.role, 'admin');
  assert.equal(canAccessConfiguration(authRes.user), true);
  assert.equal(isAdminUser(authRes.user), true);
});

test('auth: isAiStudioPreviewEnvironment detects AI Studio preview and localhost hosts', () => {
  assert.equal(
    isAiStudioPreviewEnvironment({
      hostname: 'ais-dev-dl25afluqelxchfuitfvuh-351640450641.us-west1.run.app',
    }),
    true,
  );
  assert.equal(
    isAiStudioPreviewEnvironment({
      hostname: 'ais-pre-dl25afluqelxchfuitfvuh-351640450641.us-west1.run.app',
    }),
    true,
  );
  assert.equal(isAiStudioPreviewEnvironment({ hostname: 'localhost' }), true);
  assert.equal(
    isAiStudioPreviewEnvironment({ hostname: 'erp.x4sport.com' }),
    false,
  );
});

test('auth: requestOtpDelivery shows temporary code ONLY in AI Studio preview and NEVER in production even when email fails', () => {
  const previewDelivery = requestOtpDelivery('x4sportvefutbol@gmail.com', {
    hostname: 'ais-dev-dl25afluqelxchfuitfvuh-351640450641.us-west1.run.app',
    emailTransportAvailable: true,
    emailSendFailed: false,
  });
  assert.match(previewDelivery.code, /^\d{6}$/);
  assert.equal(previewDelivery.showTemporaryCodeOnScreen, true);
  assert.equal(previewDelivery.reason, 'preview_environment');

  for (const prodHost of ['erp.x4sport.com', 'x4sport.workers.dev', 'x4sport.pages.dev']) {
    const failedEmailDelivery = requestOtpDelivery('x4sportvefutbol@gmail.com', {
      hostname: prodHost,
      emailTransportAvailable: true,
      emailSendFailed: true,
    });
    assert.match(failedEmailDelivery.code, /^\d{6}$/);
    assert.equal(failedEmailDelivery.emailSent, false);
    assert.equal(failedEmailDelivery.showTemporaryCodeOnScreen, false);
    assert.equal(failedEmailDelivery.reason, 'email_delivery_unavailable');
    assert.equal(failedEmailDelivery.message.includes(failedEmailDelivery.code), false);

    const noTransportDelivery = requestOtpDelivery('x4sportvefutbol@gmail.com', {
      hostname: prodHost,
      emailTransportAvailable: false,
    });
    assert.equal(noTransportDelivery.emailSent, false);
    assert.equal(noTransportDelivery.showTemporaryCodeOnScreen, false);
    assert.equal(noTransportDelivery.reason, 'email_delivery_unavailable');
  }

  const prodEmailSent = requestOtpDelivery('x4sportvefutbol@gmail.com', {
    hostname: 'erp.x4sport.com',
    emailTransportAvailable: true,
    emailSendFailed: false,
  });
  assert.equal(prodEmailSent.emailSent, true);
  assert.equal(prodEmailSent.showTemporaryCodeOnScreen, false);
  assert.equal(prodEmailSent.reason, 'email_sent');
});

test('auth: verifyOtpCode rejects hardcoded 123456, enforces 5-minute TTL and 5 failed attempts lockout', () => {
  assert.equal(
    verifyOtpCode('jesusalbertocesararanda@gmail.com', '123456'),
    false,
  );

  const t0 = 1_700_000_000_000;
  const generated = generateOtpCode('josue@x4sport.app', t0);
  if (generated !== '123456') {
    assert.equal(verifyOtpCode('josue@x4sport.app', '123456', t0 + 1000), false);
  }
  assert.equal(verifyOtpCode('josue@x4sport.app', generated, t0 + OTP_EXPIRATION_MS - 1), true);
  // Single-use: second verification with same code fails
  assert.equal(verifyOtpCode('josue@x4sport.app', generated, t0 + OTP_EXPIRATION_MS - 1), false);

  // Expiration at 5 minutes
  const expiringCode = generateOtpCode('gabriel@x4sport.app', t0);
  assert.equal(OTP_EXPIRATION_MS, 5 * 60 * 1000);
  assert.equal(
    verifyOtpCode('gabriel@x4sport.app', expiringCode, t0 + OTP_EXPIRATION_MS),
    false,
  );

  // Max 5 failed attempts invalidates valid code
  assert.equal(OTP_MAX_FAILED_ATTEMPTS, 5);
  const lockedCode = generateOtpCode('locktest@x4sport.app', t0);
  const wrongCode = lockedCode === '000000' ? '999999' : '000000';
  for (let i = 0; i < OTP_MAX_FAILED_ATTEMPTS; i += 1) {
    assert.equal(verifyOtpCode('locktest@x4sport.app', wrongCode, t0 + 1000), false);
  }
  // Even with the real code on 6th attempt, it was invalidated
  assert.equal(verifyOtpCode('locktest@x4sport.app', lockedCode, t0 + 2000), false);
  clearOtpEntry('locktest@x4sport.app');
});

test('auth: sendOtpViaEmailJs posts expected JSON payload and handles errors safely', async () => {
  const missingRes = await sendOtpViaEmailJs({
    toEmail: 'jesusalbertocesararanda@gmail.com',
    toName: 'Jesús César',
    otpCode: '654321',
  });
  assert.equal(missingRes.ok, false);

  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      text: async () => 'OK',
    } as Response;
  }) as typeof fetch;

  try {
    const okRes = await sendOtpViaEmailJs({
      toEmail: 'jesusalbertocesararanda@gmail.com',
      toName: 'Jesús César',
      otpCode: '654321',
      config: {
        serviceId: 'service_x4sport',
        templateId: 'template_otp',
        publicKey: 'pub_key_123',
      },
    });
    assert.equal(okRes.ok, true);
    assert.equal(capturedUrl, 'https://api.emailjs.com/api/v1.0/email/send');
    assert.equal(capturedInit?.method, 'POST');
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    assert.equal(body.service_id, 'service_x4sport');
    assert.equal(body.template_id, 'template_otp');
    assert.equal(body.user_id, 'pub_key_123');
    assert.deepEqual(body.template_params, {
      to_email: 'jesusalbertocesararanda@gmail.com',
      to_name: 'Jesús César',
      otp_code: '654321',
      app_name: 'X4SPORT ERP',
    });

    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 400,
        text: async () => 'Invalid template',
      }) as Response) as typeof fetch;

    const failRes = await sendOtpViaEmailJs({
      toEmail: 'jesusalbertocesararanda@gmail.com',
      toName: 'Jesús César',
      otpCode: '654321',
      config: {
        serviceId: 'service_x4sport',
        templateId: 'template_otp',
        publicKey: 'pub_key_123',
      },
    });
    assert.equal(failRes.ok, false);
    assert.ok(failRes.error?.includes('400'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('auth: DEFAULT_AUTHORIZED_USERS stores SHA-256 hashes without plaintext passwords', () => {
  for (const user of DEFAULT_AUTHORIZED_USERS) {
    assert.equal(user.password, undefined);
    assert.match(user.passwordHash ?? '', /^[a-f0-9]{64}$/);
  }
});

test('auth: SHA-256 sync matches Web Crypto digest and keeps legacy plaintext compatibility', async () => {
  const syncHash = hashPasswordSha256Sync('jesus2026');
  const asyncHash = await hashPasswordSha256Async('jesus2026');
  assert.equal(syncHash, asyncHash);

  const legacyUsers: AuthorizedUserRecord[] = [
    {
      id: 'user-legacy',
      email: 'legacy@x4sport.app',
      name: 'Socio Legado',
      role: 'partner',
      password: 'legacyPlainPassword2026',
      firstLoginPending: false,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ];

  const okRes = authenticateByPassword(
    'legacy@x4sport.app',
    'legacyPlainPassword2026',
    legacyUsers,
  );
  assert.equal(okRes.ok, true);
  assert.equal(okRes.user?.email, 'legacy@x4sport.app');

  const badRes = authenticateByPassword(
    'legacy@x4sport.app',
    'wrongPass',
    legacyUsers,
  );
  assert.equal(badRes.ok, false);
});

test('auth: isSessionExpired validates 24-hour idle boundary and invalid timestamps', () => {
  assert.equal(SESSION_IDLE_TIMEOUT_MS, 24 * 60 * 60 * 1000);
  const baseMs = 1_700_000_000_000;
  const within23h59m = baseMs + (23 * 60 + 59) * 60 * 1000;
  const exact24h = baseMs + SESSION_IDLE_TIMEOUT_MS;
  const over24h = baseMs + SESSION_IDLE_TIMEOUT_MS + 1;

  assert.equal(isSessionExpired(baseMs, within23h59m), false);
  assert.equal(isSessionExpired(baseMs, exact24h), true);
  assert.equal(isSessionExpired(baseMs, over24h), true);

  assert.equal(isSessionExpired(null, baseMs), true);
  assert.equal(isSessionExpired(undefined, baseMs), true);
  assert.equal(isSessionExpired(0, baseMs), true);
  assert.equal(isSessionExpired(-100, baseMs), true);
  assert.equal(isSessionExpired(Number.NaN, baseMs), true);
});

test('auth: storeActiveUser and getStoredActiveUser enforce 24h timeout and clean localStorage', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const storageMap = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
  };

  (globalThis as { window?: unknown }).window = {
    localStorage: mockLocalStorage,
  };

  try {
    const sampleUser: ERPUser = {
      id: 'user-jesus-main',
      email: MAIN_ADMIN_EMAIL,
      name: 'Jesús César',
      role: 'admin',
      title: 'Administrador Principal',
      phone: '+58 412-4612132',
      avatarBg: 'bg-blue-600',
    };

    const startTime = Date.now();
    storeActiveUser(sampleUser);
    assert.ok(storageMap.has(ACTIVE_USER_STORAGE_KEY));
    assert.ok(storageMap.has(LAST_ACTIVITY_STORAGE_KEY));
    const initialLastActivity = getStoredLastActivityMs();
    assert.ok(initialLastActivity !== null && initialLastActivity >= startTime);

    // Within 23h 59m: session stays active and refreshes timestamp
    const at23h59m = (initialLastActivity ?? startTime) + (23 * 60 + 59) * 60 * 1000;
    const activeUser = getStoredActiveUser(at23h59m);
    assert.ok(activeUser);
    assert.equal(activeUser?.email, MAIN_ADMIN_EMAIL);
    assert.equal(getStoredLastActivityMs(), at23h59m);

    // After 24h + 1ms from refreshed timestamp: session expires and clears storage
    const after24h = at23h59m + SESSION_IDLE_TIMEOUT_MS + 1;
    const expiredUser = getStoredActiveUser(after24h);
    assert.equal(expiredUser, null);
    assert.equal(storageMap.has(ACTIVE_USER_STORAGE_KEY), false);
    assert.equal(storageMap.has(LAST_ACTIVITY_STORAGE_KEY), false);

    // Missing or invalid timestamp with stored user expires immediately and clears storage
    storeActiveUser(sampleUser);
    storageMap.delete(LAST_ACTIVITY_STORAGE_KEY);
    assert.equal(getStoredActiveUser(Date.now()), null);
    assert.equal(storageMap.has(ACTIVE_USER_STORAGE_KEY), false);

    storeActiveUser(sampleUser);
    storageMap.set(LAST_ACTIVITY_STORAGE_KEY, 'not-a-number');
    assert.equal(getStoredActiveUser(Date.now()), null);
    assert.equal(storageMap.has(ACTIVE_USER_STORAGE_KEY), false);
    assert.equal(storageMap.has(LAST_ACTIVITY_STORAGE_KEY), false);

    // storeActiveUser(null) removes both keys
    storeActiveUser(sampleUser);
    assert.equal(storageMap.has(ACTIVE_USER_STORAGE_KEY), true);
    assert.equal(storageMap.has(LAST_ACTIVITY_STORAGE_KEY), true);
    storeActiveUser(null);
    assert.equal(storageMap.has(ACTIVE_USER_STORAGE_KEY), false);
    assert.equal(storageMap.has(LAST_ACTIVITY_STORAGE_KEY), false);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
});

