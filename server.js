// server.js
// TokenPulse — LLM Cost, Usage & FinOps Observability Platform Server

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { 
  initDb, 
  getRequests, 
  getAnalytics, 
  getPricingTable, 
  updatePricing, 
  upsertPricing, 
  clearRequests, 
  seedSampleData,
  getTeams,
  getFeatures,
  db
} from './src/db.js';

import { handleChatCompletions, handleRequestReplay } from './src/proxy.js';
import { getAllBudgetsWithMetrics } from './src/budgets.js';
import { runEvaluationSuite } from './src/evaluation.js';
import { requireAdminAuth, createRateLimiter } from './src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------
// Automatic Environment Variables Loader (.env / .env.local)
// ---------------------------------------------------------------------
import fs from 'node:fs';

function loadEnvironment() {
  const envFiles = ['.env', '.env.local', '.env.example'];
  for (const filename of envFiles) {
    const fullPath = path.join(__dirname, filename);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (val && !process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch (err) {
        // Silently continue
      }
      if (filename === '.env' || filename === '.env.local') break;
    }
  }
}

loadEnvironment();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Database & Enterprise Schema
initDb();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting (300 requests per minute per IP)
app.use('/v1/', createRateLimiter(300, 60000));
app.use('/api/', createRateLimiter(300, 60000));

// Serve static frontend dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Serve local Supabase JS SDK bundle (ensures immediate local availability without external CDN latency)
app.get('/js/supabase.js', (req, res) => {
  const localSupabase = path.join(__dirname, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
  if (fs.existsSync(localSupabase)) {
    res.setHeader('Content-Type', 'application/javascript');
    return res.sendFile(localSupabase);
  }
  res.status(404).send('Supabase SDK bundle not found');
});

// Dedicated Authentication Page Routes (Bypassed: redirect directly to main dashboard)
app.get('/login', (req, res) => res.redirect('/'));
app.get('/signup', (req, res) => res.redirect('/'));
app.get('/auth', (req, res) => res.redirect('/'));

// Public Auth Client Configuration (Exposes ONLY public URL and Anon Key, never secrets)
app.get('/api/auth/config', (req, res) => {
  let supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  let supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  // Normalize URL format: strip trailing slash and /rest/v1 if included
  if (supabaseUrl.endsWith('/rest/v1/')) {
    supabaseUrl = supabaseUrl.slice(0, -9);
  } else if (supabaseUrl.endsWith('/rest/v1')) {
    supabaseUrl = supabaseUrl.slice(0, -8);
  } else if (supabaseUrl.endsWith('/')) {
    supabaseUrl = supabaseUrl.slice(0, -1);
  }

  // Validate URL syntax
  let isValidUrl = false;
  try {
    const parsed = new URL(supabaseUrl);
    isValidUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    isValidUrl = false;
  }

  const isPlaceholder = supabaseUrl.includes('your-project-id') || supabaseAnonKey.includes('...');
  const configured = Boolean(supabaseUrl && supabaseAnonKey && isValidUrl && !isPlaceholder);

  res.json({
    success: true,
    configured,
    supabaseUrl,
    supabaseAnonKey
  });
});

// ---------------------------------------------------------------------
// 1. OpenAI-Compatible Proxy Endpoints
// ---------------------------------------------------------------------

// Models list endpoint
app.get('/v1/models', (req, res) => {
  const pricing = getPricingTable();
  res.json({
    object: 'list',
    data: pricing.map(p => ({
      id: p.model_id,
      object: 'model',
      created: 1700000000,
      owned_by: p.provider.toLowerCase(),
      permission: [],
      root: p.model_id,
      pricing: {
        input_per_million: p.input_cost_per_million,
        output_per_million: p.output_cost_per_million,
        cached_per_million: p.cached_cost_per_million,
        currency: p.currency,
        version: p.version
      }
    }))
  });
});

// Chat completions proxy
app.post('/v1/chat/completions', handleChatCompletions);
app.post('/api/proxy/chat', handleChatCompletions);

// Legacy completions alias
app.post('/v1/completions', (req, res) => {
  req.body.messages = [{ role: 'user', content: req.body.prompt || '' }];
  return handleChatCompletions(req, res);
});

// Request replay endpoint
app.post('/api/requests/:id/replay', handleRequestReplay);

// ---------------------------------------------------------------------
// 2. Monitoring & Analytics Endpoints
// ---------------------------------------------------------------------

// Get aggregated dashboard metrics
app.get('/api/analytics', (req, res) => {
  try {
    const filters = {
      team: req.query.team,
      feature: req.query.feature,
      model: req.query.model,
      provider: req.query.provider,
      user: req.query.user,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      search: req.query.search,
      timeWindow: req.query.timeWindow || req.query.time
    };
    const data = getAnalytics(filters);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Analytics query error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve analytics' });
  }
});

// Get paginated requests log
app.get('/api/requests', (req, res) => {
  try {
    const filters = {
      team: req.query.team,
      feature: req.query.feature,
      model: req.query.model,
      provider: req.query.provider,
      user: req.query.user,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      search: req.query.search,
      timeWindow: req.query.timeWindow || req.query.time,
      page: req.query.page,
      limit: req.query.limit
    };
    const result = getRequests(filters);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Requests log error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve request logs' });
  }
});

// Teams and features registries
app.get('/api/teams', (req, res) => {
  res.json({ success: true, teams: getTeams() });
});

app.get('/api/features', (req, res) => {
  res.json({ success: true, features: getFeatures() });
});

// ---------------------------------------------------------------------
// 3. Budget Management Endpoints
// ---------------------------------------------------------------------

app.get('/api/budgets', (req, res) => {
  try {
    const budgets = getAllBudgetsWithMetrics(db);
    res.json({ success: true, budgets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/budgets', requireAdminAuth, (req, res) => {
  try {
    const { id, entity_type, entity_id, period, limit_usd, alert_threshold, enforcement_mode } = req.body;
    if (!entity_type || !entity_id || isNaN(limit_usd)) {
      return res.status(400).json({ success: false, error: 'Missing required budget fields' });
    }

    const budgetId = id || `bgt_${entity_type}_${Date.now()}`;
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO budgets (id, entity_type, entity_id, period, limit_usd, alert_threshold, enforcement_mode, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      budgetId,
      entity_type,
      entity_id,
      period || 'monthly',
      Number(limit_usd),
      Number(alert_threshold || 0.80),
      enforcement_mode || 'monitor',
      new Date().toISOString()
    );

    res.json({ success: true, message: 'Budget saved successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/budgets/:id', requireAdminAuth, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
    res.json({ success: true, message: 'Budget removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------
// 4. Pricing Table Management
// ---------------------------------------------------------------------

app.get('/api/pricing', (req, res) => {
  try {
    const pricing = getPricingTable();
    res.json({ success: true, pricing });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/pricing/:model_id', requireAdminAuth, (req, res) => {
  try {
    const { model_id } = req.params;
    const { input_cost_per_million, output_cost_per_million, cached_cost_per_million } = req.body;
    if (isNaN(input_cost_per_million) || isNaN(output_cost_per_million)) {
      return res.status(400).json({ success: false, error: 'Rates must be valid numbers' });
    }
    const result = updatePricing(model_id, input_cost_per_million, output_cost_per_million, cached_cost_per_million || 0.0);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/pricing', requireAdminAuth, (req, res) => {
  try {
    const { model_id, display_name, provider, input_cost_per_million, output_cost_per_million, cached_cost_per_million, context_window } = req.body;
    if (!model_id || isNaN(input_cost_per_million) || isNaN(output_cost_per_million)) {
      return res.status(400).json({ success: false, error: 'Missing required fields or invalid rates' });
    }
    const result = upsertPricing({
      model_id,
      display_name: display_name || model_id,
      provider: provider || 'Custom',
      input_cost_per_million,
      output_cost_per_million,
      cached_cost_per_million: cached_cost_per_million || 0.0,
      context_window: context_window || 128000
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------
// 5. Traffic Simulator & Seeder
// ---------------------------------------------------------------------

app.post('/api/simulate/batch', (req, res) => {
  try {
    const count = Math.min(250, Math.max(1, Number(req.body.count) || 30));
    const result = seedSampleData(count);
    res.json({ success: true, message: `Successfully generated ${result.seeded} simulated requests`, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reset', requireAdminAuth, (req, res) => {
  try {
    clearRequests();
    res.json({ success: true, message: 'All request logs cleared successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------
// 6. Evaluation & Accuracy Verification Suite
// ---------------------------------------------------------------------

let cachedEvaluationReport = null;

app.post('/api/evaluation/run', async (req, res) => {
  try {
    const report = await runEvaluationSuite();
    cachedEvaluationReport = report;
    res.json({ success: true, report });
  } catch (err) {
    console.error('Evaluation run error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/evaluation/latest', async (req, res) => {
  try {
    if (!cachedEvaluationReport) {
      cachedEvaluationReport = await runEvaluationSuite();
    }
    res.json({ success: true, report: cachedEvaluationReport });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export evaluation report as CSV or JSON
app.get('/api/evaluation/export', async (req, res) => {
  try {
    if (!cachedEvaluationReport) {
      cachedEvaluationReport = await runEvaluationSuite();
    }

    const format = req.query.format || 'csv';
    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename=TokenPulse_Evaluation_Report.json');
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(cachedEvaluationReport, null, 2));
    }

    // CSV format
    const rows = [
      ['Test ID', 'Model', 'Provider', 'Team', 'Description', 'Prompt Tokens', 'Cached Tokens', 'Completion Tokens', 'Total Tokens', 'Expected Cost USD', 'Actual Cost USD', 'Absolute Error USD', 'Status']
    ];

    for (const t of cachedEvaluationReport.unitTestMatrix) {
      rows.push([
        t.testId, t.model, t.provider, t.team, `"${t.description.replace(/"/g, '""')}"`,
        t.promptTokens, t.cachedTokens, t.completionTokens, t.totalTokens,
        t.expectedCost.toFixed(6), t.actualCost.toFixed(6), t.absError.toFixed(6), t.status
      ]);
    }

    const csvContent = rows.map(r => r.join(',')).join('\n');
    res.setHeader('Content-Disposition', 'attachment; filename=TokenPulse_Evaluation_Report.csv');
    res.setHeader('Content-Type', 'text/csv');
    return res.send(csvContent);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------
// 7. Health & Status Check
// ---------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    project: 'TokenPulse',
    version: '1.0.0',
    hackathon: 'MITK AI VISION 24H Hackathon',
    problem_statement: 'PS-04 — LLM FinOps Dashboard',
    timestamp: new Date().toISOString(),
    proxy_endpoint: '/v1/chat/completions',
    models_endpoint: '/v1/models',
    uptime_seconds: Math.floor(process.uptime()),
    features: {
      budget_enforcement: true,
      cached_tokens: true,
      multi_provider: true,
      offline_simulation: true
    }
  });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.message);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n========================================================`);
  console.log(`🚀 TokenPulse — LLM FinOps Platform Running`);
  console.log(`   Dashboard:          http://localhost:${PORT}`);
  console.log(`   Proxy Endpoint:     http://localhost:${PORT}/v1/chat/completions`);
  console.log(`   Models Endpoint:    http://localhost:${PORT}/v1/models`);
  console.log(`   Budgets Endpoint:   http://localhost:${PORT}/api/budgets`);
  console.log(`   Evaluation Suite:   http://localhost:${PORT}/api/evaluation/run`);
  console.log(`========================================================\n`);
});
