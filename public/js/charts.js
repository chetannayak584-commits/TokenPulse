// public/js/charts.js
// Chart.js visualizations for LLM spend, token breakdowns, and team attributions

let timelineChart = null;
let teamDonutChart = null;
let modelTokensChart = null;
let featureCostsChart = null;

const THEME_COLORS = [
  '#6366f1', // Indigo
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#a855f7', // Purple
  '#3b82f6', // Blue
  '#ec4899'  // Pink
];

const TEAM_COLORS = {
  'Core Engineering': '#6366f1',
  'Customer Support': '#f59e0b',
  'Data Science': '#10b981',
  'Marketing & Content': '#f43f5e',
  'Product Growth': '#06b6d4',
  'Unassigned': '#a855f7'
};

const PALETTE = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e',
  '#a855f7', '#3b82f6', '#ec4899', '#14b8a6', '#eab308'
];

// Center stat cutout plugin for the Donut Chart
const centerDoughnutPlugin = {
  id: 'centerDoughnutPlugin',
  afterDraw(chart) {
    if (chart.config.type !== 'doughnut') return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const dataset = chart.data.datasets[0];
    if (!dataset) return;
    
    const total = dataset.data.reduce((a, b) => a + (Number(b) || 0), 0);
    const hasData = total > 0 && chart.data.labels[0] !== 'No spend in filter';
    
    const centerX = (chartArea.left + chartArea.right) / 2;
    const centerY = (chartArea.top + chartArea.bottom) / 2;
    
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (hasData) {
      ctx.font = '700 15px "JetBrains Mono", monospace';
      ctx.fillStyle = '#f8fafc';
      const formattedTotal = total >= 10 ? `$${total.toFixed(2)}` : `$${total.toFixed(4)}`;
      ctx.fillText(formattedTotal, centerX, centerY - 8);
      
      ctx.font = '500 10px Inter, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('Filtered Spend', centerX, centerY + 10);
    } else {
      ctx.font = '600 13px Inter, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText('$0.00', centerX, centerY - 7);
      
      ctx.font = '400 10px Inter, sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText('No Spend', centerX, centerY + 9);
    }
    
    ctx.restore();
  }
};

// Initialize and update all dashboard charts
export function updateDashboardCharts(analytics, filters = {}) {
  renderTimelineChart(analytics.time_series || []);
  renderTeamDonutChart(analytics, filters);
  renderModelTokensChart(analytics.by_model || []);
  renderFeatureCostsChart(analytics.by_feature || []);
}

// 1. Timeline Chart (Spend over time)
function renderTimelineChart(timeSeriesData) {
  const ctx = document.getElementById('chart-timeline');
  if (!ctx) return;

  const labels = timeSeriesData.map(d => d.time_label || 'Time');
  const costData = timeSeriesData.map(d => d.total_cost || 0);

  if (timelineChart) {
    timelineChart.destroy();
  }

  const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
  gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

  timelineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length > 0 ? labels : ['No data'],
      datasets: [{
        label: 'Spend ($ USD)',
        data: costData.length > 0 ? costData : [0],
        borderColor: '#6366f1',
        borderWidth: 2.5,
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#6366f1',
        pointRadius: 3,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#94a3b8',
          bodyColor: '#f8fafc',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => ` Spend: $${Number(ctx.raw).toFixed(5)}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { color: '#64748b', font: { size: 10, family: 'JetBrains Mono' }, maxRotation: 45 }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.06)' },
          ticks: {
            color: '#64748b',
            font: { size: 10, family: 'JetBrains Mono' },
            callback: (v) => `$${Number(v).toFixed(3)}`
          }
        }
      }
    }
  });
}

// 2. Team Donut Chart (Spend attribution & Share of Wallet)
function renderTeamDonutChart(analyticsOrData, filters = {}) {
  const ctx = document.getElementById('chart-team-donut');
  if (!ctx) return;

  const isAnalyticsObj = analyticsOrData && typeof analyticsOrData === 'object' && !Array.isArray(analyticsOrData);
  const byTeamData = isAnalyticsObj ? (analyticsOrData.by_team || []) : (analyticsOrData || []);
  const byFeatureData = isAnalyticsObj ? (analyticsOrData.by_feature || []) : [];
  const byModelData = isAnalyticsObj ? (analyticsOrData.by_model || []) : [];

  let labels = [];
  let data = [];
  let bgColors = [];
  let cardTitle = '<i class="fa-solid fa-chart-pie"></i> Spend Attribution by Team';
  let cardBadge = 'Share of Wallet';

  const hasTeamFilter = filters.team && filters.team !== 'all';
  const hasFeatureFilter = filters.feature && filters.feature !== 'all';
  const hasProviderFilter = filters.provider && filters.provider !== 'all';
  const hasModelFilter = filters.model && filters.model !== 'all';

  if (hasTeamFilter) {
    // Mode 1: Specific Team filtered -> Attribute that team's spend across its Features
    const teamName = filters.team;
    cardTitle = `<i class="fa-solid fa-chart-pie"></i> Spend Attribution: ${teamName}`;
    cardBadge = 'Feature Breakdown';

    const teamFeatures = byFeatureData.filter(f => !f.team || f.team.toLowerCase() === teamName.toLowerCase());
    const items = teamFeatures.length > 0 ? teamFeatures : byFeatureData;

    if (items.length > 0 && items.some(f => (f.total_cost || 0) > 0)) {
      labels = items.map(f => f.feature);
      data = items.map(f => f.total_cost || 0);
      bgColors = items.map((_, i) => PALETTE[i % PALETTE.length]);
    } else if (byTeamData.length > 0 && byTeamData.some(t => (t.total_cost || 0) > 0)) {
      labels = byTeamData.map(t => t.team);
      data = byTeamData.map(t => t.total_cost || 0);
      bgColors = [TEAM_COLORS[teamName] || PALETTE[0]];
      cardBadge = 'Team Total';
    } else {
      labels = [`No spend for ${teamName}`];
      data = [0];
      bgColors = ['rgba(255, 255, 255, 0.08)'];
    }
  } else if (hasFeatureFilter) {
    // Mode 2: Specific Feature filtered -> Show model breakdown or team distribution for that feature
    const featName = filters.feature;
    cardTitle = `<i class="fa-solid fa-chart-pie"></i> Spend Attribution: ${featName}`;

    if (byTeamData.length > 1) {
      cardBadge = 'Team Distribution';
      labels = byTeamData.map(t => t.team);
      data = byTeamData.map(t => t.total_cost || 0);
      bgColors = labels.map(l => TEAM_COLORS[l] || PALETTE[0]);
    } else if (byModelData.length > 0 && byModelData.some(m => (m.total_cost || 0) > 0)) {
      cardBadge = 'Model Breakdown';
      const modelMap = new Map();
      byModelData.forEach(m => {
        const cur = modelMap.get(m.model) || 0;
        modelMap.set(m.model, cur + (m.total_cost || 0));
      });
      const topModels = Array.from(modelMap.entries())
        .map(([model, cost]) => ({ model, cost }))
        .sort((a, b) => b.cost - a.cost);
      labels = topModels.map(m => m.model);
      data = topModels.map(m => m.cost);
      bgColors = labels.map((_, i) => PALETTE[i % PALETTE.length]);
    } else if (byTeamData.length > 0 && byTeamData.some(t => (t.total_cost || 0) > 0)) {
      cardBadge = 'Team Attribution';
      labels = byTeamData.map(t => t.team);
      data = byTeamData.map(t => t.total_cost || 0);
      bgColors = labels.map(l => TEAM_COLORS[l] || PALETTE[0]);
    } else {
      labels = [`No spend for ${featName}`];
      data = [0];
      bgColors = ['rgba(255, 255, 255, 0.08)'];
    }
  } else if (hasProviderFilter) {
    // Mode 3: Provider filtered -> Show team distribution for that provider
    cardTitle = `<i class="fa-solid fa-chart-pie"></i> Spend Attribution: ${filters.provider}`;
    cardBadge = 'Team Share';
    const items = byTeamData.filter(t => (t.total_cost || 0) > 0);
    if (items.length > 0) {
      labels = items.map(t => t.team);
      data = items.map(t => t.total_cost || 0);
      bgColors = labels.map(l => TEAM_COLORS[l] || PALETTE[0]);
    } else {
      labels = [`No spend for ${filters.provider}`];
      data = [0];
      bgColors = ['rgba(255, 255, 255, 0.08)'];
    }
  } else if (hasModelFilter) {
    // Mode 4: Model filtered -> Show team distribution for that model
    cardTitle = `<i class="fa-solid fa-chart-pie"></i> Spend Attribution: ${filters.model}`;
    cardBadge = 'Team Share';
    const items = byTeamData.filter(t => (t.total_cost || 0) > 0);
    if (items.length > 0) {
      labels = items.map(t => t.team);
      data = items.map(t => t.total_cost || 0);
      bgColors = labels.map(l => TEAM_COLORS[l] || PALETTE[0]);
    } else {
      labels = [`No spend for ${filters.model}`];
      data = [0];
      bgColors = ['rgba(255, 255, 255, 0.08)'];
    }
  } else {
    // Mode 5: All Teams & Features (or Time Window only) -> Standard spend attribution across all teams
    cardTitle = '<i class="fa-solid fa-chart-pie"></i> Spend Attribution by Team';
    cardBadge = 'Share of Wallet';
    const items = byTeamData.filter(t => (t.total_cost || 0) > 0);
    if (items.length > 0) {
      labels = items.map(t => t.team);
      data = items.map(t => t.total_cost || 0);
      bgColors = labels.map(l => TEAM_COLORS[l] || PALETTE[0]);
    } else {
      labels = ['No spend in filter'];
      data = [0];
      bgColors = ['rgba(255, 255, 255, 0.08)'];
    }
  }

  // Update card header title and badge in DOM
  const titleEl = document.getElementById('title-team-donut') || ctx.closest('.chart-card')?.querySelector('.card-title');
  const badgeEl = document.getElementById('badge-team-donut') || ctx.closest('.chart-card')?.querySelector('.card-badge');
  if (titleEl) titleEl.innerHTML = cardTitle;
  if (badgeEl) badgeEl.textContent = cardBadge;

  // Safely destroy previous Chart.js instances on this canvas
  if (teamDonutChart) {
    teamDonutChart.destroy();
    teamDonutChart = null;
  }
  const existingChart = Chart.getChart(ctx);
  if (existingChart) {
    existingChart.destroy();
  }

  const hasData = data.length > 0 && data.some(v => v > 0);
  const chartData = hasData ? data : [1];
  const chartColors = hasData ? bgColors : ['rgba(255, 255, 255, 0.08)'];

  teamDonutChart = new Chart(ctx, {
    type: 'doughnut',
    plugins: [centerDoughnutPlugin],
    data: {
      labels,
      datasets: [{
        data: chartData,
        backgroundColor: chartColors,
        borderColor: '#0f1523',
        borderWidth: 3,
        hoverOffset: hasData ? 6 : 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: {
        animateRotate: true,
        animateScale: false,
        duration: 450
      },
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#94a3b8',
            font: { size: 11, family: 'Inter' },
            boxWidth: 12,
            padding: 8,
            generateLabels: function(chart) {
              const d = chart.data;
              if (d.labels && d.labels.length && d.datasets && d.datasets.length) {
                const ds = d.datasets[0];
                const total = ds.data.reduce((a, b) => a + (Number(b) || 0), 0);
                return d.labels.map((lbl, i) => {
                  const val = Number(ds.data[i]) || 0;
                  const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
                  const text = hasData
                    ? `${lbl} — $${val.toFixed(val >= 1 ? 2 : 4)} (${pct}%)`
                    : lbl;
                  return {
                    text,
                    fillStyle: ds.backgroundColor[i] || '#6366f1',
                    strokeStyle: ds.borderColor || '#0f1523',
                    lineWidth: 1,
                    hidden: isNaN(ds.data[i]) || chart.getDatasetMeta(0).data[i]?.hidden,
                    index: i
                  };
                });
              }
              return [];
            }
          }
        },
        tooltip: {
          backgroundColor: '#0f172a',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (item) => {
              if (!hasData) return ' No spend in this filter';
              const val = Number(item.raw) || 0;
              const total = item.dataset.data.reduce((a, b) => a + (Number(b) || 0), 0);
              const pct = total > 0 ? ((val / total) * 100).toFixed(2) : '0.00';
              return ` ${item.label}: $${val.toFixed(4)} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// 3. Model Tokens Chart (Stacked Prompt vs Completion)
function renderModelTokensChart(byModelData) {
  const ctx = document.getElementById('chart-model-tokens');
  if (!ctx) return;

  const hasData = byModelData && byModelData.length > 0 && byModelData.some(m => (m.prompt_tokens || 0) > 0 || (m.completion_tokens || 0) > 0);
  const labels = hasData ? byModelData.map(m => m.model) : ['No token activity'];
  const promptTokens = hasData ? byModelData.map(m => m.prompt_tokens) : [0];
  const completionTokens = hasData ? byModelData.map(m => m.completion_tokens) : [0];

  if (modelTokensChart) {
    modelTokensChart.destroy();
  }

  modelTokensChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Prompt Tokens (Input)',
          data: promptTokens,
          backgroundColor: '#06b6d4',
          borderRadius: 4
        },
        {
          label: 'Completion Tokens (Output)',
          data: completionTokens,
          backgroundColor: '#a855f7',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: '#64748b', font: { size: 10, family: 'JetBrains Mono' } }
        },
        y: {
          stacked: true,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#64748b',
            font: { size: 10, family: 'JetBrains Mono' },
            callback: (v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 10 }
        },
        tooltip: {
          backgroundColor: '#0f172a',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString()} tokens`
          }
        }
      }
    }
  });
}

// 4. Feature Costs Chart (Horizontal bar)
function renderFeatureCostsChart(byFeatureData) {
  const ctx = document.getElementById('chart-feature-costs');
  if (!ctx) return;

  const topFeatures = (byFeatureData || []).slice(0, 8);
  const hasData = topFeatures.length > 0 && topFeatures.some(f => (f.total_cost || 0) > 0);
  const labels = hasData ? topFeatures.map(f => f.feature) : ['No feature spend'];
  const costs = hasData ? topFeatures.map(f => f.total_cost) : [0];

  if (featureCostsChart) {
    featureCostsChart.destroy();
  }

  featureCostsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Cost ($ USD)',
        data: costs,
        backgroundColor: '#10b981',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => ` Spend: $${Number(ctx.raw).toFixed(5)}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#64748b',
            font: { size: 10, family: 'JetBrains Mono' },
            callback: (v) => `$${Number(v).toFixed(3)}`
          }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 11, family: 'Inter' } }
        }
      }
    }
  });
}
