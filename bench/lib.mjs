// Shared helpers for the benchmark scripts. No dependencies beyond Node 20+.

export function parseArgs(argv, defaults) {
  const values = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument "${argument}"`);
    }
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!(key in defaults)) {
      throw new Error(`Unknown option "${argument}". Known: ${Object.keys(defaults).map(toFlag).join(', ')}`);
    }
    const next = argv[index + 1];
    if (typeof defaults[key] === 'boolean') {
      values[key] = next === 'false' ? false : true;
      if (next === 'true' || next === 'false') index += 1;
      continue;
    }
    if (next === undefined) {
      throw new Error(`Missing value for ${argument}`);
    }
    index += 1;
    values[key] = typeof defaults[key] === 'number' ? Number(next) : next;
  }
  return values;
}

function toFlag(key) {
  return `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function summarize(rawValues) {
  const values = rawValues.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (values.length === 0) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    min: round(values[0]),
    p50: round(percentile(values, 0.5)),
    p90: round(percentile(values, 0.9)),
    p95: round(percentile(values, 0.95)),
    p99: round(percentile(values, 0.99)),
    max: round(values.at(-1)),
    mean: round(mean)
  };
}

// Nearest-rank percentile on a sorted array.
export function percentile(sortedValues, quantile) {
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * quantile) - 1)];
}

export function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 100) / 100;
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function formatSummary(label, summary, unit = 'ms') {
  if (!summary) {
    return `${label}: no samples`;
  }
  return `${label}: n=${summary.count} p50=${summary.p50}${unit} p95=${summary.p95}${unit} ` +
    `p99=${summary.p99}${unit} max=${summary.max}${unit}`;
}

/**
 * Minimal cookie-aware client for the Spring Boot API, matching what the browser app does:
 * guest sign-in, then a CSRF token for every mutation.
 */
export class ApiSession {
  constructor(origin) {
    this.origin = origin.replace(/\/+$/, '');
    this.cookies = new Map();
    this.csrfHeader = '';
    this.csrfToken = '';
    this.session = null;
  }

  async signIn(displayName) {
    this.session = await this.request('POST', '/api/auth/guest', { displayName });
    const csrf = await this.request('GET', '/api/auth/csrf');
    this.csrfHeader = csrf.headerName;
    this.csrfToken = csrf.token;
    return this.session;
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, body, headers = {}) {
    return this.request('POST', path, body, headers);
  }

  async request(method, path, body, extraHeaders = {}) {
    const headers = new Headers(extraHeaders);
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (method !== 'GET' && this.csrfHeader) headers.set(this.csrfHeader, this.csrfToken);
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const response = await fetch(`${this.origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
}
