// src/db.js
// TokenPulse: SQLite Database Layer, Enterprise Schema, Migrations, and Analytics

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PRICING, calculateCost } from './pricing.js';
import { DEFAULT_TEAMS, DEFAULT_FEATURES } from './attribution.js';
import { DEFAULT_BUDGETS } from './budgets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'proxy.db');
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

// Initialize or migrate schema
export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      iso_timestamp TEXT NOT NULL,
      team TEXT NOT NULL,
      feature TEXT NOT NULL,
      user_id TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'simulated',
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL,
      prompt_cost REAL NOT NULL,
      completion_cost REAL NOT NULL,
      cached_cost REAL NOT NULL DEFAULT 0.0,
      total_cost REAL NOT NULL,
      latency_ms INTEGER NOT NULL,
      status_code INTEGER NOT NULL DEFAULT 200,
      is_stream INTEGER NOT NULL DEFAULT 0,
      is_simulated INTEGER NOT NULL DEFAULT 1,
      usage_source TEXT NOT NULL DEFAULT 'simulated',
      pricing_version TEXT NOT NULL DEFAULT 'v1',
      prompt_preview TEXT,
      response_preview TEXT,
      raw_metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
    CREATE INDEX IF NOT EXISTS idx_requests_team ON requests(team);
    CREATE INDEX IF NOT EXISTS idx_requests_feature ON requests(feature);
    CREATE INDEX IF NOT EXISTS idx_requests_model ON requests(model);
    CREATE INDEX IF NOT EXISTS idx_requests_provider ON requests(provider);
    CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);

    CREATE TABLE IF NOT EXISTS pricing (
      model_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_cost_per_million REAL NOT NULL,
      output_cost_per_million REAL NOT NULL,
      cached_cost_per_million REAL NOT NULL DEFAULT 0.0,
      context_window INTEGER NOT NULL DEFAULT 128000,
      currency TEXT NOT NULL DEFAULT 'USD',
      version TEXT NOT NULL DEFAULT '2026-Q1',
      source TEXT NOT NULL DEFAULT 'Standard Pricing Table',
      verified INTEGER NOT NULL DEFAULT 1,
      last_verified_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      team_id TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      period TEXT NOT NULL DEFAULT 'monthly',
      limit_usd REAL NOT NULL,
      alert_threshold REAL NOT NULL DEFAULT 0.80,
      enforcement_mode TEXT NOT NULL DEFAULT 'monitor',
      updated_at TEXT NOT NULL
    );
  `);

  // Migrate columns if table already existed from earlier run
  try {
    db.exec(`ALTER TABLE requests ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE requests ADD COLUMN cached_cost REAL NOT NULL DEFAULT 0.0;`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE requests ADD COLUMN is_simulated INTEGER NOT NULL DEFAULT 1;`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE requests ADD COLUMN usage_source TEXT NOT NULL DEFAULT 'simulated';`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE requests ADD COLUMN pricing_version TEXT NOT NULL DEFAULT 'v1';`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE pricing ADD COLUMN cached_cost_per_million REAL NOT NULL DEFAULT 0.0;`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE pricing ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE pricing ADD COLUMN version TEXT NOT NULL DEFAULT '2026-Q1';`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE pricing ADD COLUMN source TEXT NOT NULL DEFAULT 'Standard Pricing Table';`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE pricing ADD COLUMN verified INTEGER NOT NULL DEFAULT 1;`);
  } catch (e) { /* column exists */ }

  // Seed default pricing if empty
  const pCount = db.prepare('SELECT COUNT(*) as count FROM pricing').get().count;
  if (pCount === 0) {
    const insertPricing = db.prepare(`
      INSERT INTO pricing (
        model_id, display_name, provider, input_cost_per_million, output_cost_per_million,
        cached_cost_per_million, context_window, currency, version, source, verified, last_verified_at, active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const p of DEFAULT_PRICING) {
      insertPricing.run(
        p.model_id, p.display_name, p.provider, p.input_cost_per_million, p.output_cost_per_million,
        p.cached_cost_per_million || 0.0, p.context_window, p.currency || 'USD',
        p.version || '2026-Q1', p.source || 'Standard Pricing', p.verified ?? 1,
        p.last_verified_at || now, 1, now
      );
    }
  }

  // Ensure all existing pricing rows have latest cached rates and metadata
  const updatePricingStmt = db.prepare(`
    UPDATE pricing SET 
      cached_cost_per_million = ?,
      currency = ?,
      version = ?,
      source = ?,
      verified = ?
    WHERE model_id = ?
  `);
  for (const p of DEFAULT_PRICING) {
    updatePricingStmt.run(
      p.cached_cost_per_million || 0.0,
      p.currency || 'USD',
      p.version || '2026-Q1',
      p.source || 'Standard Pricing',
      p.verified ?? 1,
      p.model_id
    );
  }

  // Seed default teams if empty
  const tCount = db.prepare('SELECT COUNT(*) as count FROM teams').get().count;
  if (tCount === 0) {
    const insertTeam = db.prepare('INSERT INTO teams (id, name, description, created_at) VALUES (?, ?, ?, ?)');
    const now = new Date().toISOString();
    for (const t of DEFAULT_TEAMS) {
      insertTeam.run(t.id, t.name, t.description, now);
    }
  }

  // Seed default features if empty
  const fCount = db.prepare('SELECT COUNT(*) as count FROM features').get().count;
  if (fCount === 0) {
    const insertFeat = db.prepare('INSERT INTO features (id, name, team_id, description, created_at) VALUES (?, ?, ?, ?, ?)');
    const now = new Date().toISOString();
    for (const f of DEFAULT_FEATURES) {
      insertFeat.run(f.id, f.name, f.team_id, f.description, now);
    }
  }

  // Seed default budgets if empty
  const bCount = db.prepare('SELECT COUNT(*) as count FROM budgets').get().count;
  if (bCount === 0) {
    const insertBudget = db.prepare(`
      INSERT INTO budgets (id, entity_type, entity_id, period, limit_usd, alert_threshold, enforcement_mode, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const b of DEFAULT_BUDGETS) {
      insertBudget.run(b.id, b.entity_type, b.entity_id, b.period, b.limit_usd, b.alert_threshold, b.enforcement_mode, now);
    }
  }
}

// Log a single LLM request
export function logRequest(req) {
  const stmt = db.prepare(`
    INSERT INTO requests (
      id, timestamp, iso_timestamp, team, feature, user_id, model, provider,
      prompt_tokens, completion_tokens, cached_tokens, total_tokens,
      prompt_cost, completion_cost, cached_cost, total_cost,
      latency_ms, status_code, is_stream, is_simulated, usage_source, pricing_version,
      prompt_preview, response_preview, raw_metadata
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    req.id,
    req.timestamp,
    req.iso_timestamp,
    req.team,
    req.feature,
    req.user_id,
    req.model,
    req.provider || 'simulated',
    req.prompt_tokens,
    req.completion_tokens,
    req.cached_tokens || 0,
    req.total_tokens,
    req.prompt_cost,
    req.completion_cost,
    req.cached_cost || 0.0,
    req.total_cost,
    req.latency_ms,
    req.status_code || 200,
    req.is_stream ? 1 : 0,
    req.is_simulated ? 1 : 0,
    req.usage_source || 'simulated',
    req.pricing_version || 'v1',
    req.prompt_preview || '',
    req.response_preview || '',
    req.raw_metadata || '{}'
  );

  return req;
}

// Fetch single request by ID for inspection / replay
export function getRequestById(id) {
  const stmt = db.prepare('SELECT * FROM requests WHERE id = ?');
  return stmt.get(id);
}

// Entity queries
export function getTeams() {
  return db.prepare('SELECT * FROM teams ORDER BY name ASC').all();
}

export function getFeatures() {
  return db.prepare('SELECT * FROM features ORDER BY name ASC').all();
}

export function getPricingTable() {
  return db.prepare('SELECT * FROM pricing WHERE active = 1 ORDER BY display_name ASC').all();
}

export function updatePricing(modelId, inputCost, outputCost, cachedCost = 0.0) {
  const stmt = db.prepare(`
    UPDATE pricing 
    SET input_cost_per_million = ?, output_cost_per_million = ?, cached_cost_per_million = ?, updated_at = ?
    WHERE model_id = ?
  `);
  stmt.run(Number(inputCost), Number(outputCost), Number(cachedCost), new Date().toISOString(), modelId);
  return { modelId, inputCost, outputCost, cachedCost };
}

export function upsertPricing(data) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO pricing (
      model_id, display_name, provider, input_cost_per_million, output_cost_per_million,
      cached_cost_per_million, context_window, currency, version, source, verified, last_verified_at, active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    data.model_id,
    data.display_name || data.model_id,
    data.provider || 'Custom',
    Number(data.input_cost_per_million),
    Number(data.output_cost_per_million),
    Number(data.cached_cost_per_million || 0.0),
    Number(data.context_window || 128000),
    data.currency || 'USD',
    data.version || 'custom',
    data.source || 'Admin Configured',
    data.verified ?? 1,
    new Date().toISOString(),
    1,
    new Date().toISOString()
  );
  return data;
}

// Helper to safely parse timestamp from number, numeric string, or ISO string
export function parseTimestamp(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') {
    return isNaN(val) ? null : val;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      return isNaN(num) ? null : num;
    }
    const parsed = new Date(trimmed).getTime();
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

// Helper to resolve dynamic time window boundaries
export function resolveTimeBounds(filters = {}) {
  let { startDate, endDate, timeWindow, time } = filters;
  const windowType = timeWindow || time;

  const now = Date.now();
  if (windowType === '24h') {
    startDate = now - 24 * 60 * 60 * 1000;
  } else if (windowType === '7d') {
    startDate = now - 7 * 24 * 60 * 60 * 1000;
  } else if (windowType === '30d') {
    startDate = now - 30 * 24 * 60 * 60 * 1000;
  } else if (windowType === 'all') {
    startDate = undefined;
    endDate = undefined;
  }

  const startMs = parseTimestamp(startDate);
  const endMs = parseTimestamp(endDate);

  return { startMs, endMs, windowType };
}

// Helper to build chronological timeline series with zero-filling
export function buildTimelineSeries(rawRows, windowType, startMs, endMs) {
  const rowsMap = new Map();
  for (const r of rawRows) {
    rowsMap.set(r.time_label, r);
  }

  const now = endMs || Date.now();
  const buckets = [];

  if (windowType === '24h') {
    // 24 hourly buckets
    const startHour = new Date(now - 23 * 3600 * 1000);
    startHour.setMinutes(0, 0, 0);

    for (let i = 0; i < 24; i++) {
      const bucketDate = new Date(startHour.getTime() + i * 3600 * 1000);
      const year = bucketDate.getFullYear();
      const month = String(bucketDate.getMonth() + 1).padStart(2, '0');
      const day = String(bucketDate.getDate()).padStart(2, '0');
      const hour = String(bucketDate.getHours()).padStart(2, '0');
      const label = `${year}-${month}-${day} ${hour}:00`;

      const found = rowsMap.get(label);
      buckets.push({
        time_label: label,
        requests: found ? found.requests : 0,
        total_tokens: found ? found.total_tokens : 0,
        prompt_tokens: found ? found.prompt_tokens : 0,
        completion_tokens: found ? found.completion_tokens : 0,
        cached_tokens: found ? found.cached_tokens : 0,
        total_cost: found ? Number(Number(found.total_cost).toFixed(6)) : 0
      });
    }
  } else if (windowType === '7d' || windowType === '30d') {
    const daysCount = windowType === '7d' ? 7 : 30;
    const startDay = new Date(now - (daysCount - 1) * 24 * 3600 * 1000);
    startDay.setHours(0, 0, 0, 0);

    for (let i = 0; i < daysCount; i++) {
      const bucketDate = new Date(startDay.getTime() + i * 24 * 3600 * 1000);
      const year = bucketDate.getFullYear();
      const month = String(bucketDate.getMonth() + 1).padStart(2, '0');
      const day = String(bucketDate.getDate()).padStart(2, '0');
      const label = `${year}-${month}-${day}`;

      const found = rowsMap.get(label);
      buckets.push({
        time_label: label,
        requests: found ? found.requests : 0,
        total_tokens: found ? found.total_tokens : 0,
        prompt_tokens: found ? found.prompt_tokens : 0,
        completion_tokens: found ? found.completion_tokens : 0,
        cached_tokens: found ? found.cached_tokens : 0,
        total_cost: found ? Number(Number(found.total_cost).toFixed(6)) : 0
      });
    }
  } else {
    // All Time (or custom bounds)
    if (rawRows.length === 0) {
      return [];
    }
    buckets.push(...rawRows.map(r => ({
      ...r,
      total_cost: Number(Number(r.total_cost).toFixed(6))
    })));
  }

  return buckets;
}

// Helper to build SQL WHERE clause
function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.team && filters.team !== 'all') {
    conditions.push('team = ? COLLATE NOCASE');
    params.push(filters.team);
  }
  if (filters.feature && filters.feature !== 'all') {
    conditions.push('feature = ? COLLATE NOCASE');
    params.push(filters.feature);
  }
  if (filters.model && filters.model !== 'all') {
    conditions.push('model = ? COLLATE NOCASE');
    params.push(filters.model);
  }
  if (filters.provider && filters.provider !== 'all') {
    conditions.push('provider = ? COLLATE NOCASE');
    params.push(filters.provider);
  }
  if (filters.user && filters.user !== 'all') {
    conditions.push('user_id = ? COLLATE NOCASE');
    params.push(filters.user);
  }

  const { startMs, endMs, windowType } = resolveTimeBounds(filters);
  if (startMs !== null) {
    conditions.push('timestamp >= ?');
    params.push(startMs);
  }
  if (endMs !== null) {
    conditions.push('timestamp <= ?');
    params.push(endMs);
  }

  if (filters.search) {
    conditions.push('(user_id LIKE ? OR prompt_preview LIKE ? OR id LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereSql, params, startMs, endMs, windowType };
}

// Fetch paginated requests
export function getRequests(filters = {}) {
  const limit = Math.min(250, Math.max(1, Number(filters.limit) || 50));
  const page = Math.max(1, Number(filters.page) || 1);
  const offset = (page - 1) * limit;

  const { whereSql, params } = buildWhereClause(filters);

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM requests ${whereSql}`);
  const total = countStmt.get(...params).total;

  const listStmt = db.prepare(`
    SELECT * FROM requests
    ${whereSql}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `);
  const records = listStmt.all(...params, limit, offset);

  return {
    records,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
}

// Comprehensive Analytics Aggregator
export function getAnalytics(filters = {}) {
  const { whereSql, params, startMs, endMs, windowType } = buildWhereClause(filters);

  // 1. Summary Metrics
  const summaryStmt = db.prepare(`
    SELECT 
      COUNT(*) as total_requests,
      COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as failed_requests,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(cached_tokens), 0) as cached_tokens,
      COALESCE(SUM(total_cost), 0.0) as total_cost,
      COALESCE(AVG(latency_ms), 0) as avg_latency_ms,
      COUNT(DISTINCT team) as unique_teams,
      COUNT(DISTINCT feature) as unique_features,
      COUNT(DISTINCT user_id) as unique_users,
      COUNT(DISTINCT model) as unique_models,
      COUNT(DISTINCT provider) as unique_providers
    FROM requests
    ${whereSql}
  `);
  const summary = summaryStmt.get(...params);
  summary.total_cost = Number(Number(summary.total_cost).toFixed(6));
  summary.avg_latency_ms = Math.round(summary.avg_latency_ms);
  summary.error_rate_pct = summary.total_requests > 0 
    ? Number(((summary.failed_requests / summary.total_requests) * 100).toFixed(2))
    : 0;
  summary.avg_cost_per_request = summary.total_requests > 0
    ? Number((summary.total_cost / summary.total_requests).toFixed(6))
    : 0;

  const totalCost = summary.total_cost > 0 ? summary.total_cost : 1;

  // 2. Breakdown by Team
  const teamStmt = db.prepare(`
    SELECT 
      team,
      COUNT(*) as requests,
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(cached_tokens), 0) as cached_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(total_cost), 0.0) as total_cost,
      COUNT(DISTINCT user_id) as active_users
    FROM requests
    ${whereSql}
    GROUP BY team
    ORDER BY total_cost DESC
  `);
  const by_team = teamStmt.all(...params).map(row => ({
    ...row,
    total_cost: Number(Number(row.total_cost).toFixed(6)),
    cost_percentage: Number(((row.total_cost / totalCost) * 100).toFixed(2)),
    avg_cost_per_request: row.requests > 0 ? Number((row.total_cost / row.requests).toFixed(6)) : 0
  }));

  // 3. Breakdown by Feature
  const featureStmt = db.prepare(`
    SELECT 
      feature,
      team,
      COUNT(*) as requests,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(total_cost), 0.0) as total_cost
    FROM requests
    ${whereSql}
    GROUP BY feature, team
    ORDER BY total_cost DESC
    LIMIT 25
  `);
  const by_feature = featureStmt.all(...params).map(row => ({
    ...row,
    total_cost: Number(Number(row.total_cost).toFixed(6)),
    cost_percentage: Number(((row.total_cost / totalCost) * 100).toFixed(2)),
    avg_cost_per_request: row.requests > 0 ? Number((row.total_cost / row.requests).toFixed(6)) : 0
  }));

  // 4. Breakdown by Model
  const modelStmt = db.prepare(`
    SELECT 
      model,
      provider,
      COUNT(*) as requests,
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(cached_tokens), 0) as cached_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(total_cost), 0.0) as total_cost,
      COALESCE(AVG(latency_ms), 0) as avg_latency
    FROM requests
    ${whereSql}
    GROUP BY model, provider
    ORDER BY total_cost DESC
  `);
  const by_model = modelStmt.all(...params).map(row => ({
    ...row,
    total_cost: Number(Number(row.total_cost).toFixed(6)),
    avg_latency: Math.round(row.avg_latency),
    cost_percentage: Number(((row.total_cost / totalCost) * 100).toFixed(2)),
    cost_per_thousand_tokens: row.total_tokens > 0 
      ? Number(((row.total_cost / row.total_tokens) * 1000).toFixed(6))
      : 0
  }));

  // 5. Breakdown by Provider
  const providerStmt = db.prepare(`
    SELECT 
      provider,
      COUNT(*) as requests,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(total_cost), 0.0) as total_cost,
      SUM(CASE WHEN is_simulated = 1 THEN 1 ELSE 0 END) as simulated_requests,
      SUM(CASE WHEN is_simulated = 0 THEN 1 ELSE 0 END) as real_requests
    FROM requests
    ${whereSql}
    GROUP BY provider
    ORDER BY total_cost DESC
  `);
  const by_provider = providerStmt.all(...params).map(row => ({
    ...row,
    total_cost: Number(Number(row.total_cost).toFixed(6)),
    cost_percentage: Number(((row.total_cost / totalCost) * 100).toFixed(2))
  }));

  // 6. Breakdown by User (Top Spenders)
  const userStmt = db.prepare(`
    SELECT 
      user_id,
      team,
      COUNT(*) as requests,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(total_cost), 0.0) as total_cost
    FROM requests
    ${whereSql}
    GROUP BY user_id, team
    ORDER BY total_cost DESC
    LIMIT 20
  `);
  const by_user = userStmt.all(...params).map(row => ({
    ...row,
    total_cost: Number(Number(row.total_cost).toFixed(6))
  }));

  // 7. Time Series
  const effectiveWindow = windowType || (startMs && !endMs && (Date.now() - startMs) <= 36 * 3600 * 1000 ? '24h' : (startMs ? 'custom' : 'all'));
  const isHourly = effectiveWindow === '24h';
  const strftimeFormat = isHourly ? '%Y-%m-%d %H:00' : '%Y-%m-%d';

  const timeStmt = db.prepare(`
    SELECT 
      strftime('${strftimeFormat}', datetime(timestamp / 1000, 'unixepoch', 'localtime')) as time_label,
      COUNT(*) as requests,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(cached_tokens), 0) as cached_tokens,
      COALESCE(SUM(total_cost), 0.0) as total_cost
    FROM requests
    ${whereSql}
    GROUP BY time_label
    ORDER BY time_label ASC
  `);
  const rawRows = timeStmt.all(...params);
  const time_series = buildTimelineSeries(rawRows, effectiveWindow, startMs, endMs);

  // Filter dropdown options
  const teamsStmt = db.prepare('SELECT DISTINCT team FROM requests ORDER BY team ASC');
  const featuresStmt = db.prepare('SELECT DISTINCT feature FROM requests ORDER BY feature ASC');
  const modelsStmt = db.prepare('SELECT DISTINCT model FROM requests ORDER BY model ASC');
  const providersStmt = db.prepare('SELECT DISTINCT provider FROM requests ORDER BY provider ASC');
  const usersStmt = db.prepare('SELECT DISTINCT user_id FROM requests ORDER BY user_id ASC LIMIT 50');

  // Reconciliation audit check
  const teamSumCost = by_team.reduce((acc, t) => acc + t.total_cost, 0);
  const reconciliationDelta = Math.abs(summary.total_cost - teamSumCost);
  const isReconciled = reconciliationDelta < 0.000005;

  return {
    summary,
    by_team,
    by_feature,
    by_model,
    by_provider,
    by_user,
    time_series,
    reconciliation: {
      isReconciled,
      summaryTotal: summary.total_cost,
      teamSumTotal: Number(teamSumCost.toFixed(6)),
      delta: Number(reconciliationDelta.toFixed(6))
    },
    filter_options: {
      teams: teamsStmt.all().map(r => r.team),
      features: featuresStmt.all().map(r => r.feature),
      models: modelsStmt.all().map(r => r.model),
      providers: providersStmt.all().map(r => r.provider),
      users: usersStmt.all().map(r => r.user_id)
    }
  };
}

// Clear requests
export function clearRequests() {
  db.exec('DELETE FROM requests');
  return { success: true };
}

// Seed realistic enterprise traffic
export function seedSampleData(count = 100) {
  const teams = [
    { name: 'Core Engineering', features: ['Code Review Assistant', 'Architecture Copilot', 'CI Bug Triager'], users: ['alex.dev', 'sarah.lead', 'jordan.eng', 'priya.sre'] },
    { name: 'Customer Support', features: ['Ticket Summarizer', 'Auto Responder Bot', 'Live Chat Assistant'], users: ['carlos.support', 'emma.rep', 'liam.agent'] },
    { name: 'Data Science', features: ['SQL Query Generator', 'Data Pipeline Explainer', 'Jupyter Copilot'], users: ['dr.chen', 'matthew.data', 'anita.ml'] },
    { name: 'Marketing & Content', features: ['SEO Blog Drafter', 'Ad Copy Optimizer', 'Social Media Campaign'], users: ['chloe.mkt', 'david.copy', 'zoe.social'] },
    { name: 'Product Growth', features: ['Customer Sentiment Analyzer', 'Feature Feedback Classifier', 'Churn Predictor'], users: ['sam.pm', 'claire.growth'] },
    { name: 'Unassigned', features: ['Unassigned'], users: ['ext_dev_9', 'unknown_client'] }
  ];

  const models = [
    { id: 'gpt-4o', provider: 'OpenAI', weight: 28, baseTokens: [400, 1600], compTokens: [200, 800], cacheChance: 0.3 },
    { id: 'gpt-4o-mini', provider: 'OpenAI', weight: 32, baseTokens: [200, 800], compTokens: [100, 400], cacheChance: 0.2 },
    { id: 'claude-3-5-sonnet', provider: 'Anthropic', weight: 15, baseTokens: [500, 2000], compTokens: [300, 900], cacheChance: 0.25 },
    { id: 'claude-3-haiku', provider: 'Anthropic', weight: 10, baseTokens: [150, 600], compTokens: [80, 250], cacheChance: 0.1 },
    { id: 'gemini-1.5-flash', provider: 'Google', weight: 10, baseTokens: [300, 1500], compTokens: [100, 500], cacheChance: 0.2 },
    { id: 'gemini-1.5-pro', provider: 'Google', weight: 5, baseTokens: [800, 3000], compTokens: [400, 1200], cacheChance: 0.15 }
  ];

  const pricing = getPricingTable();
  const now = Date.now();

  const insertStmt = db.prepare(`
    INSERT INTO requests (
      id, timestamp, iso_timestamp, team, feature, user_id, model, provider,
      prompt_tokens, completion_tokens, cached_tokens, total_tokens,
      prompt_cost, completion_cost, cached_cost, total_cost,
      latency_ms, status_code, is_stream, is_simulated, usage_source, pricing_version,
      prompt_preview, response_preview, raw_metadata
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  for (let i = 0; i < count; i++) {
    // Realistic multi-period enterprise timestamp and team distribution:
    // 35% in last 24h, 35% in 1-7d, 30% in 7-30d
    let timestamp;
    let teamObj;

    if (i < Math.floor(count * 0.35)) {
      // Last 24 hours: high Support ticket automation and Core Engineering CI runs
      timestamp = Math.floor(now - Math.random() * (24 * 60 * 60 * 1000));
      const weights = [
        { name: 'Customer Support', w: 40 },
        { name: 'Core Engineering', w: 35 },
        { name: 'Data Science', w: 12 },
        { name: 'Marketing & Content', w: 7 },
        { name: 'Product Growth', w: 6 }
      ];
      const r = Math.random() * 100;
      let acc = 0;
      let chosenTeamName = 'Customer Support';
      for (const tw of weights) {
        acc += tw.w;
        if (r <= acc) { chosenTeamName = tw.name; break; }
      }
      teamObj = teams.find(t => t.name === chosenTeamName) || teams[0];
    } else if (i < Math.floor(count * 0.70)) {
      // 1 to 7 days: active engineering, growth experiments, and support
      timestamp = Math.floor(now - (1 + Math.random() * 6) * 24 * 60 * 60 * 1000);
      const weights = [
        { name: 'Core Engineering', w: 35 },
        { name: 'Customer Support', w: 25 },
        { name: 'Product Growth', w: 20 },
        { name: 'Data Science', w: 12 },
        { name: 'Marketing & Content', w: 8 }
      ];
      const r = Math.random() * 100;
      let acc = 0;
      let chosenTeamName = 'Core Engineering';
      for (const tw of weights) {
        acc += tw.w;
        if (r <= acc) { chosenTeamName = tw.name; break; }
      }
      teamObj = teams.find(t => t.name === chosenTeamName) || teams[0];
    } else {
      // 7 to 30 days: historical monthly data with high Marketing campaigns and Data Science batch pipelines
      timestamp = Math.floor(now - (7 + Math.random() * 23) * 24 * 60 * 60 * 1000);
      const weights = [
        { name: 'Marketing & Content', w: 45 },
        { name: 'Data Science', w: 30 },
        { name: 'Core Engineering', w: 15 },
        { name: 'Customer Support', w: 10 }
      ];
      const r = Math.random() * 100;
      let acc = 0;
      let chosenTeamName = 'Marketing & Content';
      for (const tw of weights) {
        acc += tw.w;
        if (r <= acc) { chosenTeamName = tw.name; break; }
      }
      teamObj = teams.find(t => t.name === chosenTeamName) || teams[0];
    }

    const feature = teamObj.features[Math.floor(Math.random() * teamObj.features.length)];
    const user = teamObj.users[Math.floor(Math.random() * teamObj.users.length)];
    
    const rand = Math.random() * 100;
    let accum = 0;
    let chosenModel = models[0];
    for (const m of models) {
      accum += m.weight;
      if (rand <= accum) {
        chosenModel = m;
        break;
      }
    }

    const promptTokens = Math.floor(Math.random() * (chosenModel.baseTokens[1] - chosenModel.baseTokens[0])) + chosenModel.baseTokens[0];
    const completionTokens = Math.floor(Math.random() * (chosenModel.compTokens[1] - chosenModel.compTokens[0])) + chosenModel.compTokens[0];
    const cachedTokens = Math.random() < chosenModel.cacheChance ? Math.floor(promptTokens * 0.4) : 0;

    const costData = calculateCost(chosenModel.id, promptTokens, completionTokens, pricing, { cachedTokens });
    const isoTimestamp = new Date(timestamp).toISOString();
    const latency = Math.floor(Math.random() * 380) + 110;
    const reqId = `req_${Math.random().toString(36).substring(2, 9)}${Date.now().toString(36).substring(4)}`;

    insertStmt.run(
      reqId,
      timestamp,
      isoTimestamp,
      teamObj.name,
      feature,
      user,
      chosenModel.id,
      chosenModel.provider,
      promptTokens,
      completionTokens,
      cachedTokens,
      promptTokens + completionTokens + cachedTokens,
      costData.promptCost,
      costData.completionCost,
      costData.cachedCost,
      costData.totalCost,
      latency,
      200,
      Math.random() > 0.65 ? 1 : 0,
      1,
      'simulated',
      costData.pricingVersion || '2026-Q1',
      `Simulated request for ${feature} by ${user}`,
      `Generated response for ${feature} (${completionTokens} tokens)`,
      JSON.stringify({ seeded: true, batchId: 'seed-traffic' })
    );
  }

  return { seeded: count };
}
