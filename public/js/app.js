// public/js/app.js
// TokenPulse: Frontend Client Logic, Multi-Tenant Telemetry, Budget Engine & Evaluation UI

import { updateDashboardCharts } from './charts.js';
import { getAuthConfig, getCurrentSession, logoutUser } from './auth.js';

// Application State
const state = {
  currentTab: 'overview',
  activeBreakdownSubtab: 'by-team',
  filters: {
    time: '7d',
    team: 'all',
    feature: 'all',
    model: 'all',
    provider: 'all',
    search: ''
  },
  pagination: {
    page: 1,
    limit: 15,
    totalPages: 1,
    total: 0
  },
  analytics: null,
  pricing: [],
  budgets: [],
  evaluationReport: null,
  activeInspectRequest: null
};

// Preset configurations for the Playground
const PRESETS = {
  support: {
    model: 'gpt-4o-mini',
    team: 'Customer Support',
    feature: 'Ticket Summarizer',
    user: 'carlos.support',
    prompt: 'Summarize the following customer incident:\nCustomer cannot complete checkout due to gateway timeout. Cart ID: 94819. Customer attempted twice on Chrome browser.'
  },
  code: {
    model: 'gpt-4o',
    team: 'Core Engineering',
    feature: 'Code Review Assistant',
    user: 'alex.dev',
    prompt: 'Can you review this JavaScript function for memory leaks and provide an optimized version?\n\nfunction processData(items) {\n  let cache = {};\n  return items.map(i => cache[i.id] = i.value);\n}'
  },
  sql: {
    model: 'claude-3-5-sonnet',
    team: 'Data Science',
    feature: 'SQL Query Generator',
    user: 'dr.chen',
    prompt: 'Write an optimized PostgreSQL query to compute the monthly rolling average token consumption and total spend per team from the requests table.'
  },
  marketing: {
    model: 'claude-3-haiku',
    team: 'Marketing & Content',
    feature: 'SEO Blog Drafter',
    user: 'chloe.mkt',
    prompt: 'Write an engaging 3-paragraph blog introduction on why engineering teams need real-time LLM cost tracking and governance.'
  },
  sentiment: {
    model: 'gemini-1.5-flash',
    team: 'Product Growth',
    feature: 'Customer Sentiment Analyzer',
    user: 'claire.growth',
    prompt: 'Analyze sentiment from this NPS response: "TokenPulse was very simple to integrate into our OpenAI SDK client, and we immediately saw which team was spending the most."'
  }
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupAuthHeader();
  setupNavigation();
  setupFilterControls();
  setupPlayground();
  setupPricingControls();
  setupBudgetsControls();
  setupEvaluationControls();
  setupRequestsTableControls();
  setupModals();

  // Initial data fetch
  fetchPricing().then(() => {
    fetchAnalytics();
    fetchRequests();
    fetchBudgets();
    fetchEvaluationReport();
  });
});

function setupAuthHeader() {
  const userEmailEl = document.getElementById('user-display-email');
  if (userEmailEl) {
    userEmailEl.textContent = 'Workspace Active';
    userEmailEl.title = 'TokenPulse LLM FinOps Observability Platform';
  }
  const badge = document.getElementById('user-profile-badge');
  if (badge) {
    badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
  }
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.style.display = 'none';
  }
}

// ---------------------------------------------------------------------
// 1. Navigation & Tab Switching
// ---------------------------------------------------------------------
function setupNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      switchTab(target);
    });
  });

  const quickTestBtn = document.getElementById('btn-quick-test');
  if (quickTestBtn) {
    quickTestBtn.addEventListener('click', () => switchTab('playground'));
  }

  // Breakdown subtab switcher (By Team, By Feature, By Model, By Provider, By User)
  const pills = document.querySelectorAll('.breakdown-switcher .tab-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeBreakdownSubtab = pill.dataset.subtab;
      renderBreakdownTable();
    });
  });
}

function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabId}`);
  });

  const filterStrip = document.getElementById('global-filter-strip');
  if (filterStrip) {
    filterStrip.style.display = (tabId === 'overview' || tabId === 'requests') ? 'flex' : 'none';
  }

  if (tabId === 'overview') {
    fetchAnalytics();
  } else if (tabId === 'requests') {
    fetchRequests();
  } else if (tabId === 'budgets') {
    fetchBudgets();
  } else if (tabId === 'pricing') {
    fetchPricing();
  } else if (tabId === 'evaluation') {
    fetchEvaluationReport();
  }
}

// ---------------------------------------------------------------------
// 2. Global Filter Bar Handling
// ---------------------------------------------------------------------
function setupFilterControls() {
  const timeSelect = document.getElementById('filter-time');
  const teamSelect = document.getElementById('filter-team');
  const featureSelect = document.getElementById('filter-feature');
  const modelSelect = document.getElementById('filter-model');
  const providerSelect = document.getElementById('filter-provider');
  const searchInput = document.getElementById('filter-search');
  const applyBtn = document.getElementById('btn-apply-filter');
  const resetBtn = document.getElementById('btn-reset-filter');

  timeSelect.addEventListener('change', (e) => {
    state.filters.time = e.target.value;
    triggerFilterRefresh();
  });

  teamSelect.addEventListener('change', (e) => {
    state.filters.team = e.target.value;
    triggerFilterRefresh();
  });

  featureSelect.addEventListener('change', (e) => {
    state.filters.feature = e.target.value;
    triggerFilterRefresh();
  });

  modelSelect.addEventListener('change', (e) => {
    state.filters.model = e.target.value;
    triggerFilterRefresh();
  });

  if (providerSelect) {
    providerSelect.addEventListener('change', (e) => {
      state.filters.provider = e.target.value;
      triggerFilterRefresh();
    });
  }

  let searchTimeout = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.filters.search = e.target.value.trim();
      triggerFilterRefresh();
    }, 350);
  });

  applyBtn.addEventListener('click', triggerFilterRefresh);

  resetBtn.addEventListener('click', () => {
    timeSelect.value = '7d';
    teamSelect.value = 'all';
    featureSelect.value = 'all';
    modelSelect.value = 'all';
    if (providerSelect) providerSelect.value = 'all';
    searchInput.value = '';
    state.filters = { time: '7d', team: 'all', feature: 'all', model: 'all', provider: 'all', search: '' };
    state.pagination.page = 1;
    triggerFilterRefresh();
  });
}

function triggerFilterRefresh() {
  state.pagination.page = 1;
  fetchAnalytics();
  fetchRequests();
}

function buildFilterQueryParams() {
  const params = new URLSearchParams();
  if (state.filters.team && state.filters.team !== 'all') params.set('team', state.filters.team);
  if (state.filters.feature && state.filters.feature !== 'all') params.set('feature', state.filters.feature);
  if (state.filters.model && state.filters.model !== 'all') params.set('model', state.filters.model);
  if (state.filters.provider && state.filters.provider !== 'all') params.set('provider', state.filters.provider);
  if (state.filters.search) params.set('search', state.filters.search);

  const timeWindow = state.filters.time || 'all';
  params.set('timeWindow', timeWindow);

  const now = Date.now();
  if (timeWindow === '24h') {
    params.set('startDate', (now - 24 * 60 * 60 * 1000).toString());
  } else if (timeWindow === '7d') {
    params.set('startDate', (now - 7 * 24 * 60 * 60 * 1000).toString());
  } else if (timeWindow === '30d') {
    params.set('startDate', (now - 30 * 24 * 60 * 60 * 1000).toString());
  }

  return params;
}

// ---------------------------------------------------------------------
// 3. Analytics & KPI Fetching
// ---------------------------------------------------------------------
let currentAnalyticsReqId = 0;
async function fetchAnalytics() {
  const reqId = ++currentAnalyticsReqId;
  try {
    const params = buildFilterQueryParams();
    const res = await fetch(`/api/analytics?${params.toString()}`);
    const json = await res.json();
    if (!json.success || reqId !== currentAnalyticsReqId) return;

    state.analytics = json.data;
    renderKPIs(json.data.summary);
    updateFilterOptions(json.data.filter_options);
    updateDashboardCharts(json.data);
    renderBreakdownTable();
  } catch (err) {
    if (reqId === currentAnalyticsReqId) {
      console.error('Failed to load analytics:', err);
    }
  }
}

function renderKPIs(summary) {
  const s = summary || {
    total_cost: 0,
    total_requests: 0,
    total_tokens: 0,
    avg_latency_ms: 0,
    failed_requests: 0,
    error_rate_pct: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    cached_tokens: 0,
    avg_cost_per_request: 0,
    unique_teams: 0,
    unique_features: 0,
    unique_users: 0
  };

  document.getElementById('val-total-cost').textContent = `$${Number(s.total_cost || 0).toFixed(4)}`;
  document.getElementById('val-total-requests').textContent = Number(s.total_requests || 0).toLocaleString();
  document.getElementById('val-total-tokens').textContent = Number(s.total_tokens || 0).toLocaleString();
  document.getElementById('val-avg-latency').textContent = `${s.avg_latency_ms || 0} ms`;

  document.getElementById('sub-requests-info').textContent = 
    `${s.failed_requests || 0} Failed • ${s.error_rate_pct || 0}% Error Rate`;

  const cached = s.cached_tokens || 0;
  document.getElementById('sub-token-split').textContent = 
    `${Number(s.prompt_tokens || 0).toLocaleString()} In • ${Number(s.completion_tokens || 0).toLocaleString()} Out • ${Number(cached).toLocaleString()} Cached`;

  const costPer1k = (s.total_tokens || 0) > 0 
    ? (s.total_cost / s.total_tokens) * 1000 
    : 0;
  document.getElementById('val-effective-rate').textContent = `$${costPer1k.toFixed(5)}`;
  document.getElementById('sub-avg-cost-req').textContent = `Avg $${Number(s.avg_cost_per_request || 0).toFixed(5)} / req`;

  document.getElementById('val-active-tenants').textContent = `${s.unique_teams || 0} Teams`;
  document.getElementById('sub-tenants-info').textContent = 
    `${s.unique_features || 0} Features • ${s.unique_users || 0} Users`;
}

function updateFilterOptions(options) {
  if (!options) return;

  populateSelect('filter-team', options.teams, state.filters.team);
  populateSelect('filter-feature', options.features, state.filters.feature);
  populateSelect('filter-model', options.models, state.filters.model);
  if (options.providers) populateSelect('filter-provider', options.providers, state.filters.provider);
}

function populateSelect(selectId, items, currentValue) {
  const el = document.getElementById(selectId);
  if (!el || !items) return;

  const currentSelection = currentValue || el.value || 'all';
  const defaultLabel = el.options && el.options.length > 0 ? el.options[0].textContent : `All ${selectId.replace('filter-', '')}s`;

  el.innerHTML = '';
  const firstOpt = document.createElement('option');
  firstOpt.value = 'all';
  firstOpt.textContent = defaultLabel;
  if (currentSelection === 'all') firstOpt.selected = true;
  el.appendChild(firstOpt);

  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    if (item === currentSelection) opt.selected = true;
    el.appendChild(opt);
  });

  el.value = currentSelection;
}

function renderBreakdownTable() {
  const thead = document.getElementById('breakdown-thead');
  const tbody = document.getElementById('breakdown-tbody');
  if (!thead || !tbody || !state.analytics) return;

  const data = state.analytics;
  const subtab = state.activeBreakdownSubtab;

  if (subtab === 'by-team') {
    thead.innerHTML = `
      <tr>
        <th>Team Name</th>
        <th>Requests</th>
        <th>Prompt Tokens</th>
        <th>Comp. Tokens</th>
        <th>Cached Tokens</th>
        <th>Total Tokens</th>
        <th>Total Spend</th>
        <th>Avg Cost/Req</th>
        <th>Share of Spend</th>
        <th>Active Users</th>
      </tr>
    `;
    const rows = data.by_team || [];
    tbody.innerHTML = rows.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:20px;">No requests recorded for this filter</td></tr>' :
      rows.map(r => `
        <tr>
          <td><strong>${escapeHtml(r.team)}</strong> ${r.team === 'Unassigned' ? '<span class="badge badge-warning">Unassigned</span>' : ''}</td>
          <td class="mono">${r.requests.toLocaleString()}</td>
          <td class="mono">${r.prompt_tokens.toLocaleString()}</td>
          <td class="mono">${r.completion_tokens.toLocaleString()}</td>
          <td class="mono">${(r.cached_tokens || 0).toLocaleString()}</td>
          <td class="mono">${r.total_tokens.toLocaleString()}</td>
          <td class="mono" style="color:var(--accent-emerald);font-weight:700;">$${r.total_cost.toFixed(4)}</td>
          <td class="mono">$${(r.avg_cost_per_request || 0).toFixed(5)}</td>
          <td>
            <div class="spend-share-cell">
              <div class="progress-track">
                <div class="progress-fill" style="width: ${Math.min(100, r.cost_percentage || 0)}%;"></div>
              </div>
              <span class="mono" style="font-size:0.75rem;">${r.cost_percentage}%</span>
            </div>
          </td>
          <td class="mono">${r.active_users}</td>
        </tr>
      `).join('');
  } else if (subtab === 'by-feature') {
    thead.innerHTML = `
      <tr>
        <th>Feature Name</th>
        <th>Owning Team</th>
        <th>Requests</th>
        <th>Total Tokens</th>
        <th>Total Spend</th>
        <th>Avg Cost/Req</th>
        <th>Cost Share</th>
      </tr>
    `;
    const rows = data.by_feature || [];
    tbody.innerHTML = rows.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:20px;">No features found</td></tr>' :
      rows.map(r => `
        <tr>
          <td><strong>${escapeHtml(r.feature)}</strong></td>
          <td><span class="badge badge-neutral">${escapeHtml(r.team)}</span></td>
          <td class="mono">${r.requests.toLocaleString()}</td>
          <td class="mono">${r.total_tokens.toLocaleString()}</td>
          <td class="mono" style="color:var(--accent-emerald);font-weight:700;">$${r.total_cost.toFixed(4)}</td>
          <td class="mono">$${(r.avg_cost_per_request || 0).toFixed(5)}</td>
          <td class="mono">${r.cost_percentage}%</td>
        </tr>
      `).join('');
  } else if (subtab === 'by-model') {
    thead.innerHTML = `
      <tr>
        <th>Model Identifier</th>
        <th>Provider</th>
        <th>Requests</th>
        <th>Prompt Tokens</th>
        <th>Comp. Tokens</th>
        <th>Cached Tokens</th>
        <th>Total Tokens</th>
        <th>Avg Latency</th>
        <th>Cost per 1k</th>
        <th>Total Spend</th>
      </tr>
    `;
    const rows = data.by_model || [];
    tbody.innerHTML = rows.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:20px;">No model data found</td></tr>' :
      rows.map(r => `
        <tr>
          <td><span class="badge badge-model">${escapeHtml(r.model)}</span></td>
          <td><span class="badge badge-neutral">${escapeHtml(r.provider || 'simulated')}</span></td>
          <td class="mono">${r.requests.toLocaleString()}</td>
          <td class="mono">${r.prompt_tokens.toLocaleString()}</td>
          <td class="mono">${r.completion_tokens.toLocaleString()}</td>
          <td class="mono">${(r.cached_tokens || 0).toLocaleString()}</td>
          <td class="mono">${r.total_tokens.toLocaleString()}</td>
          <td class="mono">${r.avg_latency} ms</td>
          <td class="mono">$${r.cost_per_thousand_tokens.toFixed(5)}</td>
          <td class="mono" style="color:var(--accent-emerald);font-weight:700;">$${r.total_cost.toFixed(4)}</td>
        </tr>
      `).join('');
  } else if (subtab === 'by-provider') {
    thead.innerHTML = `
      <tr>
        <th>Provider Name</th>
        <th>Requests</th>
        <th>Simulated Requests</th>
        <th>Real Provider Calls</th>
        <th>Total Tokens</th>
        <th>Total Spend</th>
        <th>Share of Spend</th>
      </tr>
    `;
    const rows = data.by_provider || [];
    tbody.innerHTML = rows.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:20px;">No provider data found</td></tr>' :
      rows.map(r => `
        <tr>
          <td><strong>${escapeHtml(r.provider)}</strong></td>
          <td class="mono">${r.requests.toLocaleString()}</td>
          <td class="mono">${(r.simulated_requests || 0).toLocaleString()}</td>
          <td class="mono">${(r.real_requests || 0).toLocaleString()}</td>
          <td class="mono">${r.total_tokens.toLocaleString()}</td>
          <td class="mono" style="color:var(--accent-emerald);font-weight:700;">$${r.total_cost.toFixed(4)}</td>
          <td>
            <div class="spend-share-cell">
              <div class="progress-track">
                <div class="progress-fill" style="width: ${Math.min(100, r.cost_percentage || 0)}%;"></div>
              </div>
              <span class="mono" style="font-size:0.75rem;">${r.cost_percentage}%</span>
            </div>
          </td>
        </tr>
      `).join('');
  } else if (subtab === 'by-user') {
    thead.innerHTML = `
      <tr>
        <th>User Identifier</th>
        <th>Team</th>
        <th>Requests</th>
        <th>Total Tokens</th>
        <th>Total Spend ($)</th>
      </tr>
    `;
    const rows = data.by_user || [];
    tbody.innerHTML = rows.length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:20px;">No users found</td></tr>' :
      rows.map(r => `
        <tr>
          <td><i class="fa-regular fa-user" style="margin-right:6px;color:var(--accent-primary);"></i> <strong>${escapeHtml(r.user_id)}</strong></td>
          <td><span class="badge badge-neutral">${escapeHtml(r.team)}</span></td>
          <td class="mono">${r.requests.toLocaleString()}</td>
          <td class="mono">${r.total_tokens.toLocaleString()}</td>
          <td class="mono" style="color:var(--accent-emerald);font-weight:700;">$${r.total_cost.toFixed(4)}</td>
        </tr>
      `).join('');
  }
}

// ---------------------------------------------------------------------
// 4. Request Explorer (Audit Logs)
// ---------------------------------------------------------------------
let currentRequestsReqId = 0;
async function fetchRequests() {
  const reqId = ++currentRequestsReqId;
  try {
    const params = buildFilterQueryParams();
    params.set('page', state.pagination.page.toString());
    params.set('limit', state.pagination.limit.toString());

    const res = await fetch(`/api/requests?${params.toString()}`);
    const json = await res.json();
    if (!json.success || reqId !== currentRequestsReqId) return;

    state.pagination = json.pagination;
    renderRequestsTable(json.records);
  } catch (err) {
    if (reqId === currentRequestsReqId) {
      console.error('Failed to load requests:', err);
    }
  }
}

function renderRequestsTable(records) {
  const tbody = document.getElementById('requests-tbody');
  const pageIndicator = document.getElementById('page-indicator');
  const paginationInfo = document.getElementById('pagination-info');
  const prevBtn = document.getElementById('btn-prev-page');
  const nextBtn = document.getElementById('btn-next-page');

  if (!tbody) return;

  if (!records || records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--text-muted);">No requests matching criteria. Try adjusting filters or use the Playground to generate requests.</td></tr>`;
    paginationInfo.textContent = 'Showing 0 requests';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  tbody.innerHTML = records.map(r => {
    const dateStr = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isError = r.status_code >= 400;

    return `
      <tr data-req-id="${r.id}">
        <td class="mono" style="font-size:0.75rem;color:var(--text-muted);">${dateStr}</td>
        <td class="mono" style="font-size:0.75rem;"><span title="${r.id}">${r.id.slice(0, 14)}...</span></td>
        <td><strong>${escapeHtml(r.team)}</strong></td>
        <td><span class="badge badge-neutral">${escapeHtml(r.feature)}</span></td>
        <td class="mono" style="font-size:0.78rem;">${escapeHtml(r.user_id)}</td>
        <td><span class="badge badge-neutral" style="font-size:0.7rem;">${escapeHtml(r.provider)}</span></td>
        <td><span class="badge badge-model">${escapeHtml(r.model)}</span></td>
        <td class="mono" style="font-size:0.78rem;">${r.prompt_tokens} / ${r.cached_tokens || 0} / ${r.completion_tokens} / <strong>${r.total_tokens}</strong></td>
        <td class="mono" style="color:var(--accent-emerald);font-weight:700;">$${r.total_cost.toFixed(6)}</td>
        <td class="mono">${r.latency_ms}ms</td>
        <td><span class="badge ${isError ? 'badge-fail' : 'badge-pass'}">${r.status_code} ${isError ? 'ERR' : 'OK'}</span></td>
        <td>
          <button class="btn btn-outline btn-sm btn-inspect-row" data-id="${r.id}" title="Inspect & Replay">
            <i class="fa-solid fa-magnifying-glass-plus"></i> Inspect
          </button>
        </td>
      </tr>
    `;
  }).join('');

  paginationInfo.textContent = `Showing ${(state.pagination.page - 1) * state.pagination.limit + 1} - ${Math.min(state.pagination.page * state.pagination.limit, state.pagination.total)} of ${state.pagination.total} requests`;
  pageIndicator.textContent = `Page ${state.pagination.page} of ${state.pagination.totalPages || 1}`;
  prevBtn.disabled = state.pagination.page <= 1;
  nextBtn.disabled = state.pagination.page >= state.pagination.totalPages;

  tbody.querySelectorAll('.btn-inspect-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const record = records.find(r => r.id === id);
      if (record) openRequestModal(record);
    });
  });
}

function setupRequestsTableControls() {
  const prevBtn = document.getElementById('btn-prev-page');
  const nextBtn = document.getElementById('btn-next-page');
  const clearBtn = document.getElementById('btn-clear-logs');
  const exportBtn = document.getElementById('btn-export-csv');

  prevBtn.addEventListener('click', () => {
    if (state.pagination.page > 1) {
      state.pagination.page--;
      fetchRequests();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (state.pagination.page < state.pagination.totalPages) {
      state.pagination.page++;
      fetchRequests();
    }
  });

  clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all logged LLM requests? This will reset all telemetry history.')) {
      await fetch('/api/reset', { method: 'POST' });
      fetchAnalytics();
      fetchRequests();
    }
  });

  exportBtn.addEventListener('click', () => {
    window.open('/api/requests?limit=1000', '_blank');
  });
}

// ---------------------------------------------------------------------
// 5. Budget Management
// ---------------------------------------------------------------------
async function fetchBudgets() {
  try {
    const res = await fetch('/api/budgets');
    const json = await res.json();
    if (!json.success) return;

    state.budgets = json.budgets;
    renderBudgets(json.budgets);
  } catch (err) {
    console.error('Failed to load budgets:', err);
  }
}

function renderBudgets(budgets) {
  const container = document.getElementById('budgets-container');
  if (!container) return;

  if (!budgets || budgets.length === 0) {
    container.innerHTML = `<div style="color:var(--text-muted);padding:20px;">No budget policies configured yet.</div>`;
    return;
  }

  container.innerHTML = budgets.map(b => {
    let statusClass = 'healthy';
    let badgeClass = 'badge-healthy';
    let statusText = 'HEALTHY';

    if (b.status === 'EXCEEDED') {
      statusClass = 'exceeded';
      badgeClass = 'badge-exceeded';
      statusText = 'EXCEEDED';
    } else if (b.status === 'WARNING') {
      statusClass = 'warning';
      badgeClass = 'badge-warning';
      statusText = 'WARNING';
    }

    const isEnforced = b.enforcement_mode === 'enforce';

    return `
      <div class="budget-card" data-budget-id="${b.id}">
        <div class="budget-card-header">
          <div class="budget-entity-title">${escapeHtml(b.entity_id)}</div>
          <div class="budget-badges">
            <span class="badge ${badgeClass}">${statusText}</span>
            <span class="badge badge-neutral">${isEnforced ? '🛡️ Enforce' : '👁️ Monitor'}</span>
          </div>
        </div>

        <div class="budget-metric-row">
          <div class="budget-spent-val">$${b.current_spend.toFixed(2)}</div>
          <div class="budget-limit-val">of $${b.limit_usd.toFixed(2)} (${b.period})</div>
        </div>

        <div class="budget-bar-track">
          <div class="budget-bar-fill ${statusClass}" style="width: ${Math.min(100, b.utilization_pct)}%;"></div>
        </div>

        <div class="budget-footer">
          <div>Remaining: <strong>$${b.remaining_usd.toFixed(2)}</strong> (${b.utilization_pct}% used)</div>
          <div class="budget-footer-actions">
            <button class="btn btn-outline btn-sm btn-edit-budget" data-id="${b.id}">Edit</button>
            <button class="btn btn-danger-outline btn-sm btn-delete-budget" data-id="${b.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach handlers
  container.querySelectorAll('.btn-edit-budget').forEach(btn => {
    btn.addEventListener('click', () => {
      const budget = budgets.find(b => b.id === btn.dataset.id);
      if (budget) openBudgetModal(budget);
    });
  });

  container.querySelectorAll('.btn-delete-budget').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Delete this budget policy?')) {
        await fetch(`/api/budgets/${btn.dataset.id}`, { method: 'DELETE' });
        fetchBudgets();
      }
    });
  });
}

function setupBudgetsControls() {
  const addBtn = document.getElementById('btn-add-budget');
  if (addBtn) addBtn.addEventListener('click', () => openBudgetModal());

  const form = document.getElementById('form-budget');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('budget-id').value;
      const entity_type = document.getElementById('budget-entity-type').value;
      const entity_id = document.getElementById('budget-entity-id').value.trim();
      const limit_usd = parseFloat(document.getElementById('budget-limit').value);
      const alert_threshold = parseFloat(document.getElementById('budget-threshold').value);
      const enforcement_mode = document.getElementById('budget-mode').value;

      try {
        await fetch('/api/budgets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: id || undefined,
            entity_type,
            entity_id,
            limit_usd,
            alert_threshold,
            enforcement_mode
          })
        });

        document.getElementById('modal-budget').classList.remove('open');
        fetchBudgets();
      } catch (err) {
        alert('Failed to save budget policy');
      }
    });
  }
}

function openBudgetModal(budget = null) {
  const modal = document.getElementById('modal-budget');
  const title = document.getElementById('modal-budget-title');
  const idInput = document.getElementById('budget-id');
  const typeSelect = document.getElementById('budget-entity-type');
  const entityInput = document.getElementById('budget-entity-id');
  const limitInput = document.getElementById('budget-limit');
  const thresholdSelect = document.getElementById('budget-threshold');
  const modeSelect = document.getElementById('budget-mode');

  if (budget) {
    title.innerHTML = `<i class="fa-solid fa-wallet"></i> Edit Policy: ${budget.entity_id}`;
    idInput.value = budget.id;
    typeSelect.value = budget.entity_type;
    entityInput.value = budget.entity_id;
    limitInput.value = budget.limit_usd;
    thresholdSelect.value = budget.alert_threshold.toFixed(2);
    modeSelect.value = budget.enforcement_mode;
  } else {
    title.innerHTML = `<i class="fa-solid fa-plus"></i> Configure Budget Policy`;
    idInput.value = '';
    typeSelect.value = 'team';
    entityInput.value = '';
    limitInput.value = '50.00';
    thresholdSelect.value = '0.80';
    modeSelect.value = 'monitor';
  }

  modal.classList.add('open');
}

// ---------------------------------------------------------------------
// 6. Playground & Simulator
// ---------------------------------------------------------------------
function setupPlayground() {
  const modelSelect = document.getElementById('play-model');
  const teamInput = document.getElementById('play-team');
  const featureInput = document.getElementById('play-feature');
  const userInput = document.getElementById('play-user');
  const promptInput = document.getElementById('play-prompt');
  const delaySlider = document.getElementById('play-delay');
  const delayVal = document.getElementById('delay-val');
  const sendBtn = document.getElementById('btn-send-proxy');

  delaySlider.addEventListener('input', (e) => {
    delayVal.textContent = e.target.value;
  });

  document.querySelectorAll('.preset-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const presetKey = chip.dataset.preset;
      const p = PRESETS[presetKey];
      if (p) {
        modelSelect.value = p.model;
        teamInput.value = p.team;
        featureInput.value = p.feature;
        userInput.value = p.user;
        promptInput.value = p.prompt;
      }
    });
  });

  sendBtn.addEventListener('click', executeProxyRequest);

  document.getElementById('btn-batch-25').addEventListener('click', () => triggerBatchTraffic(25));
  document.getElementById('btn-batch-50').addEventListener('click', () => triggerBatchTraffic(50));
  document.getElementById('btn-batch-100').addEventListener('click', () => triggerBatchTraffic(100));
}

async function executeProxyRequest() {
  const model = document.getElementById('play-model').value || 'gpt-4o';
  const team = document.getElementById('play-team').value || 'Core Engineering';
  const feature = document.getElementById('play-feature').value || 'Code Review Assistant';
  const user = document.getElementById('play-user').value || 'alex.dev';
  const prompt = document.getElementById('play-prompt').value || 'Hello';
  const stream = document.getElementById('play-stream').checked;
  const delay = document.getElementById('play-delay').value;

  const outputEl = document.getElementById('response-output');
  const statusBadge = document.getElementById('response-status-badge');
  const sendBtn = document.getElementById('btn-send-proxy');

  statusBadge.className = 'badge badge-model';
  statusBadge.textContent = 'Processing...';
  sendBtn.disabled = true;
  outputEl.textContent = '';

  const startTime = Date.now();

  try {
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-team': team,
        'x-feature': feature,
        'x-user': user,
        'x-simulated-delay': delay
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        stream: stream
      })
    });

    if (res.status === 429) {
      const errJson = await res.json();
      statusBadge.className = 'badge badge-fail';
      statusBadge.textContent = '429 Policy Exceeded';
      outputEl.textContent = `🛑 REQUEST BLOCKED BY FINOPS POLICY:\n${errJson.error?.message || 'Budget exceeded'}`;
      return;
    }

    if (stream) {
      statusBadge.className = 'badge badge-pass';
      statusBadge.textContent = 'Streaming 200 OK';

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamBuffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              outputEl.textContent += delta;
              outputEl.scrollTop = outputEl.scrollHeight;
            }
            if (parsed.usage) {
              updateTelemetryCard(
                parsed.cost_metadata?.total_cost_usd || 0,
                parsed.usage.prompt_tokens,
                parsed.usage.cached_tokens || 0,
                parsed.usage.completion_tokens,
                parsed.usage.total_tokens,
                Date.now() - startTime,
                parsed.cost_metadata?.rates
              );
            }
          } catch (e) {}
        }
      }
    } else {
      const json = await res.json();
      statusBadge.className = 'badge badge-pass';
      statusBadge.textContent = '200 OK';
      outputEl.textContent = json.choices?.[0]?.message?.content || JSON.stringify(json, null, 2);

      const cost = json.cost_metadata?.total_cost_usd || 0;
      const promptTokens = json.usage?.prompt_tokens || 0;
      const cachedTokens = json.usage?.cached_tokens || 0;
      const compTokens = json.usage?.completion_tokens || 0;
      const totalTokens = json.usage?.total_tokens || 0;
      const latency = json.cost_metadata?.latency_ms || (Date.now() - startTime);

      updateTelemetryCard(cost, promptTokens, cachedTokens, compTokens, totalTokens, latency, json.cost_metadata?.rates_per_million);
    }

    fetchAnalytics();
    if (state.currentTab === 'requests') fetchRequests();
    fetchBudgets();

  } catch (err) {
    statusBadge.className = 'badge badge-fail';
    statusBadge.textContent = 'Error';
    outputEl.textContent = `Proxy request failed: ${err.message}`;
  } finally {
    sendBtn.disabled = false;
  }
}

function updateTelemetryCard(cost, promptTokens, cachedTokens, compTokens, totalTokens, latency, rates) {
  document.getElementById('tel-cost').textContent = `$${Number(cost).toFixed(6)}`;
  document.getElementById('tel-prompt-tokens').textContent = Number(promptTokens).toLocaleString();
  document.getElementById('tel-cached-tokens').textContent = Number(cachedTokens || 0).toLocaleString();
  document.getElementById('tel-comp-tokens').textContent = Number(compTokens).toLocaleString();
  document.getElementById('tel-total-tokens').textContent = Number(totalTokens).toLocaleString();
  document.getElementById('tel-latency').textContent = `${latency} ms`;

  if (rates) {
    document.getElementById('math-formula-content').innerHTML = `
      <code>
        Input: (${promptTokens} / 1M) × $${rates.inputPerMillion} = $${((promptTokens / 1e6) * rates.inputPerMillion).toFixed(6)}<br>
        Cached: (${cachedTokens} / 1M) × $${rates.cachedPerMillion || 0} = $${((cachedTokens / 1e6) * (rates.cachedPerMillion || 0)).toFixed(6)}<br>
        Output: (${compTokens} / 1M) × $${rates.outputPerMillion} = $${((compTokens / 1e6) * rates.outputPerMillion).toFixed(6)}<br>
        <strong>Total Cost = $${Number(cost).toFixed(6)} USD</strong>
      </code>
    `;
  }
}

async function triggerBatchTraffic(count) {
  const btn = document.getElementById(`btn-batch-${count}`);
  const originalText = btn.innerHTML;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating...`;
  btn.disabled = true;

  try {
    const res = await fetch('/api/simulate/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count })
    });
    const json = await res.json();
    alert(`Generated ${json.seeded} realistic multi-tenant requests across teams!`);
    fetchAnalytics();
    fetchRequests();
    fetchBudgets();
  } catch (e) {
    alert('Failed to generate traffic');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// 7. Pricing Registry Management
// ---------------------------------------------------------------------
async function fetchPricing() {
  try {
    const res = await fetch('/api/pricing');
    const json = await res.json();
    if (!json.success) return;

    state.pricing = json.pricing;
    renderPricingTable(json.pricing);
    populatePlaygroundModels(json.pricing);
  } catch (err) {
    console.error('Failed to load pricing:', err);
  }
}

function renderPricingTable(pricing) {
  const tbody = document.getElementById('pricing-tbody');
  if (!tbody) return;

  tbody.innerHTML = pricing.map(p => `
    <tr>
      <td><span class="badge badge-model">${escapeHtml(p.model_id)}</span></td>
      <td><strong>${escapeHtml(p.display_name)}</strong></td>
      <td><span class="badge badge-neutral">${escapeHtml(p.provider)}</span></td>
      <td class="mono" style="color:var(--accent-cyan);font-weight:600;">$${Number(p.input_cost_per_million).toFixed(4)}</td>
      <td class="mono" style="color:var(--accent-emerald);font-weight:600;">$${Number(p.cached_cost_per_million || 0).toFixed(4)}</td>
      <td class="mono" style="color:var(--accent-purple);font-weight:600;">$${Number(p.output_cost_per_million).toFixed(4)}</td>
      <td class="mono" style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(p.version)} • ${escapeHtml(p.source)}</td>
      <td><span class="badge ${p.verified ? 'badge-pass' : 'badge-neutral'}">${p.verified ? 'Verified' : 'Unverified'}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm btn-edit-pricing" data-id="${p.model_id}">
          <i class="fa-solid fa-pen-to-square"></i> Edit
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-edit-pricing').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = pricing.find(p => p.model_id === btn.dataset.id);
      if (item) openPricingModal(item);
    });
  });
}

function populatePlaygroundModels(pricing) {
  const select = document.getElementById('play-model');
  if (!select) return;

  select.innerHTML = pricing.map(p => `
    <option value="${p.model_id}">${p.display_name} ($${p.input_cost_per_million}/$${p.output_cost_per_million} per 1M)</option>
  `).join('');
}

function setupPricingControls() {
  const addBtn = document.getElementById('btn-add-model');
  if (addBtn) addBtn.addEventListener('click', () => openPricingModal());

  const form = document.getElementById('form-pricing');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const modelId = document.getElementById('price-model-id').value.trim();
      const displayName = document.getElementById('price-display-name').value.trim();
      const provider = document.getElementById('price-provider').value.trim();
      const inputRate = parseFloat(document.getElementById('price-input-rate').value);
      const outputRate = parseFloat(document.getElementById('price-output-rate').value);
      const cachedRate = parseFloat(document.getElementById('price-cached-rate').value || 0);

      try {
        await fetch('/api/pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model_id: modelId,
            display_name: displayName,
            provider: provider,
            input_cost_per_million: inputRate,
            output_cost_per_million: outputRate,
            cached_cost_per_million: cachedRate
          })
        });

        document.getElementById('modal-pricing').classList.remove('open');
        fetchPricing();
      } catch (err) {
        alert('Failed to save model pricing');
      }
    });
  }
}

function openPricingModal(item = null) {
  const modal = document.getElementById('modal-pricing');
  const title = document.getElementById('modal-pricing-title');
  const idInput = document.getElementById('price-model-id');
  const nameInput = document.getElementById('price-display-name');
  const provInput = document.getElementById('price-provider');
  const inRate = document.getElementById('price-input-rate');
  const outRate = document.getElementById('price-output-rate');
  const cachedRate = document.getElementById('price-cached-rate');

  if (item) {
    title.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit Pricing: ${item.model_id}`;
    idInput.value = item.model_id;
    idInput.readOnly = true;
    nameInput.value = item.display_name;
    provInput.value = item.provider;
    inRate.value = item.input_cost_per_million;
    outRate.value = item.output_cost_per_million;
    cachedRate.value = item.cached_cost_per_million || 0;
  } else {
    title.innerHTML = `<i class="fa-solid fa-plus"></i> Add Custom Model Pricing`;
    idInput.value = '';
    idInput.readOnly = false;
    nameInput.value = '';
    provInput.value = 'Custom';
    inRate.value = '';
    outRate.value = '';
    cachedRate.value = '0.0';
  }

  modal.classList.add('open');
}

// ---------------------------------------------------------------------
// 8. Evaluation & Verification Suite
// ---------------------------------------------------------------------
function setupEvaluationControls() {
  const runBtn = document.getElementById('btn-run-eval');
  const downloadCsvBtn = document.getElementById('btn-download-eval-csv');
  const downloadJsonBtn = document.getElementById('btn-download-eval-json');

  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      runBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Running Suite...`;
      runBtn.disabled = true;

      try {
        const res = await fetch('/api/evaluation/run', { method: 'POST' });
        const json = await res.json();
        if (json.success) {
          state.evaluationReport = json.report;
          renderEvaluationReport(json.report);
        }
      } catch (err) {
        alert('Failed to run evaluation suite');
      } finally {
        runBtn.innerHTML = `<i class="fa-solid fa-play"></i> Run Verification Suite`;
        runBtn.disabled = false;
      }
    });
  }

  if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener('click', () => {
      window.open('/api/evaluation/export?format=csv', '_blank');
    });
  }

  if (downloadJsonBtn) {
    downloadJsonBtn.addEventListener('click', () => {
      window.open('/api/evaluation/export?format=json', '_blank');
    });
  }
}

async function fetchEvaluationReport() {
  try {
    const res = await fetch('/api/evaluation/latest');
    const json = await res.json();
    if (json.success) {
      state.evaluationReport = json.report;
      renderEvaluationReport(json.report);
    }
  } catch (err) {
    console.error('Failed to load evaluation report:', err);
  }
}

function renderEvaluationReport(report) {
  if (!report) return;

  const verdictBadge = document.getElementById('eval-verdict-badge');
  const verdictDesc = document.getElementById('eval-verdict-desc');
  const evalTimestamp = document.getElementById('eval-timestamp');
  const evalScoreText = document.getElementById('eval-score-text');

  if (report.summary.status === 'PASS') {
    verdictBadge.className = 'banner-badge';
    verdictBadge.style.background = 'var(--accent-emerald)';
    verdictBadge.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${report.summary.accuracyPercentage}% ACCURATE`;
  } else {
    verdictBadge.className = 'banner-badge';
    verdictBadge.style.background = 'var(--accent-rose)';
    verdictBadge.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> MISMATCH DETECTED`;
  }

  verdictDesc.textContent = report.summary.verdict;
  evalTimestamp.innerHTML = `<i class="fa-regular fa-clock"></i> Evaluated: ${new Date(report.timestamp).toLocaleString()}`;
  evalScoreText.innerHTML = `<i class="fa-solid fa-shield-check"></i> Passed: ${report.summary.passedCount} / ${report.summary.totalTests} tests (Abs Error: $${report.summary.totalAbsoluteError.toFixed(6)})`;

  // 1. Aggregate table
  const aggTbody = document.getElementById('eval-aggregate-tbody');
  const agg = report.aggregateVerification;
  aggTbody.innerHTML = `
    <tr>
      <td><strong>Total Requests</strong></td>
      <td class="mono">${agg.requests.expected}</td>
      <td class="mono">${agg.requests.actual}</td>
      <td class="mono">0</td>
      <td><span class="badge ${agg.requests.match ? 'badge-pass' : 'badge-fail'}">${agg.requests.match ? 'MATCH' : 'MISMATCH'}</span></td>
    </tr>
    <tr>
      <td><strong>Total Prompt Tokens</strong></td>
      <td class="mono">${agg.promptTokens.expected.toLocaleString()}</td>
      <td class="mono">${agg.promptTokens.actual.toLocaleString()}</td>
      <td class="mono">0</td>
      <td><span class="badge ${agg.promptTokens.match ? 'badge-pass' : 'badge-fail'}">${agg.promptTokens.match ? 'MATCH' : 'MISMATCH'}</span></td>
    </tr>
    <tr>
      <td><strong>Total Cached Tokens</strong></td>
      <td class="mono">${agg.cachedTokens.expected.toLocaleString()}</td>
      <td class="mono">${agg.cachedTokens.actual.toLocaleString()}</td>
      <td class="mono">0</td>
      <td><span class="badge ${agg.cachedTokens.match ? 'badge-pass' : 'badge-fail'}">${agg.cachedTokens.match ? 'MATCH' : 'MISMATCH'}</span></td>
    </tr>
    <tr>
      <td><strong>Total Completion Tokens</strong></td>
      <td class="mono">${agg.completionTokens.expected.toLocaleString()}</td>
      <td class="mono">${agg.completionTokens.actual.toLocaleString()}</td>
      <td class="mono">0</td>
      <td><span class="badge ${agg.completionTokens.match ? 'badge-pass' : 'badge-fail'}">${agg.completionTokens.match ? 'MATCH' : 'MISMATCH'}</span></td>
    </tr>
    <tr>
      <td><strong>Total Tokens</strong></td>
      <td class="mono"><strong>${agg.totalTokens.expected.toLocaleString()}</strong></td>
      <td class="mono"><strong>${agg.totalTokens.actual.toLocaleString()}</strong></td>
      <td class="mono">0</td>
      <td><span class="badge ${agg.totalTokens.match ? 'badge-pass' : 'badge-fail'}">${agg.totalTokens.match ? 'MATCH' : 'MISMATCH'}</span></td>
    </tr>
    <tr>
      <td><strong>Total Calculated Cost</strong></td>
      <td class="mono" style="color:var(--accent-emerald);font-weight:700;">$${agg.totalCost.expected.toFixed(6)}</td>
      <td class="mono" style="color:var(--accent-emerald);font-weight:700;">$${agg.totalCost.actual.toFixed(6)}</td>
      <td class="mono">$${agg.totalCost.absError.toFixed(6)}</td>
      <td><span class="badge ${agg.totalCost.match ? 'badge-pass' : 'badge-fail'}">${agg.totalCost.match ? 'MATCH' : 'MISMATCH'}</span></td>
    </tr>
  `;

  // 2. Unit benchmark matrix table
  const matrixTbody = document.getElementById('eval-matrix-tbody');
  matrixTbody.innerHTML = report.unitTestMatrix.map(t => `
    <tr>
      <td class="mono">${t.testId}</td>
      <td><span class="badge badge-model">${t.model}</span></td>
      <td><span class="badge badge-neutral">${t.provider}</span></td>
      <td>${escapeHtml(t.team)}</td>
      <td>${escapeHtml(t.description)}</td>
      <td class="mono">${t.promptTokens.toLocaleString()}</td>
      <td class="mono">${(t.cachedTokens || 0).toLocaleString()}</td>
      <td class="mono">${t.completionTokens.toLocaleString()}</td>
      <td class="mono">${t.totalTokens.toLocaleString()}</td>
      <td class="mono">$${t.expectedCost.toFixed(6)}</td>
      <td class="mono" style="color:var(--accent-emerald);font-weight:700;">$${t.actualCost.toFixed(6)}</td>
      <td class="mono">$${t.absError.toFixed(6)}</td>
      <td><span class="badge ${t.status === 'PASS' ? 'badge-pass' : 'badge-fail'}">${t.status}</span></td>
    </tr>
  `).join('');

  // 3. Team attribution breakdown table
  const teamTbody = document.getElementById('eval-team-tbody');
  teamTbody.innerHTML = report.teamBreakdownVerification.map(tb => `
    <tr>
      <td><strong>${escapeHtml(tb.team)}</strong></td>
      <td class="mono">$${tb.expectedCost.toFixed(6)}</td>
      <td class="mono" style="color:var(--accent-emerald);font-weight:700;">$${tb.actualCost.toFixed(6)}</td>
      <td class="mono">$${tb.absError.toFixed(6)}</td>
      <td><span class="badge ${tb.status === 'PASS' ? 'badge-pass' : 'badge-fail'}">${tb.status}</span></td>
    </tr>
  `).join('');
}

// ---------------------------------------------------------------------
// 9. Modals (Detail Drawer, Replay & Pricing)
// ---------------------------------------------------------------------
function setupModals() {
  const reqModal = document.getElementById('modal-request-detail');
  const closeBtn = document.getElementById('modal-close-btn');
  const closeFooter = document.getElementById('modal-req-close-footer');
  const replayBtn = document.getElementById('modal-replay-btn');

  if (closeBtn) closeBtn.addEventListener('click', () => reqModal.classList.remove('open'));
  if (closeFooter) closeFooter.addEventListener('click', () => reqModal.classList.remove('open'));

  if (replayBtn) {
    replayBtn.addEventListener('click', async () => {
      if (!state.activeInspectRequest) return;
      replayBtn.disabled = true;
      replayBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Replaying...`;

      try {
        const res = await fetch(`/api/requests/${state.activeInspectRequest.id}/replay`, { method: 'POST' });
        const json = await res.json();
        alert(`Request successfully replayed! New Request ID: ${json.id || 'Recorded'}`);
        reqModal.classList.remove('open');
        fetchAnalytics();
        fetchRequests();
      } catch (e) {
        alert('Replay failed: ' + e.message);
      } finally {
        replayBtn.disabled = false;
        replayBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Replay Request Through Proxy`;
      }
    });
  }

  const budgetModal = document.getElementById('modal-budget');
  const budgetClose = document.getElementById('modal-budget-close');
  const budgetCancel = document.getElementById('modal-budget-cancel');

  if (budgetClose) budgetClose.addEventListener('click', () => budgetModal.classList.remove('open'));
  if (budgetCancel) budgetCancel.addEventListener('click', () => budgetModal.classList.remove('open'));

  const pricingModal = document.getElementById('modal-pricing');
  const pricingClose = document.getElementById('modal-pricing-close');
  const pricingCancel = document.getElementById('modal-pricing-cancel');

  if (pricingClose) pricingClose.addEventListener('click', () => pricingModal.classList.remove('open'));
  if (pricingCancel) pricingCancel.addEventListener('click', () => pricingModal.classList.remove('open'));

  window.addEventListener('click', (e) => {
    if (e.target === reqModal) reqModal.classList.remove('open');
    if (e.target === budgetModal) budgetModal.classList.remove('open');
    if (e.target === pricingModal) pricingModal.classList.remove('open');
  });
}

function openRequestModal(r) {
  state.activeInspectRequest = r;
  const modal = document.getElementById('modal-request-detail');
  const body = document.getElementById('modal-request-body');

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div>
        <span class="subtext-note">Request ID</span>
        <div class="mono" style="font-weight:600;font-size:0.85rem;">${r.id}</div>
      </div>
      <div>
        <span class="subtext-note">Timestamp</span>
        <div class="mono" style="font-size:0.85rem;">${new Date(r.timestamp).toLocaleString()}</div>
      </div>
      <div>
        <span class="subtext-note">Attributed Team</span>
        <div><strong>${escapeHtml(r.team)}</strong></div>
      </div>
      <div>
        <span class="subtext-note">Feature & User</span>
        <div>${escapeHtml(r.feature)} • <span class="mono">${escapeHtml(r.user_id)}</span></div>
      </div>
      <div>
        <span class="subtext-note">Model & Provider</span>
        <div><span class="badge badge-model">${escapeHtml(r.model)}</span> (${r.provider})</div>
      </div>
      <div>
        <span class="subtext-note">Latency & Usage Source</span>
        <div class="mono">${r.latency_ms} ms • ${r.usage_source} (${r.is_stream ? 'Stream SSE' : 'JSON'})</div>
      </div>
    </div>

    <div style="background:var(--bg-base);border:1px solid var(--border-subtle);border-radius:6px;padding:12px;margin-bottom:16px;">
      <div style="font-size:0.78rem;font-weight:600;color:var(--accent-cyan);margin-bottom:6px;">
        <i class="fa-solid fa-coins"></i> Token & Pricing Calculation Breakdown
      </div>
      <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:8px;font-size:0.8rem;" class="mono">
        <div>Prompt: <strong>${r.prompt_tokens}</strong> ($${r.prompt_cost.toFixed(6)})</div>
        <div>Cached: <strong>${r.cached_tokens || 0}</strong> ($${(r.cached_cost || 0).toFixed(6)})</div>
        <div>Comp: <strong>${r.completion_tokens}</strong> ($${r.completion_cost.toFixed(6)})</div>
        <div>Total: <strong>${r.total_tokens}</strong></div>
        <div style="color:var(--accent-emerald);font-weight:700;">Cost: $${r.total_cost.toFixed(6)}</div>
      </div>
    </div>

    <div style="margin-bottom:14px;">
      <span class="subtext-note" style="display:block;margin-bottom:4px;">Prompt Payload:</span>
      <pre style="background:var(--bg-base);padding:10px;border-radius:6px;font-size:0.78rem;border:1px solid var(--border-subtle);white-space:pre-wrap;max-height:120px;overflow-y:auto;" class="mono">${escapeHtml(r.prompt_preview || '(none)')}</pre>
    </div>

    <div>
      <span class="subtext-note" style="display:block;margin-bottom:4px;">Generated Response:</span>
      <pre style="background:var(--bg-base);padding:10px;border-radius:6px;font-size:0.78rem;border:1px solid var(--border-subtle);white-space:pre-wrap;max-height:150px;overflow-y:auto;" class="mono">${escapeHtml(r.response_preview || '(none)')}</pre>
    </div>
  `;

  modal.classList.add('open');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
