const PRIVATE_IPV4_REGEX =
  /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|0\.0\.0\.0)$/;

export function isDisallowedClientHost(hostname: string, allowLocalDev = false): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0'
  ) {
    return !allowLocalDev;
  }
  if (
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    host.endsWith('.arpa')
  ) {
    return true;
  }
  if (PRIVATE_IPV4_REGEX.test(host)) {
    return true;
  }
  if (/^(?:fc|fd|fe8|fe9|fea|feb)[0-9a-f]{1,2}:/i.test(host) || host.startsWith('::ffff:')) {
    return true;
  }
  return false;
}

export function parseStrictHttpsUrl(
  rawInput: string,
  options?: { allowBareHostname?: boolean; allowLocalHttp?: boolean }
): { ok: true; url: URL } | { ok: false; reasonCode: string; messageId: string; messageEn: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      ok: false,
      reasonCode: 'EMPTY_URL',
      messageId: 'Masukkan tautan video terlebih dahulu.',
      messageEn: 'Please paste a video URL first.',
    };
  }

  if (/[\u0000-\u001f\u007f]/.test(trimmed) || /\s/.test(trimmed)) {
    return {
      ok: false,
      reasonCode: 'MALFORMED_URL',
      messageId: 'Tautan mengandung spasi atau karakter kontrol yang tidak valid.',
      messageEn: 'URL contains invalid whitespace or control characters.',
    };
  }

  if (trimmed.length > 980) {
    return {
      ok: false,
      reasonCode: 'URL_TOO_LONG',
      messageId: 'Tautan terlalu panjang (maksimal 980 karakter).',
      messageEn: 'URL is too long (maximum 980 characters).',
    };
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('file:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('ftp:')
  ) {
    return {
      ok: false,
      reasonCode: 'UNSUPPORTED_SCHEME',
      messageId: 'Skema tautan tidak diizinkan. Hanya tautan HTTPS resmi yang diperbolehkan.',
      messageEn: 'URL scheme is not allowed. Only official HTTPS links are permitted.',
    };
  }

  const hasExplicitScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  if (!hasExplicitScheme && options?.allowBareHostname === false) {
    return {
      ok: false,
      reasonCode: 'MISSING_HTTPS',
      messageId: 'Tautan harus diawali dengan https://.',
      messageEn: 'URL must start with https://.',
    };
  }

  const candidate = hasExplicitScheme ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      reasonCode: 'INVALID_URL',
      messageId: 'Format URL tidak valid.',
      messageEn: 'Invalid URL syntax.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reasonCode: 'CREDENTIALS_IN_URL',
      messageId: 'Tautan tidak boleh menyertakan username atau password.',
      messageEn: 'URLs with embedded credentials are not allowed.',
    };
  }

  const isLocalHost =
    parsed.hostname.toLowerCase() === 'localhost' || parsed.hostname === '127.0.0.1';
  const allowLocal = Boolean(options?.allowLocalHttp && isLocalHost);

  if (parsed.protocol !== 'https:' && !(allowLocal && parsed.protocol === 'http:')) {
    return {
      ok: false,
      reasonCode: 'HTTPS_REQUIRED',
      messageId: 'Hanya protokol HTTPS yang diizinkan untuk tautan video eksternal.',
      messageEn: 'Only HTTPS URLs are permitted for external video links.',
    };
  }

  if (isDisallowedClientHost(parsed.hostname, allowLocal)) {
    return {
      ok: false,
      reasonCode: 'PRIVATE_OR_LOCAL_HOST_BLOCKED',
      messageId: 'Alamat jaringan lokal atau IP internal tidak diizinkan.',
      messageEn: 'Local network or private IP addresses are not permitted.',
    };
  }

  if (!parsed.hostname.includes('.') && !allowLocal) {
    return {
      ok: false,
      reasonCode: 'INVALID_HOST',
      messageId: 'Domain pada tautan tidak valid.',
      messageEn: 'Invalid domain name in URL.',
    };
  }

  return { ok: true, url: parsed };
}
