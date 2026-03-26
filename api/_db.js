const dns = require('dns');
const { Pool } = require('pg');

if (!process.env.VERCEL) {
  try {
    require('dotenv').config({ path: '.env.local' });
  } catch (_) {
    // Ignore dotenv load issues in restricted runtimes.
  }
}

function sanitizeConnectionString(value = '') {
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getConnectionStringCandidates() {
  const candidates = [
    sanitizeConnectionString(process.env.DATABASE_URL),
    sanitizeConnectionString(process.env.POSTGRES_URL),
  ].filter(Boolean);

  return candidates.filter((candidate) => {
    try {
      new URL(candidate);
      return true;
    } catch (_) {
      return false;
    }
  });
}

const connectionStringCandidates = getConnectionStringCandidates();
let poolPromise = null;

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (_) {
  // Ignore DNS server override failures in restricted runtimes.
}

async function createPoolForConnectionString(connectionString) {
  const url = new URL(connectionString);
  const originalHost = url.hostname;

  try {
    await dns.promises.lookup(originalHost);
    return new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10,
      maxUses: 7500,
    });
  } catch (error) {
    let resolvedIps = [];
    try {
      resolvedIps = await dns.promises.resolve4(originalHost);
    } catch (_) {
      // Try IPv6 when IPv4 records are unavailable.
    }

    if (!resolvedIps.length) {
      try {
        const resolvedIpv6 = await dns.promises.resolve6(originalHost);
        resolvedIps = resolvedIpv6;
      } catch (_) {
        // Fall through and rethrow the original DNS error.
      }
    }

    if (!resolvedIps.length) {
      throw error;
    }

    const fallbackUrl = new URL(connectionString);
    fallbackUrl.hostname = resolvedIps[0];
    fallbackUrl.searchParams.delete('sslmode');
    fallbackUrl.searchParams.delete('channel_binding');

    return new Pool({
      connectionString: fallbackUrl.toString(),
      ssl: {
        rejectUnauthorized: false,
        servername: originalHost,
      },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10,
      maxUses: 7500,
    });
  }
}

async function createPool() {
  if (!connectionStringCandidates.length) {
    throw new Error('DATABASE_URL/POSTGRES_URL is not configured');
  }

  let lastError = null;
  for (const candidate of connectionStringCandidates) {
    try {
      const pool = await createPoolForConnectionString(candidate);
      await pool.query('SELECT 1');
      return pool;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to connect using configured database URLs');
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = createPool();
  }
  return poolPromise;
}

async function query(text, params) {
  try {
    const pool = await getPool();
    return await pool.query(text, params);
  } catch (error) {
    const transientCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT']);
    const code = error && error.code ? String(error.code) : '';

    if (!transientCodes.has(code)) {
      throw error;
    }

    // Recreate pool once for transient DNS/network errors.
    const oldPool = await poolPromise.catch(() => null);
    poolPromise = createPool();
    const retryPool = await getPool();
    const result = await retryPool.query(text, params);
    if (oldPool && typeof oldPool.end === 'function') {
      oldPool.end().catch(() => {});
    }
    return result;
  }
}

module.exports = { query, getPool };
