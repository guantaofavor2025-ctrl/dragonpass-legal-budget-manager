// ============================================================
// DragonPass Legal & Compliance — Budget Management Platform
// app.js — Application State & Logic
// ============================================================

// ── Initial Data ────────────────────────────────────────────

const BACKOFFICE_SUBCATEGORIES = [
  { id: 'gc-office', name: 'General Counsel Office' },
  { id: 'litigation', name: 'Litigation & Disputes' },
  { id: 'corporate', name: 'Corporate & Transactions' },
  { id: 'contracts', name: 'Contracts & Commercial' },
  { id: 'ip', name: 'Intellectual Property' },
  { id: 'compliance', name: 'Compliance & Regulatory' },
  { id: 'employment', name: 'Employment & Labor' },
  { id: 'privacy', name: 'Data Privacy & Security' },
  { id: 'reserve', name: 'Reserve / Contingency' }
];

const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'KRW', symbol: '₩', name: 'Korean Won' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' }
];

const EXCHANGE_API = 'https://open.er-api.com/v6/latest/USD';

const INITIAL_STATE = {
  currentUser: null,
  displayCurrency: 'USD',
  exchangeRates: {},
  lastRateFetch: null,
  budgetConfig: {
    totalBudget: 1223200,
    subcategoryAllocations: BACKOFFICE_SUBCATEGORIES.reduce((acc, cat, i) => {
      // Distribute default budget proportionally (approximate)
      const portions = [0.18, 0.20, 0.14, 0.12, 0.10, 0.10, 0.06, 0.05, 0.05];
      acc[cat.id] = Math.round(1223200 * portions[i]);
      return acc;
    }, {})
  },
  users: [
    {
      id: 'u1',
      email: 'tao.guan@dragonpass.com',
      name: 'Tao Guan',
      role: 'gc',
      password: 'Admin@2026',
      active: true
    }
  ],
  vendors: [],
  budgetRequests: [],
  expenses: [],
  notifications: []
};

// ── State Management ─────────────────────────────────────────

let STATE = JSON.parse(localStorage.getItem('dp_budget_state') || 'null') || JSON.parse(JSON.stringify(INITIAL_STATE));

// ── Migration: ensure all required fields exist ─────────────
function migrateState() {
  let changed = false;
  if (!STATE.budgetConfig) {
    STATE.budgetConfig = JSON.parse(JSON.stringify(INITIAL_STATE.budgetConfig));
    changed = true;
  }
  if (!STATE.budgetConfig.totalBudget) {
    STATE.budgetConfig.totalBudget = 1223200;
    changed = true;
  }
  if (!STATE.budgetConfig.subcategoryAllocations) {
    STATE.budgetConfig.subcategoryAllocations = BACKOFFICE_SUBCATEGORIES.reduce((acc, cat, i) => {
      const portions = [0.18, 0.20, 0.14, 0.12, 0.10, 0.10, 0.06, 0.05, 0.05];
      acc[cat.id] = Math.round(1223200 * portions[i]);
      return acc;
    }, {});
    changed = true;
  }
  // Ensure email config exists
  if (!STATE.emailConfig) {
    STATE.emailConfig = { serviceId: '', templateId: '', publicKey: '' };
    changed = true;
  }
  // Add owner to existing requests/expenses if missing
  [...(STATE.budgetRequests||[]), ...(STATE.expenses||[])].forEach(item => {
    if (!item.owner && item.submittedBy) { item.owner = item.submittedBy; changed = true; }
  });
  if (changed) saveState();
}
migrateState();

function saveState() {
  localStorage.setItem('dp_budget_state', JSON.stringify(STATE));
}

function resetState() {
  STATE = JSON.parse(JSON.stringify(INITIAL_STATE));
  saveState();
}

// ── Utilities ────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getRate(from, to) {
  if (from === to) return 1;
  if (!STATE.exchangeRates || !STATE.exchangeRates.rates) return 1;
  // API returns rates relative to USD
  if (from === 'USD') return STATE.exchangeRates.rates[to] || 1;
  if (to === 'USD') return 1 / (STATE.exchangeRates.rates[from] || 1);
  const fromUSD = STATE.exchangeRates.rates[from] || 1;
  const toUSD = STATE.exchangeRates.rates[to] || 1;
  return toUSD / fromUSD;
}

function convertAmount(amountUSD, targetCurrency) {
  if (targetCurrency === 'USD') return amountUSD;
  return amountUSD * getRate('USD', targetCurrency);
}

function toUSD(amount, fromCurrency) {
  if (fromCurrency === 'USD') return Number(amount);
  return Number(amount) / getRate('USD', fromCurrency);
}

function formatCurrency(n, forceCurrency) {
  if (n === null || n === undefined || n === '') return '—';
  const currency = forceCurrency || STATE.displayCurrency || 'USD';
  const curr = SUPPORTED_CURRENCIES.find(c => c.code === currency) || SUPPORTED_CURRENCIES[0];
  const converted = convertAmount(Number(n), currency);
  const decimals = ['JPY', 'KRW', 'INR'].includes(currency) ? 0 : 2;
  return curr.symbol + ' ' + Number(converted).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

async function fetchExchangeRates() {
  try {
    const resp = await fetch(EXCHANGE_API);
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && data.result === 'success' && data.rates) {
      STATE.exchangeRates = data;
      STATE.lastRateFetch = new Date().toISOString();
      saveState();
      // Refresh UI if logged in
      if (STATE.currentUser) {
        renderMain();
        // Also update currency display in topbar
        const displayEl = document.getElementById('displayCurrencySelector');
        if (displayEl) displayEl.value = STATE.displayCurrency || 'USD';
      }
    }
  } catch (e) {
    console.warn('Exchange rate fetch failed:', e.message);
  }
}

function setDisplayCurrency(code) {
  STATE.displayCurrency = code;
  saveState();
  renderMain();
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Email Notification (EmailJS or simulated fallback) ───────

function sendEmail(to, subject, body) {
  // Always store in-app notification
  const note = {
    id: genId(),
    to,
    subject,
    body,
    sentAt: new Date().toISOString(),
    read: false
  };
  STATE.notifications.push(note);
  saveState();
  console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);

  // Try sending real email via EmailJS if configured
  const cfg = STATE.emailConfig || {};
  if (cfg.serviceId && cfg.templateId && cfg.publicKey && typeof emailjs !== 'undefined') {
    emailjs.init(cfg.publicKey);
    const templateParams = {
      to_email: to,
      to_name: to.split('@')[0],
      subject: subject,
      message_body: body,
      from_name: 'DragonPass Legal Budget Manager',
      reply_to: 'tao.guan@dragonpass.com'
    };
    emailjs.send(cfg.serviceId, cfg.templateId, templateParams)
      .then(() => console.log('[EMAIL] Real email sent successfully to', to))
      .catch(err => console.warn('[EMAIL] Failed to send real email:', err?.text || err));
  }
}

// ── Email Configuration (GC only) ───────────────────────────

function renderEmailConfig(content, actions) {
  if (!isGC()) { content.innerHTML = '<p>Access denied.</p>'; return; }
  const cfg = STATE.emailConfig || { serviceId: '', templateId: '', publicKey: '', fromName: 'DragonPass Legal' };

  content.innerHTML = `
  <div class="dash-card full">
    <div class="dash-card-title">📧 Email Notification Configuration</div>
    <div style="max-width:560px;">
      <p style="color:var(--text-secondary); margin-bottom:20px; font-size:13.5px; line-height:1.6;">
        Configure real email notifications using <strong>EmailJS</strong> (free tier: 200 emails/month).
        This enables automatic email alerts when requests are submitted, approved, or rejected.
      </p>

      <div class="email-config-form">
        <div class="field-group">
          <label>EmailJS Service ID *</label>
          <input type="text" id="emailServiceId" value="${escapeHtml(cfg.serviceId)}" placeholder="e.g. service_xxxxxxxxx" />
          <div class="field-hint">From your EmailJS dashboard → Email Services → Service ID</div>
        </div>
        <div class="field-group">
          <label>EmailJS Template ID *</label>
          <input type="text" id="emailTemplateId" value="${escapeHtml(cfg.templateId)}" placeholder="e.g. template_xxxxxxxxx" />
          <div class="field-hint">Create an email template in EmailJS with variables: {{to_email}}, {{subject}}, {{message_body}}</div>
        </div>
        <div class="field-group">
          <label>EmailJS Public Key *</label>
          <input type="text" id="emailPublicKey" value="${escapeHtml(cfg.publicKey)}" placeholder="e.g. xxxxxxxx" />
          <div class="field-hint">From your EmailJS dashboard → Account → Public Key</div>
        </div>
        <div class="field-group">
          <label>Sender Display Name</label>
          <input type="text" id="emailFromName" value="${escapeHtml(cfg.fromName || 'DragonPass Legal')}" placeholder="DragonPass Legal & Compliance" />
        </div>

        <div style="margin-top:16px; padding:16px; background:var(--navy-50); border-radius:var(--radius); font-size:12.5px; line-height:1.7; color:var(--navy-800);">
          <strong>📋 Setup Instructions:</strong>
          <ol style="margin:8px 0 0 18px; padding:0;">
            <li>Create a free account at <a href="https://www.emailjs.com" target="_blank" style="color:var(--navy-500)">emailjs.com</a></li>
            <li>Add an Email Service (Gmail, Outlook, etc.) — this provides your SMTP connection</li>
            <li>Create an Email Template with these variables: <code>{{to_email}}</code>, <code>{{to_name}}</code>, <code>{{subject}}</code>, <code>{{message_body}}</code></li>
            <li>Copy your Service ID, Template ID, and Public Key into the fields above</li>
            <li>Click "Save Configuration" and then "Send Test Email" to verify</li>
          </ol>
        </div>

        <div style="display:flex; gap:10px; margin-top:16px;">
          <button class="btn btn-primary" id="saveEmailConfigBtn">💾 Save Configuration</button>
          <button class="btn btn-secondary" id="testEmailBtn">📧 Send Test Email</button>
        </div>
        <div id="emailConfigStatus" style="margin-top:10px;"></div>
      </div>
    </div>
  </div>`;

  document.getElementById('saveEmailConfigBtn').addEventListener('click', () => {
    STATE.emailConfig = {
      serviceId: document.getElementById('emailServiceId').value.trim(),
      templateId: document.getElementById('emailTemplateId').value.trim(),
      publicKey: document.getElementById('emailPublicKey').value.trim(),
      fromName: document.getElementById('emailFromName').value.trim()
    };
    saveState();
    showToast('Email configuration saved.');
    document.getElementById('emailConfigStatus').innerHTML = '<span style="color:var(--green);font-weight:600;">✓ Configuration saved successfully.</span>';
  });

  document.getElementById('testEmailBtn').addEventListener('click', () => {
    const statusEl = document.getElementById('emailConfigStatus');
    statusEl.innerHTML = '<span style="color:var(--orange)">Sending test email...</span>';
    const cfg = {
      serviceId: document.getElementById('emailServiceId').value.trim(),
      templateId: document.getElementById('emailTemplateId').value.trim(),
      publicKey: document.getElementById('emailPublicKey').value.trim()
    };
    if (!cfg.serviceId || !cfg.templateId || !cfg.publicKey) {
      statusEl.innerHTML = '<span style="color:var(--red)">⚠ Please fill in all required fields first.</span>';
      return;
    }
    if (typeof emailjs === 'undefined') {
      statusEl.innerHTML = '<span style="color:var(--red)">⚠ EmailJS library not loaded. Check internet connection.</span>';
      return;
    }
    emailjs.init(cfg.publicKey);
    emailjs.send(cfg.serviceId, cfg.templateId, {
      to_email: STATE.currentUser.email,
      to_name: STATE.currentUser.name || STATE.currentUser.email,
      subject: '🧪 DragonPass Budget Manager — Test Email',
      message_body: 'This is a test email from DragonPass Legal Budget Manager.\nIf you received this, email notifications are working correctly!',
      from_name: 'DragonPass Legal Budget Manager'
    }).then(() => {
      statusEl.innerHTML = '<span style="color:var(--green);font-weight:600;">✅ Test email sent! Check your inbox.</span>';
      showToast('Test email sent!');
    }).catch(err => {
      statusEl.innerHTML = `<span style="color:var(--red)">❌ Failed: ${err.text || 'Check your credentials and try again.'}</span>`;
    });
  });
}

// ── Auth ─────────────────────────────────────────────────────

function login(email, password) {
  const user = STATE.users.find(u => u.email === email && u.password === password && u.active);
  if (!user) return false;
  STATE.currentUser = user;
  saveState();
  return true;
}

function logout() {
  STATE.currentUser = null;
  saveState();
  renderApp();
}

function isGC() {
  return STATE.currentUser && STATE.currentUser.role === 'gc';
}

// ── Router / Pages ───────────────────────────────────────────

let currentPage = 'dashboard';
let currentParams = {};

function navigate(page, params = {}) {
  currentPage = page;
  currentParams = params;
  renderMain();
  // highlight nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

// ── Render Root ──────────────────────────────────────────────

function renderApp() {
  const root = document.getElementById('app');
  if (!STATE.currentUser) {
    root.innerHTML = renderLoginPage();
    attachLoginHandlers();
  } else {
    root.innerHTML = renderShell();
    attachShellHandlers();
    navigate(currentPage, currentParams);
  }
}

// ── Login Page ───────────────────────────────────────────────

function renderLoginPage() {
  return `
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <span class="logo-square"></span>
        <div>
          <div class="login-brand">DRAGONPASS</div>
          <div class="login-title">Legal & Compliance<br>Budget Manager</div>
        </div>
      </div>
      <form id="loginForm" autocomplete="off">
        <div class="field-group">
          <label>Email Address</label>
          <input type="email" id="loginEmail" placeholder="you@dragonpass.com" required />
        </div>
        <div class="field-group">
          <label>Password</label>
          <input type="password" id="loginPassword" placeholder="••••••••" required />
        </div>
        <div id="loginError" class="error-msg" style="display:none"></div>
        <button type="submit" class="btn btn-primary btn-full">Sign In</button>
      </form>
      <div class="login-footer">DragonPass Legal & Compliance · Confidential</div>
    </div>
  </div>`;
}

function attachLoginHandlers() {
  document.getElementById('loginForm').addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const pwd = document.getElementById('loginPassword').value;
    if (login(email, pwd)) {
      currentPage = 'dashboard';
      renderApp();
    } else {
      const err = document.getElementById('loginError');
      err.textContent = 'Invalid email or password. Please try again.';
      err.style.display = 'block';
    }
  });
}

// ── Shell (sidebar + header + main) ──────────────────────────

function renderShell() {
  const u = STATE.currentUser;
  const gcNav = isGC() ? `
    <div class="nav-item" data-page="budget-config"><span class="nav-icon">⚙️</span> Budget Configuration</div>
    <div class="nav-item" data-page="email-config"><span class="nav-icon">📧</span> Email Configuration</div>
    <div class="nav-item" data-page="users"><span class="nav-icon">👥</span> User Management</div>
    <div class="nav-item" data-page="notifications"><span class="nav-icon">🔔</span> Notifications <span class="badge">${STATE.notifications.filter(n=>!n.read).length || ''}</span></div>
  ` : `
    <div class="nav-item" data-page="notifications"><span class="nav-icon">🔔</span> My Notifications <span class="badge">${STATE.notifications.filter(n=>!n.read && n.to === u.email).length || ''}</span></div>
  `;
  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <span class="logo-square sm"></span>
        <div>
          <div class="brand-name">DRAGONPASS</div>
          <div class="brand-sub">Legal Budget Manager</div>
        </div>
      </div>
      <nav class="nav">
        <div class="nav-section">MAIN</div>
        <div class="nav-item" data-page="dashboard"><span class="nav-icon">📊</span> Dashboard</div>
        <div class="nav-item" data-page="my-matters"><span class="nav-icon">📂</span> My Matters</div>
        <div class="nav-section">BUDGET</div>
        <div class="nav-item" data-page="budget-requests"><span class="nav-icon">📋</span> Budget Requests</div>
        <div class="nav-item" data-page="expenses"><span class="nav-icon">🧾</span> Dept. Expenses</div>
        <div class="nav-section">VENDORS</div>
        <div class="nav-item" data-page="vendors"><span class="nav-icon">🏢</span> Vendor Registry</div>
        <div class="nav-section">ADMIN</div>
        ${gcNav}
      </nav>
      <div class="sidebar-user">
        <div class="user-avatar">${(u.name || u.email)[0].toUpperCase()}</div>
        <div class="user-info">
          <div class="user-name">${escapeHtml(u.name || u.email)}</div>
          <div class="user-role">${u.role === 'gc' ? 'General Counsel' : 'Legal Team'}</div>
        </div>
        <button class="logout-btn" id="logoutBtn" title="Sign out">⇥</button>
      </div>
    </aside>
    <div class="main-wrap">
      <header class="topbar">
        <div class="topbar-title" id="topbarTitle">Dashboard</div>
        <div class="topbar-right">
          <div class="currency-display">
            <label>Display Currency</label>
            <select id="displayCurrencySelector" class="currency-select">
              ${SUPPORTED_CURRENCIES.map(c => `<option value="${c.code}" ${(STATE.displayCurrency||'USD')===c.code?'selected':''}>${c.symbol} ${c.code}</option>`).join('')}
            </select>
            ${STATE.lastRateFetch ? `<span class="rate-updated">Rates: ${new Date(STATE.lastRateFetch).toLocaleDateString()}</span>` : '<span class="rate-updated warn">Rates not loaded</span>'}
          </div>
          <div class="topbar-actions" id="topbarActions"></div>
        </div>
      </header>
      <main class="main-content" id="mainContent"></main>
    </div>
  </div>`;
}

function attachShellHandlers() {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });
  document.getElementById('logoutBtn').addEventListener('click', logout);
  const currSel = document.getElementById('displayCurrencySelector');
  if (currSel) {
    currSel.addEventListener('change', e => setDisplayCurrency(e.target.value));
  }
}

// ── Main Render Dispatcher ────────────────────────────────────

function renderMain() {
  const titles = {
    dashboard: 'Dashboard',
    'my-matters': 'My Matters',
    'budget-requests': 'Budget Requests',
    expenses: 'Department Expenses',
    vendors: 'Vendor Registry',
    'budget-config': 'Budget Configuration',
    'email-config': 'Email Configuration',
    users: 'User Management',
    notifications: 'Notifications'
  };
  document.getElementById('topbarTitle').textContent = titles[currentPage] || '';
  const actions = document.getElementById('topbarActions');
  const content = document.getElementById('mainContent');

  switch (currentPage) {
    case 'dashboard':       renderDashboard(content, actions); break;
    case 'my-matters':      renderMyMatters(content, actions); break;
    case 'budget-requests': renderBudgetRequests(content, actions); break;
    case 'expenses':        renderExpenses(content, actions); break;
    case 'vendors':         renderVendors(content, actions); break;
    case 'budget-config':   renderBudgetConfig(content, actions); break;
    case 'email-config':     renderEmailConfig(content, actions); break;
    case 'users':           renderUsers(content, actions); break;
    case 'notifications':   renderNotifications(content, actions); break;
    default:                content.innerHTML = '<p>Page not found.</p>';
  }
}

// ═══════════════════════════════════════════════════════════════
// BUDGET CONFIGURATION (GC only)
// ═══════════════════════════════════════════════════════════════

function renderBudgetConfig(content, actions) {
  if (!isGC()) { content.innerHTML = '<p>Access denied.</p>'; return; }
  actions.innerHTML = `<button class="btn btn-primary" id="saveBudgetBtn">💾 Save Configuration</button>`;

  const cfg = STATE.budgetConfig || INITIAL_STATE.budgetConfig;
  const totalAllocated = Object.values(cfg.subcategoryAllocations).reduce((a, b) => a + b, 0);
  const diff = cfg.totalBudget - totalAllocated;

  // Calculate actual spending
  const allRequests = STATE.budgetRequests.filter(r => r.status === 'approved');
  const allExpenses = STATE.expenses.filter(e => e.status === 'approved');
  const totalSpending = [...allRequests, ...allExpenses].reduce((s, x) => s + (parseFloat(x.amount)||0), 0);
  const budgetPct = cfg.totalBudget ? Math.round((totalSpending / cfg.totalBudget) * 100) : 0;
  const remainingBudget = Math.max(0, cfg.totalBudget - totalSpending);

  content.innerHTML = `
  <div class="budget-config-grid">
    <div class="dash-card full">
      <div class="dash-card-title">Total Department Budget</div>
      <div class="total-budget-row">
        <div class="field-group" style="max-width:300px">
          <label>Total Budget (USD)</label>
          <input type="number" id="cfgTotalBudget" value="${cfg.totalBudget}" min="0" step="100" class="big-input" />
        </div>
        <div class="total-budget-stats">
          <div class="tbs-item">
            <span class="tbs-val">${formatCurrency(cfg.totalBudget)}</span>
            <span class="tbs-label">Total Budget</span>
          </div>
          <div class="tbs-item">
            <span class="tbs-val" style="color:var(--navy-500)">${formatCurrency(totalAllocated)}</span>
            <span class="tbs-label">Allocated to Subcats</span>
          </div>
          <div class="tbs-item">
            <span class="tbs-val ${diff < 0 ? 'over' : 'under'}">${diff < 0 ? '-' : ''}${formatCurrency(Math.abs(diff))}</span>
            <span class="tbs-label">${diff >= 0 ? 'Unallocated' : 'Over-allocated'}</span>
          </div>
        </div>
      </div>

      <div style="margin-top:20px; padding-top:16px; border-top:1px solid var(--border);">
        <div class="dash-card-title" style="margin-bottom:12px;">Budget Utilization Overview</div>
        <div class="budget-util-bar">
          <div class="budget-util-track">
            <div class="budget-util-fill ${budgetPct > 90 ? 'danger' : budgetPct > 70 ? 'warn' : 'good'}" style="width:${Math.min(budgetPct, 100)}%">
              <span class="budget-util-label">${budgetPct}% used — ${formatCurrency(totalSpending)} of ${formatCurrency(cfg.totalBudget)}</span>
            </div>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:10px; font-size:13px;">
          <span><strong>Spent:</strong> ${formatCurrency(totalSpending)}</span>
          <span><strong>Remaining:</strong> ${formatCurrency(remainingBudget)}</span>
          <span>${allRequests.length + allExpenses.length} approved items</span>
        </div>
      </div>
    </div>

    <div class="dash-card full">
      <div class="dash-card-title">Backoffice Subcategory Allocations & Spending</div>
      <div class="subcat-table-wrap">
        <table class="data-table" id="subcatTable">
          <thead><tr>
            <th>Subcategory</th>
            <th>Allocation (USD)</th>
            <th>% of Total</th>
            <th>Approved Spending</th>
            <th>Utilization</th>
            <th>Status</th>
          </tr></thead>
          <tbody>
            ${BACKOFFICE_SUBCATEGORIES.map(cat => {
              const alloc = cfg.subcategoryAllocations[cat.id] || 0;
              const pct = cfg.totalBudget ? ((alloc / cfg.totalBudget) * 100).toFixed(1) : '0.0';
              // For now, spending is aggregated across all subcategories (future: assign requests to subcats)
              const catSpending = 0; // TODO: add subcategory field to requests/expenses
              const utilPct = alloc ? ((catSpending / alloc) * 100).toFixed(0) : '0';
              const statusClass = alloc > 0 && catSpending === 0 ? 'status-pending' : (catSpending > alloc ? 'status-rejected' : 'status-approved');
              const statusText = alloc > 0 && catSpending === 0 ? 'No spend yet' : (catSpending > alloc ? 'Over' : 'On track');
              return `<tr>
                <td><strong>${escapeHtml(cat.name)}</strong></td>
                <td><input type="number" class="subcat-alloc-input" data-cat="${cat.id}" value="${alloc}" min="0" step="100" /></td>
                <td><span class="subcat-pct" data-cat="${cat.id}">${pct}%</span></td>
                <td><span class="subcat-spending" data-cat="${cat.id}">${formatCurrency(catSpending)}</span></td>
                <td>
                  <div class="subcat-bar-wrap" style="min-width:80px;">
                    <div class="subcat-bar-track">
                      <div class="subcat-bar-fill util-fill ${Number(utilPct)>80?'danger':Number(utilPct)>50?'warn':'good'}" data-cat="${cat.id}" style="width:${Math.min(Number(utilPct),100)}%"></div>
                    </div>
                    <span style="font-size:11px;color:var(--text-muted);margin-left:6px;">${utilPct}%</span>
                  </div>
                </td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td><strong>Total</strong></td>
              <td><strong id="subcatTotal">${formatCurrency(totalAllocated)}</strong></td>
              <td><strong id="subcatTotalPct">${cfg.totalBudget ? ((totalAllocated / cfg.totalBudget) * 100).toFixed(1) : '0.0'}%</strong></td>
              <td><strong>${formatCurrency(totalSpending)}</strong></td>
              <td><strong>${budgetPct}%</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <div class="dash-card full">
      <div class="dash-card-title">Budget Allocation Overview (Visual)</div>
      <div class="allocation-chart" id="allocationChart"></div>
    </div>

    <div class="dash-card full">
      <div class="dash-card-title">Fiscal Notes</div>
      <div class="field-group">
        <label>Notes / Remarks</label>
        <textarea id="cfgNotes" rows="3" placeholder="Any notes about the budget allocation...">${escapeHtml(cfg.notes || '')}</textarea>
      </div>
      <div class="form-row" style="margin-top:8px">
        <div class="field-group">
          <label>Fiscal Year</label>
          <input type="text" id="cfgFiscalYear" value="${escapeHtml(cfg.fiscalYear || 'FY 2025-2026')}" placeholder="e.g. FY 2025-2026" />
        </div>
        <div class="field-group">
          <label>Last Updated</label>
          <input type="text" value="${cfg.lastUpdated ? formatDate(cfg.lastUpdated) : '—'}" readonly style="background:var(--bg);color:var(--text-muted)" />
        </div>
      </div>
    </div>
  </div>`;

  // Render allocation visualization
  renderAllocationChart();

  // Live update on input changes
  function updateTotals() {
    const totalBudget = parseFloat(document.getElementById('cfgTotalBudget').value) || 0;
    let subTotal = 0;
    document.querySelectorAll('.subcat-alloc-input').forEach(input => {
      subTotal += parseFloat(input.value) || 0;
    });
    const diff = totalBudget - subTotal;
    document.getElementById('cfgTotalDisplay').textContent = formatCurrency(totalBudget);
    document.getElementById('cfgAllocatedDisplay').textContent = formatCurrency(subTotal);
    const diffEl = document.getElementById('cfgDiffDisplay');
    diffEl.textContent = (diff < 0 ? '-' : '') + formatCurrency(Math.abs(diff));
    diffEl.className = 'tbs-val ' + (diff < 0 ? 'over' : 'under');
    document.getElementById('subcatTotal').textContent = formatCurrency(subTotal);
    document.getElementById('subcatTotalPct').textContent = totalBudget ? ((subTotal / totalBudget) * 100).toFixed(1) + '%' : '0.0%';
    // Update percentages and bars
    document.querySelectorAll('.subcat-alloc-input').forEach(input => {
      const cat = input.dataset.cat;
      const val = parseFloat(input.value) || 0;
      const pct = totalBudget ? ((val / totalBudget) * 100).toFixed(1) : '0.0';
      const pctEl = document.querySelector(`.subcat-pct[data-cat="${cat}"]`);
      const barEl = document.querySelector(`.subcat-bar-fill[data-cat="${cat}"]`);
      if (pctEl) pctEl.textContent = pct + '%';
      if (barEl) barEl.style.width = pct + '%';
    });
    renderAllocationChart();
  }

  document.getElementById('cfgTotalBudget').addEventListener('input', updateTotals);
  document.querySelectorAll('.subcat-alloc-input').forEach(input => {
    input.addEventListener('input', updateTotals);
  });

  document.getElementById('saveBudgetBtn').addEventListener('click', () => {
    const totalBudget = parseFloat(document.getElementById('cfgTotalBudget').value) || 0;
    const allocations = {};
    document.querySelectorAll('.subcat-alloc-input').forEach(input => {
      allocations[input.dataset.cat] = parseFloat(input.value) || 0;
    });
    const notes = document.getElementById('cfgNotes')?.value?.trim() || '';
    const fiscalYear = document.getElementById('cfgFiscalYear')?.value?.trim() || 'FY 2025-2026';
    STATE.budgetConfig = { totalBudget, subcategoryAllocations: allocations, notes, fiscalYear, lastUpdated: new Date().toISOString() };
    saveState();
    showToast('Budget configuration saved successfully.');
  });

  function renderAllocationChart() {
    const chart = document.getElementById('allocationChart');
    if (!chart) return;
    const totalBudget = parseFloat(document.getElementById('cfgTotalBudget').value) || 1223200;
    const subTotal = Array.from(document.querySelectorAll('.subcat-alloc-input')).reduce((s, inp) => s + (parseFloat(inp.value) || 0), 0);
    const unallocated = Math.max(0, totalBudget - subTotal);

    const colors = ['#1d3a64', '#264f82', '#3a6bb0', '#5b8dd4', '#8db5ed', '#c5d9f6', '#d4aa3c', '#e2bd52', '#f0d478'];
    let segments = BACKOFFICE_SUBCATEGORIES.map((cat, i) => {
      const val = parseFloat(document.querySelector(`.subcat-alloc-input[data-cat="${cat.id}"]`)?.value) || 0;
      return { name: cat.name, value: val, color: colors[i], catId: cat.id };
    });
    if (unallocated > 0.01) {
      segments.push({ name: 'Unallocated', value: unallocated, color: '#e5e7eb', catId: 'unallocated' });
    }

    const maxVal = Math.max(totalBudget, subTotal);
    const barHeight = 36;
    const totalH = segments.length * (barHeight + 8) + 20;

    chart.innerHTML = `
    <svg viewBox="0 0 620 ${totalH}" style="width:100%; height:auto; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
      ${segments.map((seg, i) => {
        const y = 10 + i * (barHeight + 8);
        const w = maxVal ? Math.max((seg.value / maxVal) * 400, 2) : 2;
        return `
        <text x="0" y="${y + 20}" font-size="12" fill="#374151" font-weight="500">${escapeHtml(seg.name)}</text>
        <rect x="200" y="${y + 6}" width="${w}" height="${barHeight - 12}" rx="4" fill="${seg.color}" />
        <text x="${205 + w}" y="${y + 20}" font-size="12" fill="#6b7280">${formatCurrency(seg.value)} (${maxVal ? ((seg.value / maxVal) * 100).toFixed(1) : 0}%)</text>`;
      }).join('')}
    </svg>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function renderDashboard(content, actions) {
  actions.innerHTML = '';

  const requests = STATE.budgetRequests;
  const expenses = STATE.expenses;
  const vendors = STATE.vendors;
  const cfg = STATE.budgetConfig || { totalBudget: 1223200, subcategoryAllocations: {} };

  const totalVendorBudget = requests.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const totalSpent = totalVendorBudget + totalExpenses;
  const pendingApprovals = [...requests, ...expenses, ...vendors.filter(v=>v.status==='pending')].filter(x => x.status === 'pending').length;
  const approvedRequests = requests.filter(r => r.status === 'approved').length;
  const rejectedRequests = requests.filter(r => r.status === 'rejected').length;

  // Budget utilization
  const budgetUsed = totalSpent;
  const budgetPct = cfg.totalBudget ? Math.round((budgetUsed / cfg.totalBudget) * 100) : 0;
  const budgetRemaining = Math.max(0, cfg.totalBudget - budgetUsed);

  // Budget by category (expenses)
  const expByCategory = {};
  expenses.forEach(e => {
    expByCategory[e.category] = (expByCategory[e.category] || 0) + (parseFloat(e.amount) || 0);
  });

  // Budget by vendor
  const byVendor = {};
  requests.forEach(r => {
    if (r.vendorId) {
      const v = STATE.vendors.find(x => x.id === r.vendorId);
      const name = v ? v.name : 'Unknown';
      byVendor[name] = (byVendor[name] || 0) + (parseFloat(r.amount) || 0);
    }
  });

  // Actual vs allocated
  const actualVendor = requests.filter(r => r.feeType === 'actual').reduce((s,r) => s + (parseFloat(r.amount)||0), 0);
  const allocatedVendor = requests.filter(r => r.feeType === 'allocation').reduce((s,r) => s + (parseFloat(r.amount)||0), 0);

  content.innerHTML = `
  <div class="dashboard-grid">
    <div class="stat-card accent-blue">
      <div class="stat-label">Budget Utilization</div>
      <div class="stat-value">${budgetPct}%</div>
      <div class="stat-sub">${formatCurrency(budgetUsed)} of ${formatCurrency(cfg.totalBudget)}</div>
    </div>
    <div class="stat-card accent-gold">
      <div class="stat-label">Budget Remaining</div>
      <div class="stat-value">${formatCurrency(budgetRemaining)}</div>
      <div class="stat-sub">${cfg.totalBudget ? ((budgetRemaining / cfg.totalBudget) * 100).toFixed(1) : 0}% of total</div>
    </div>
    <div class="stat-card accent-orange">
      <div class="stat-label">Pending Approvals</div>
      <div class="stat-value">${pendingApprovals}</div>
      <div class="stat-sub">Awaiting your review</div>
    </div>
    <div class="stat-card accent-green">
      <div class="stat-label">Approved / Rejected</div>
      <div class="stat-value">${approvedRequests} / ${rejectedRequests}</div>
      <div class="stat-sub">${requests.length} total requests</div>
    </div>
  </div>

  <div class="dashboard-row">
    <div class="dash-card full">
      <div class="dash-card-title">Budget Utilization Bar</div>
      <div class="budget-util-bar">
        <div class="budget-util-track">
          <div class="budget-util-fill ${budgetPct > 90 ? 'danger' : budgetPct > 70 ? 'warn' : 'good'}" style="width:${Math.min(budgetPct, 100)}%">
            <span class="budget-util-label">${budgetPct}%</span>
          </div>
        </div>
        <div class="budget-util-marks">
          <span>${formatCurrency(0)}</span>
          <span>${formatCurrency(cfg.totalBudget * 0.25)}</span>
          <span>${formatCurrency(cfg.totalBudget * 0.5)}</span>
          <span>${formatCurrency(cfg.totalBudget * 0.75)}</span>
          <span>${formatCurrency(cfg.totalBudget)}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="dashboard-row">
    <div class="dash-card half">
      <div class="dash-card-title">Actual vs Allocated (Vendor)</div>
      <div class="bar-compare">
        <div class="bar-row">
          <span class="bar-label">Actual Costs</span>
          <div class="bar-track"><div class="bar-fill blue" style="width:${totalVendorBudget ? Math.round(actualVendor/totalVendorBudget*100) : 0}%"></div></div>
          <span class="bar-val">${formatCurrency(actualVendor)}</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">Allocations</span>
          <div class="bar-track"><div class="bar-fill gold" style="width:${totalVendorBudget ? Math.round(allocatedVendor/totalVendorBudget*100) : 0}%"></div></div>
          <span class="bar-val">${formatCurrency(allocatedVendor)}</span>
        </div>
      </div>
    </div>
    <div class="dash-card half">
      <div class="dash-card-title">Expense by Category</div>
      ${Object.keys(expByCategory).length === 0 ? '<div class="empty-note">No expenses recorded yet.</div>' :
        Object.entries(expByCategory).sort((a,b)=>b[1]-a[1]).map(([cat, amt]) => `
        <div class="bar-row">
          <span class="bar-label">${escapeHtml(cat)}</span>
          <div class="bar-track"><div class="bar-fill navy" style="width:${Math.round(amt/totalExpenses*100)}%"></div></div>
          <span class="bar-val">${formatCurrency(amt)}</span>
        </div>`).join('')}
    </div>
  </div>

  <div class="dashboard-row">
    <div class="dash-card full">
      <div class="dash-card-title">Recent Budget Requests</div>
      ${renderMiniTable(requests.slice(-5).reverse())}
    </div>
  </div>

  <div class="dashboard-row">
    <div class="dash-card half">
      <div class="dash-card-title">Vendor Registry Summary</div>
      <div class="vendor-summary">
        <div class="vs-item"><span>${vendors.length}</span><label>Total Vendors</label></div>
        <div class="vs-item"><span>${vendors.filter(v=>v.status==='approved').length}</span><label>Approved</label></div>
        <div class="vs-item"><span>${vendors.filter(v=>v.status==='pending').length}</span><label>Pending</label></div>
      </div>
    </div>
    <div class="dash-card half">
      <div class="dash-card-title">Top Vendors by Budget</div>
      ${Object.keys(byVendor).length === 0 ? '<div class="empty-note">No vendor budgets yet.</div>' :
        Object.entries(byVendor).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name, amt]) => `
        <div class="bar-row">
          <span class="bar-label">${escapeHtml(name)}</span>
          <div class="bar-track"><div class="bar-fill blue" style="width:${Math.round(amt/totalVendorBudget*100)}%"></div></div>
          <span class="bar-val">${formatCurrency(amt)}</span>
        </div>`).join('')}
    </div>
  </div>`;
}

function renderMiniTable(requests) {
  if (!requests.length) return '<div class="empty-note">No requests yet.</div>';
  return `<table class="mini-table">
    <thead><tr><th>Owner</th><th>Vendor</th><th>Description</th><th>Amount</th><th>Status</th><th>Payment Date</th></tr></thead>
    <tbody>${requests.map(r => {
      const v = STATE.vendors.find(x => x.id === r.vendorId);
      const owner = STATE.users.find(u => u.email === (r.owner || r.submittedBy));
      return `<tr>
        <td>${escapeHtml(owner ? owner.name : (r.owner || r.submittedBy))}</td>
        <td>${escapeHtml(v ? v.name : '—')}</td>
        <td class="desc-cell">${escapeHtml(r.description || '—')}</td>
        <td>${formatCurrency(r.amount)}</td>
        <td><span class="status-badge status-${r.status}">${r.status}</span></td>
        <td>${formatDate(r.paymentDate)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ═══════════════════════════════════════════════════════════════
// MY MATTERS (Personal dashboard for each team member)
// ═══════════════════════════════════════════════════════════════

function renderMyMatters(content, actions) {
  actions.innerHTML = '';
  const userEmail = STATE.currentUser.email;

  // Collect all matters related to this user
  const myRequests = STATE.budgetRequests.filter(r => r.submittedBy === userEmail || r.owner === userEmail);
  const myExpenses = STATE.expenses.filter(e => e.submittedBy === userEmail || e.owner === userEmail);
  const myVendors = STATE.vendors.filter(v => v.addedBy === userEmail);

  // Summary stats
  const pendingCount = [...myRequests, ...myExpenses].filter(x => x.status === 'pending').length;
  const approvedCount = [...myRequests, ...myExpenses].filter(x => x.status === 'approved').length;
  const rejectedCount = [...myRequests, ...myExpenses].filter(x => x.status === 'rejected').length;
  const totalAmount = [...myRequests, ...myExpenses].reduce((s, x) => s + (parseFloat(x.amount)||0), 0);

  content.innerHTML = `
  <div class="matters-summary-grid">
    <div class="stat-card accent-blue">
      <div class="stat-label">Total Matters</div>
      <div class="stat-value">${myRequests.length + myExpenses.length + myVendors.length}</div>
      <div class="stat-sub">All your items</div>
    </div>
    <div class="stat-card accent-orange">
      <div class="stat-label">Pending Action</div>
      <div class="stat-value">${pendingCount + myVendors.filter(v=>v.status==='pending').length}</div>
      <div class="stat-sub">Awaiting review</div>
    </div>
    <div class="stat-card accent-green">
      <div class="stat-label">Approved</div>
      <div class="stat-value">${approvedCount}</div>
      <div class="stat-sub">${rejectedCount} rejected</div>
    </div>
    <div class="stat-card accent-gold">
      <div class="stat-label">Total Amount</div>
      <div class="stat-value">${formatCurrency(totalAmount)}</div>
      <div class="stat-sub">${myRequests.length} req · ${myExpenses.length} exp</div>
    </div>
  </div>

  <div class="filter-bar" style="margin-top:20px">
    <select id="mattersTypeFilter" class="filter-select">
      <option value="">All Types</option>
      <option value="requests">Budget Requests (${myRequests.length})</option>
      <option value="expenses">Dept. Expenses (${myExpenses.length})</option>
      <option value="vendors">Vendor Registrations (${myVendors.length})</option>
    </select>
    <select id="mattersStatusFilter" class="filter-select">
      <option value="">All Statuses</option>
      <option value="pending">Pending</option>
      <option value="approved">Approved</option>
      <option value="rejected">Rejected</option>
    </select>
    <input type="text" id="mattersSearch" placeholder="Search..." class="search-input" style="max-width:220px;" />
  </div>

  <div id="mattersContent"></div>`;

  function renderMatters() {
    const typeFilter = document.getElementById('mattersTypeFilter')?.value || '';
    const statusFilter = document.getElementById('mattersStatusFilter')?.value || '';
    const searchQ = document.getElementById('mattersSearch')?.value?.toLowerCase() || '';

    let items = [];

    if (!typeFilter || typeFilter === 'requests') {
      myRequests.forEach(r => {
        if (statusFilter && r.status !== statusFilter) return;
        if (searchQ) {
          const v = STATE.vendors.find(x => x.id === r.vendorId);
          if (!(v && v.name.toLowerCase().includes(searchQ)) && !(r.description||'').toLowerCase().includes(searchQ)) return;
        }
        items.push({ type: 'request', data: r });
      });
    }
    if (!typeFilter || typeFilter === 'expenses') {
      myExpenses.forEach(e => {
        if (statusFilter && e.status !== statusFilter) return;
        if (searchQ && !(e.description||'').toLowerCase().includes(searchQ) && !e.category.toLowerCase().includes(searchQ)) return;
        items.push({ type: 'expense', data: e });
      });
    }
    if (!typeFilter || typeFilter === 'vendors') {
      myVendors.forEach(v => {
        if (statusFilter && v.status !== statusFilter) return;
        if (searchQ && !v.name.toLowerCase().includes(searchQ)) return;
        items.push({ type: 'vendor', data: v });
      });
    }

    // Sort by date descending
    items.sort((a, b) => new Date(b.data.submittedAt || b.data.addedAt) - new Date(a.data.submittedAt || a.data.addedAt));

    const container = document.getElementById('mattersContent');
    if (!items.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>No matters found matching your filters.</p></div>';
      return;
    }

    container.innerHTML = `<table class="data-table">
      <thead><tr>
        <th>Type</th><th>Description</th><th>Amount</th><th>Status</th><th>Date</th><th>Actions</th>
      </tr></thead>
      <tbody>${items.map(item => {
        if (item.type === 'request') {
          const r = item.data;
          const v = STATE.vendors.find(x => x.id === r.vendorId);
          return `<tr>
            <td><span class="tag tag-cat">Request</span></td>
            <td>${escapeHtml(v ? v.name + ': ' : '')}${escapeHtml(r.description||'—')}</td>
            <td><strong>${formatCurrency(r.amount)}</strong></td>
            <td><span class="status-badge status-${r.status}">${r.status}</span></td>
            <td>${formatDate(r.submittedAt)}</td>
            <td class="actions-cell"><button class="btn-link" onclick="navigate('budget-requests');setTimeout(()=>openRequestForm('${r.id}'),100)">View</button></td>
          </tr>`;
        } else if (item.type === 'expense') {
          const e = item.data;
          return `<tr>
            <td><span class="tag tag-allocation">Expense</span></td>
            <td>[${escapeHtml(e.category)}] ${escapeHtml(e.description||'—')}</td>
            <td><strong>${formatCurrency(e.amount)}</strong></td>
            <td><span class="status-badge status-${e.status}">${e.status}</span></td>
            <td>${formatDate(e.submittedAt)}</td>
            <td class="actions-cell"><button class="btn-link" onclick="navigate('expenses');setTimeout(()=>openExpenseForm('${e.id}'),100)">View</button></td>
          </tr>`;
        } else {
          const v = item.data;
          return `<tr>
            <td><span class="tag tag-role-member">Vendor</span></td>
            <td><strong>${escapeHtml(v.name)}</strong> ${(v.contacts||[]).map(c=>c.name).join(', ')}</td>
            <td>—</td>
            <td><span class="status-badge status-${v.status}">${v.status}</span></td>
            <td>${formatDate(v.addedAt)}</td>
            <td class="actions-cell"><button class="btn-link" onclick="navigate('vendors');setTimeout(()=>openVendorForm('${v.id}'),100)">View</button></td>
          </tr>`;
        }
      }).join('')}</tbody>
    </table>`;
  }

  document.getElementById('mattersTypeFilter')?.addEventListener('change', renderMatters);
  document.getElementById('mattersStatusFilter')?.addEventListener('change', renderMatters);
  document.getElementById('mattersSearch')?.addEventListener('input', renderMatters);
  renderMatters();
}

// ═══════════════════════════════════════════════════════════════
// BUDGET REQUESTS
// ═══════════════════════════════════════════════════════════════

function renderBudgetRequests(content, actions) {
  const canAdd = true;
  actions.innerHTML = `<button class="btn btn-primary" id="newRequestBtn">+ New Request</button>`;

  const requests = isGC()
    ? STATE.budgetRequests
    : STATE.budgetRequests.filter(r => r.submittedBy === STATE.currentUser.email);

  content.innerHTML = `
  <div class="filter-bar">
    <input type="text" id="reqSearch" placeholder="Search requests..." class="search-input" />
    <select id="reqStatusFilter" class="filter-select">
      <option value="">All Statuses</option>
      <option value="pending">Pending</option>
      <option value="approved">Approved</option>
      <option value="rejected">Rejected</option>
    </select>
  </div>
  <div id="requestsList"></div>
  <div id="requestModal" class="modal-overlay" style="display:none"></div>`;

  document.getElementById('newRequestBtn').addEventListener('click', () => openRequestForm());
  document.getElementById('reqSearch').addEventListener('input', refreshRequestList);
  document.getElementById('reqStatusFilter').addEventListener('change', refreshRequestList);

  function refreshRequestList() {
    const q = document.getElementById('reqSearch').value.toLowerCase();
    const st = document.getElementById('reqStatusFilter').value;
    let list = isGC() ? STATE.budgetRequests : STATE.budgetRequests.filter(r => r.submittedBy === STATE.currentUser.email);
    if (q) list = list.filter(r => {
      const v = STATE.vendors.find(x => x.id === r.vendorId);
      return (v && v.name.toLowerCase().includes(q)) || (r.description || '').toLowerCase().includes(q);
    });
    if (st) list = list.filter(r => r.status === st);
    renderRequestList(list);
  }
  refreshRequestList();
}

function renderRequestList(requests) {
  const el = document.getElementById('requestsList');
  if (!requests.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No budget requests found.</p></div>';
    return;
  }
  el.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Owner</th><th>Vendor</th><th>Description</th><th>Amount</th><th>Fee Type</th>
      <th>Payment Date</th><th>Behalf Of</th><th>Status</th><th>Submitted By</th><th>Actions</th>
    </tr></thead>
    <tbody>${requests.map(r => {
      const v = STATE.vendors.find(x => x.id === r.vendorId);
      const owner = STATE.users.find(u => u.email === (r.owner || r.submittedBy));
      return `<tr>
        <td><strong>${escapeHtml(owner ? owner.name : (r.owner || r.submittedBy))}</strong></td>
        <td><strong>${escapeHtml(v ? v.name : '—')}</strong></td>
        <td class="desc-cell">${escapeHtml(r.description || '—')}</td>
        <td><strong>${formatCurrency(r.amount)}</strong></td>
        <td><span class="tag tag-${r.feeType}">${r.feeType === 'actual' ? 'Actual' : 'Allocation'}</span></td>
        <td>${formatDate(r.paymentDate)}</td>
        <td>${r.onBehalf ? `<span class="tag tag-behalf">3rd Party</span>` : '—'}</td>
        <td><span class="status-badge status-${r.status}">${r.status}</span></td>
        <td>${escapeHtml(r.submittedBy)}</td>
        <td class="actions-cell">
          <button class="btn-link" onclick="viewRequest('${r.id}')">View</button>
          ${isGC() && r.status === 'pending' ? `
            <button class="btn-link approve" onclick="approveRequest('${r.id}')">✓ Approve</button>
            <button class="btn-link reject" onclick="rejectRequest('${r.id}')">✗ Reject</button>
          ` : ''}
          ${(isGC() || r.submittedBy === STATE.currentUser.email) && r.status === 'pending' ? `
            <button class="btn-link edit" onclick="openRequestForm('${r.id}')">Edit</button>
          ` : ''}
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function openRequestForm(id) {
  const req = id ? STATE.budgetRequests.find(r => r.id === id) : null;
  const approvedVendors = STATE.vendors.filter(v => v.status === 'approved');

  const modal = document.getElementById('requestModal');
  modal.style.display = 'flex';
  modal.innerHTML = `
  <div class="modal-box">
    <div class="modal-header">
      <h2>${req ? 'Edit Budget Request' : 'New Budget Request'}</h2>
      <button class="modal-close" onclick="closeModal('requestModal')">✕</button>
    </div>
    <form id="requestForm" class="modal-form">
      <div class="form-row">
        <div class="field-group">
          <label>Vendor *</label>
          <select id="rVendorId" required>
            <option value="">— Select Vendor —</option>
            ${approvedVendors.map(v => `<option value="${v.id}" ${req && req.vendorId === v.id ? 'selected':''}>${escapeHtml(v.name)}</option>`).join('')}
          </select>
          <div style="margin-top:6px"><button type="button" class="btn-link" onclick="closeModal('requestModal');navigate('vendors')">+ Add New Vendor</button></div>
        </div>
        <div class="field-group">
          <label>Amount *</label>
          <div class="amount-input-row">
            <select id="rCurrency" class="currency-input-select">
              ${SUPPORTED_CURRENCIES.map(c => `<option value="${c.code}" ${(req && req.currency===c.code) || (!req && c.code==='USD') ? 'selected' : ''}>${c.symbol} ${c.code}</option>`).join('')}
            </select>
            <input type="number" id="rAmount" min="0" step="0.01" value="${req ? req.amount : ''}" required />
          </div>
        </div>
      </div>
      <div class="field-group">
        <label>Description of Work *</label>
        <textarea id="rDescription" rows="3" required>${req ? escapeHtml(req.description) : ''}</textarea>
      </div>
      <div class="field-group">
        <label>Owner</label>
        <select id="rOwner">
          ${STATE.users.filter(u => u.active).map(u => `<option value="${u.email}" ${(req && req.owner === u.email) || (!req && u.email === STATE.currentUser.email) ? 'selected' : ''}>${escapeHtml(u.name || u.email)}</option>`).join('')}
        </select>
        <div class="field-hint">Default owner is you. Change to assign this matter to another team member.</div>
      </div>
      <div class="form-row">
        <div class="field-group">
          <label>Fee Type *</label>
          <select id="rFeeType" required>
            <option value="actual" ${req && req.feeType==='actual' ? 'selected':''}>Actual (fee has occurred)</option>
            <option value="allocation" ${req && req.feeType==='allocation' ? 'selected':''}>Allocation (budget before work)</option>
          </select>
        </div>
        <div class="field-group">
          <label>Estimated Payment Date *</label>
          <input type="date" id="rPaymentDate" value="${req ? req.paymentDate : ''}" required />
        </div>
      </div>
      <div class="field-group">
        <label>Budget Source *</label>
        <select id="rBudgetSource" required>
          <option value="legal" ${!req || req.budgetSource==='legal' ? 'selected':''}>Legal Department Budget</option>
          <option value="behalf" ${req && req.budgetSource==='behalf' ? 'selected':''}>Paid on Behalf of Another Party</option>
        </select>
      </div>
      <div id="behalfSection" style="${req && req.budgetSource==='behalf' ? '' : 'display:none'}">
        <div class="field-group">
          <label>Third-Party Name</label>
          <input type="text" id="rBehalfName" value="${req && req.behalfName ? escapeHtml(req.behalfName) : ''}" />
        </div>
        <div class="field-group">
          <label>Third-Party Details</label>
          <textarea id="rBehalfDetails" rows="2">${req && req.behalfDetails ? escapeHtml(req.behalfDetails) : ''}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="closeModal('requestModal')">Cancel</button>
        <button type="submit" class="btn btn-primary">Submit Request</button>
      </div>
    </form>
  </div>`;

  document.getElementById('rBudgetSource').addEventListener('change', e => {
    document.getElementById('behalfSection').style.display = e.target.value === 'behalf' ? '' : 'none';
  });

  document.getElementById('requestForm').addEventListener('submit', e => {
    e.preventDefault();
    const vendorId = document.getElementById('rVendorId').value;
    const inputCurrency = document.getElementById('rCurrency').value;
    const rawAmount = parseFloat(document.getElementById('rAmount').value) || 0;
    const amount = toUSD(rawAmount, inputCurrency);
    const description = document.getElementById('rDescription').value.trim();
    const feeType = document.getElementById('rFeeType').value;
    const paymentDate = document.getElementById('rPaymentDate').value;
    const budgetSource = document.getElementById('rBudgetSource').value;
    const owner = document.getElementById('rOwner')?.value || STATE.currentUser.email;
    const onBehalf = budgetSource === 'behalf';
    const behalfName = onBehalf ? document.getElementById('rBehalfName').value.trim() : '';
    const behalfDetails = onBehalf ? document.getElementById('rBehalfDetails').value.trim() : '';

    if (req) {
      Object.assign(req, { vendorId, amount, currency: inputCurrency, description, feeType, paymentDate, budgetSource, onBehalf, behalfName, behalfDetails, owner, updatedAt: new Date().toISOString() });
    } else {
      const newReq = {
        id: genId(), vendorId, amount, currency: inputCurrency, description, feeType, paymentDate, budgetSource, onBehalf,
        behalfName, behalfDetails, status: 'pending', submittedBy: STATE.currentUser.email,
        submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      if (owner && owner !== STATE.currentUser.email) newReq.owner = owner;
      STATE.budgetRequests.push(newReq);
      // Notify GC
      const gc = STATE.users.find(u => u.role === 'gc');
      if (gc) {
        const v = STATE.vendors.find(x => x.id === vendorId);
        sendEmail(gc.email, 'New Budget Request Submitted',
          `A new budget request has been submitted by ${STATE.currentUser.name || STATE.currentUser.email}.\n\nVendor: ${v ? v.name : 'N/A'}\nAmount: ${formatCurrency(amount)}\nDescription: ${description}`);
      }
    }
    saveState();
    closeModal('requestModal');
    renderBudgetRequests(document.getElementById('mainContent'), document.getElementById('topbarActions'));
  });
}

function viewRequest(id) {
  const req = STATE.budgetRequests.find(r => r.id === id);
  if (!req) return;
  const v = STATE.vendors.find(x => x.id === req.vendorId);
  const modal = document.getElementById('requestModal');
  modal.style.display = 'flex';
  modal.innerHTML = `
  <div class="modal-box">
    <div class="modal-header">
      <h2>Budget Request Details</h2>
      <button class="modal-close" onclick="closeModal('requestModal')">✕</button>
    </div>
    <div class="detail-grid">
      <div class="detail-row"><label>Owner</label><span>${escapeHtml(req.owner ? (STATE.users.find(u=>u.email===req.owner)?.name || req.owner) : (STATE.currentUser.name || req.submittedBy))}</span></div>
      <div class="detail-row"><label>Vendor</label><span>${escapeHtml(v ? v.name : '—')}</span></div>
      <div class="detail-row"><label>Amount</label><span><strong>${formatCurrency(req.amount)}</strong></span></div>
      <div class="detail-row full"><label>Description</label><span>${escapeHtml(req.description)}</span></div>
      <div class="detail-row"><label>Fee Type</label><span>${req.feeType === 'actual' ? 'Actual Cost' : 'Budget Allocation'}</span></div>
      <div class="detail-row"><label>Payment Date</label><span>${formatDate(req.paymentDate)}</span></div>
      <div class="detail-row"><label>Budget Source</label><span>${req.budgetSource === 'behalf' ? 'On Behalf of Third Party' : 'Legal Department'}</span></div>
      ${req.onBehalf ? `
        <div class="detail-row"><label>Third-Party Name</label><span>${escapeHtml(req.behalfName)}</span></div>
        <div class="detail-row full"><label>Third-Party Details</label><span>${escapeHtml(req.behalfDetails)}</span></div>
      ` : ''}
      <div class="detail-row"><label>Status</label><span class="status-badge status-${req.status}">${req.status}</span></div>
      <div class="detail-row"><label>Submitted By</label><span>${escapeHtml(req.submittedBy)}</span></div>
      <div class="detail-row"><label>Submitted At</label><span>${formatDate(req.submittedAt)}</span></div>
    </div>
    <div class="modal-footer">
      ${isGC() && req.status === 'pending' ? `
        <button class="btn btn-danger" onclick="rejectRequest('${req.id}');closeModal('requestModal')">✗ Reject</button>
        <button class="btn btn-success" onclick="approveRequest('${req.id}');closeModal('requestModal')">✓ Approve</button>
      ` : ''}
      <button class="btn btn-secondary" onclick="closeModal('requestModal')">Close</button>
    </div>
  </div>`;
}

function approveRequest(id) {
  const req = STATE.budgetRequests.find(r => r.id === id);
  if (!req) return;
  req.status = 'approved';
  req.reviewedBy = STATE.currentUser.email;
  req.reviewedAt = new Date().toISOString();
  saveState();
  sendEmail(req.submittedBy, 'Budget Request Approved',
    `Your budget request has been approved by the General Counsel.\n\nDescription: ${req.description}\nAmount: ${formatCurrency(req.amount)}`);
  showToast('Request approved successfully.');
  renderBudgetRequests(document.getElementById('mainContent'), document.getElementById('topbarActions'));
}

function rejectRequest(id) {
  const req = STATE.budgetRequests.find(r => r.id === id);
  if (!req) return;
  req.status = 'rejected';
  req.reviewedBy = STATE.currentUser.email;
  req.reviewedAt = new Date().toISOString();
  saveState();
  sendEmail(req.submittedBy, 'Budget Request Rejected',
    `Your budget request has been rejected by the General Counsel.\n\nDescription: ${req.description}\nAmount: ${formatCurrency(req.amount)}\n\nPlease contact the General Counsel for further details.`);
  showToast('Request rejected.');
  renderBudgetRequests(document.getElementById('mainContent'), document.getElementById('topbarActions'));
}

// ═══════════════════════════════════════════════════════════════
// DEPARTMENT EXPENSES
// ═══════════════════════════════════════════════════════════════

const EXPENSE_CATEGORIES = ['Travel', 'Office Supply', 'Database & Digital Tools', 'People Development', 'Hospitality', 'Gifts', 'Other'];

function renderExpenses(content, actions) {
  actions.innerHTML = `<button class="btn btn-primary" id="newExpenseBtn">+ New Expense</button>`;
  const expenses = isGC()
    ? STATE.expenses
    : STATE.expenses.filter(e => e.submittedBy === STATE.currentUser.email);

  content.innerHTML = `
  <div class="filter-bar">
    <input type="text" id="expSearch" placeholder="Search expenses..." class="search-input" />
    <select id="expCatFilter" class="filter-select">
      <option value="">All Categories</option>
      ${EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
    <select id="expStatusFilter" class="filter-select">
      <option value="">All Statuses</option>
      <option value="pending">Pending</option>
      <option value="approved">Approved</option>
      <option value="rejected">Rejected</option>
    </select>
  </div>
  <div id="expensesList"></div>
  <div id="expenseModal" class="modal-overlay" style="display:none"></div>`;

  document.getElementById('newExpenseBtn').addEventListener('click', () => openExpenseForm());
  document.getElementById('expSearch').addEventListener('input', refreshExpenseList);
  document.getElementById('expCatFilter').addEventListener('change', refreshExpenseList);
  document.getElementById('expStatusFilter').addEventListener('change', refreshExpenseList);

  function refreshExpenseList() {
    const q = document.getElementById('expSearch').value.toLowerCase();
    const cat = document.getElementById('expCatFilter').value;
    const st = document.getElementById('expStatusFilter').value;
    let list = isGC() ? STATE.expenses : STATE.expenses.filter(e => e.submittedBy === STATE.currentUser.email);
    if (q) list = list.filter(e => (e.description || '').toLowerCase().includes(q));
    if (cat) list = list.filter(e => e.category === cat);
    if (st) list = list.filter(e => e.status === st);
    renderExpenseList(list);
  }
  refreshExpenseList();
}

function renderExpenseList(expenses) {
  const el = document.getElementById('expensesList');
  if (!expenses.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🧾</div><p>No expenses recorded yet.</p></div>';
    return;
  }
  el.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Owner</th><th>Category</th><th>Description</th><th>Amount</th><th>Fee Type</th>
      <th>Payment Date</th><th>Status</th><th>Submitted By</th><th>Actions</th>
    </tr></thead>
    <tbody>${expenses.map(e => {
      const owner = STATE.users.find(u => u.email === (e.owner || e.submittedBy));
      return `<tr>
      <td><strong>${escapeHtml(owner ? owner.name : (e.owner || e.submittedBy))}</strong></td>
      <td><span class="tag tag-cat">${escapeHtml(e.category)}</span></td>
      <td class="desc-cell">${escapeHtml(e.description)}</td>
      <td><strong>${formatCurrency(e.amount)}</strong></td>
      <td><span class="tag tag-${e.feeType}">${e.feeType === 'actual' ? 'Actual' : 'Allocation'}</span></td>
      <td>${formatDate(e.paymentDate)}</td>
      <td><span class="status-badge status-${e.status}">${e.status}</span></td>
      <td>${escapeHtml(e.submittedBy)}</td>
      <td class="actions-cell">
        ${isGC() && e.status === 'pending' ? `
          <button class="btn-link approve" onclick="approveExpense('${e.id}')">✓</button>
          <button class="btn-link reject" onclick="rejectExpense('${e.id}')">✗</button>
          <button class="btn-link edit" onclick="openExpenseForm('${e.id}')">Edit</button>
        ` : ''}
        ${!isGC() && e.submittedBy === STATE.currentUser.email && e.status === 'pending' ?
          `<button class="btn-link edit" onclick="openExpenseForm('${e.id}')">Edit</button>` : ''}
      </td>
    </tr>`}).join('')}</tbody>
  </table>`;
}

function openExpenseForm(id) {
  const exp = id ? STATE.expenses.find(e => e.id === id) : null;
  const modal = document.getElementById('expenseModal');
  modal.style.display = 'flex';
  modal.innerHTML = `
  <div class="modal-box">
    <div class="modal-header">
      <h2>${exp ? 'Edit Expense' : 'New Department Expense'}</h2>
      <button class="modal-close" onclick="closeModal('expenseModal')">✕</button>
    </div>
    <form id="expenseForm" class="modal-form">
      <div class="form-row">
        <div class="field-group">
          <label>Category *</label>
          <select id="eCategory" required>
            <option value="">— Select —</option>
            ${EXPENSE_CATEGORIES.map(c => `<option value="${c}" ${exp && exp.category===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="field-group">
          <label>Amount *</label>
          <div class="amount-input-row">
            <select id="eCurrency" class="currency-input-select">
              ${SUPPORTED_CURRENCIES.map(c => `<option value="${c.code}" ${(exp && exp.currency===c.code) || (!exp && c.code==='USD') ? 'selected' : ''}>${c.symbol} ${c.code}</option>`).join('')}
            </select>
            <input type="number" id="eAmount" min="0" step="0.01" value="${exp ? exp.amount : ''}" required />
          </div>
        </div>
      </div>
      <div class="field-group">
        <label>Description *</label>
        <textarea id="eDescription" rows="3" required>${exp ? escapeHtml(exp.description) : ''}</textarea>
      </div>
      <div class="field-group">
        <label>Owner</label>
        <select id="eOwner">
          ${STATE.users.filter(u => u.active).map(u => `<option value="${u.email}" ${(exp && exp.owner === u.email) || (!exp && u.email === STATE.currentUser.email) ? 'selected' : ''}>${escapeHtml(u.name || u.email)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="field-group">
          <label>Fee Type *</label>
          <select id="eFeeType" required>
            <option value="actual" ${!exp||exp.feeType==='actual'?'selected':''}>Actual</option>
            <option value="allocation" ${exp&&exp.feeType==='allocation'?'selected':''}>Allocation</option>
          </select>
        </div>
        <div class="field-group">
          <label>Estimated Payment Date *</label>
          <input type="date" id="ePaymentDate" value="${exp ? exp.paymentDate : ''}" required />
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="closeModal('expenseModal')">Cancel</button>
        <button type="submit" class="btn btn-primary">Submit</button>
      </div>
    </form>
  </div>`;

  document.getElementById('expenseForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const category = document.getElementById('eCategory').value;
    const inputCurrency = document.getElementById('eCurrency').value;
    const rawAmount = parseFloat(document.getElementById('eAmount').value) || 0;
    const amount = toUSD(rawAmount, inputCurrency);
    const description = document.getElementById('eDescription').value.trim();
    const feeType = document.getElementById('eFeeType').value;
    const paymentDate = document.getElementById('ePaymentDate').value;
    const owner = document.getElementById('eOwner')?.value || STATE.currentUser.email;

    if (exp) {
      Object.assign(exp, { category, amount, currency: inputCurrency, description, feeType, paymentDate, owner, updatedAt: new Date().toISOString() });
    } else {
      STATE.expenses.push({
        id: genId(), category, amount, currency: inputCurrency, description, feeType, paymentDate,
        status: 'pending', submittedBy: STATE.currentUser.email, submittedAt: new Date().toISOString()
      });
      const lastExp = STATE.expenses[STATE.expenses.length - 1];
      if (owner && owner !== STATE.currentUser.email) lastExp.owner = owner;
      const gc = STATE.users.find(u => u.role === 'gc');
      if (gc) sendEmail(gc.email, 'New Expense Submitted',
        `A new department expense has been submitted by ${STATE.currentUser.name || STATE.currentUser.email}.\n\nCategory: ${category}\nAmount: ${formatCurrency(amount)}\nDescription: ${description}`);
    }
    saveState();
    closeModal('expenseModal');
    renderExpenses(document.getElementById('mainContent'), document.getElementById('topbarActions'));
  });
}

function approveExpense(id) {
  const exp = STATE.expenses.find(e => e.id === id);
  if (!exp) return;
  exp.status = 'approved';
  exp.reviewedAt = new Date().toISOString();
  saveState();
  sendEmail(exp.submittedBy, 'Expense Approved',
    `Your expense entry has been approved.\n\nCategory: ${exp.category}\nAmount: ${formatCurrency(exp.amount)}`);
  showToast('Expense approved.');
  renderExpenses(document.getElementById('mainContent'), document.getElementById('topbarActions'));
}

function rejectExpense(id) {
  const exp = STATE.expenses.find(e => e.id === id);
  if (!exp) return;
  exp.status = 'rejected';
  exp.reviewedAt = new Date().toISOString();
  saveState();
  sendEmail(exp.submittedBy, 'Expense Rejected',
    `Your expense entry has been rejected.\n\nCategory: ${exp.category}\nAmount: ${formatCurrency(exp.amount)}`);
  showToast('Expense rejected.');
  renderExpenses(document.getElementById('mainContent'), document.getElementById('topbarActions'));
}

// ═══════════════════════════════════════════════════════════════
// VENDORS
// ═══════════════════════════════════════════════════════════════

function renderVendors(content, actions) {
  actions.innerHTML = `<button class="btn btn-primary" id="newVendorBtn">+ Add Vendor</button>`;
  content.innerHTML = `
  <div class="filter-bar">
    <input type="text" id="vendorSearch" placeholder="Search vendors..." class="search-input" />
    <select id="vendorStatusFilter" class="filter-select">
      <option value="">All Statuses</option>
      <option value="pending">Pending</option>
      <option value="approved">Approved</option>
      <option value="rejected">Rejected</option>
    </select>
  </div>
  <div id="vendorsList"></div>
  <div id="vendorModal" class="modal-overlay" style="display:none"></div>`;

  document.getElementById('newVendorBtn').addEventListener('click', () => openVendorForm());
  document.getElementById('vendorSearch').addEventListener('input', refreshVendorList);
  document.getElementById('vendorStatusFilter').addEventListener('change', refreshVendorList);

  function refreshVendorList() {
    const q = document.getElementById('vendorSearch').value.toLowerCase();
    const st = document.getElementById('vendorStatusFilter').value;
    let list = STATE.vendors;
    if (q) list = list.filter(v => v.name.toLowerCase().includes(q));
    if (st) list = list.filter(v => v.status === st);
    renderVendorList(list);
  }
  refreshVendorList();
}

function renderVendorList(vendors) {
  const el = document.getElementById('vendorsList');
  if (!vendors.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🏢</div><p>No vendors registered yet.</p></div>';
    return;
  }
  el.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Vendor Name</th><th>Key Contacts</th><th>Document Folder</th><th>Status</th><th>Added By</th><th>Actions</th>
    </tr></thead>
    <tbody>${vendors.map(v => `<tr>
      <td><strong>${escapeHtml(v.name)}</strong></td>
      <td>${(v.contacts || []).map(c => `<div>${escapeHtml(c.name)} <a href="mailto:${escapeHtml(c.email)}" class="email-link">${escapeHtml(c.email)}</a></div>`).join('')}</td>
      <td>${v.folderLink ? `<a href="${escapeHtml(v.folderLink)}" target="_blank" class="btn-link">📁 Open Folder</a>` : '—'}</td>
      <td><span class="status-badge status-${v.status}">${v.status}</span></td>
      <td>${escapeHtml(v.addedBy)}</td>
      <td class="actions-cell">
        <button class="btn-link" onclick="openVendorForm('${v.id}')">Edit</button>
        ${isGC() && v.status === 'pending' ? `
          <button class="btn-link approve" onclick="approveVendor('${v.id}')">✓ Approve</button>
          <button class="btn-link reject" onclick="rejectVendor('${v.id}')">✗ Reject</button>
        ` : ''}
      </td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function openVendorForm(id) {
  const vendor = id ? STATE.vendors.find(v => v.id === id) : null;
  const contacts = vendor ? vendor.contacts : [{ name: '', email: '' }];
  const modal = document.getElementById('vendorModal');
  modal.style.display = 'flex';

  function renderContactRows(contacts) {
    return contacts.map((c, i) => `
    <div class="contact-row" data-i="${i}">
      <input type="text" class="contact-name" placeholder="Contact Name" value="${escapeHtml(c.name)}" />
      <input type="email" class="contact-email" placeholder="Contact Email" value="${escapeHtml(c.email)}" />
      ${i > 0 ? `<button type="button" class="btn-link reject remove-contact" data-i="${i}">✕</button>` : '<span></span>'}
    </div>`).join('');
  }

  modal.innerHTML = `
  <div class="modal-box">
    <div class="modal-header">
      <h2>${vendor ? 'Edit Vendor' : 'Register New Vendor'}</h2>
      <button class="modal-close" onclick="closeModal('vendorModal')">✕</button>
    </div>
    <form id="vendorForm" class="modal-form">
      <div class="field-group">
        <label>Vendor Name *</label>
        <input type="text" id="vName" value="${vendor ? escapeHtml(vendor.name) : ''}" required />
      </div>
      <div class="field-group">
        <label>Key Contacts *</label>
        <div id="contactRows">${renderContactRows(contacts)}</div>
        <button type="button" class="btn btn-secondary btn-sm" id="addContactBtn">+ Add Contact</button>
      </div>
      <div class="field-group">
        <label>Document Folder Link</label>
        <input type="url" id="vFolderLink" placeholder="https://..." value="${vendor && vendor.folderLink ? escapeHtml(vendor.folderLink) : ''}" />
        <div class="field-hint">Link to the folder in legal's online drive containing contracts and related documents.</div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="closeModal('vendorModal')">Cancel</button>
        <button type="submit" class="btn btn-primary">${vendor ? 'Save Changes' : 'Submit for Approval'}</button>
      </div>
    </form>
  </div>`;

  let localContacts = [...contacts];

  function rebind() {
    // Preserve any unsaved input by reading from DOM before re-rendering
    const existingRows = document.querySelectorAll('.contact-row');
    if (existingRows.length > 0) {
      localContacts = Array.from(existingRows).map(row => ({
        name: row.querySelector('.contact-name')?.value?.trim() || '',
        email: row.querySelector('.contact-email')?.value?.trim() || ''
      }));
      // Ensure at least one empty row exists
      if (localContacts.length === 0) localContacts.push({ name: '', email: '' });
    }
    document.getElementById('contactRows').innerHTML = renderContactRows(localContacts);
    document.querySelectorAll('.remove-contact').forEach(btn => {
      btn.addEventListener('click', () => {
        localContacts.splice(parseInt(btn.dataset.i), 1);
        // Re-read DOM before rebinding
        const rows = document.querySelectorAll('.contact-row');
        if (rows.length > 0) {
          localContacts = Array.from(rows).map(r => ({
            name: r.querySelector('.contact-name')?.value || '',
            email: r.querySelector('.contact-email')?.value || ''
          }));
        }
        localContacts.splice(parseInt(btn.dataset.i), 1);
        rebind();
      });
    });
  }
  rebind();

  document.getElementById('addContactBtn').addEventListener('click', () => {
    localContacts.push({ name: '', email: '' });
    rebind();
  });

  document.getElementById('vendorForm').addEventListener('submit', ev => {
    ev.preventDefault();
    // Read contacts from DOM
    const rows = document.querySelectorAll('.contact-row');
    const finalContacts = Array.from(rows).map(row => ({
      name: row.querySelector('.contact-name').value.trim(),
      email: row.querySelector('.contact-email').value.trim()
    })).filter(c => c.name || c.email);

    const name = document.getElementById('vName').value.trim();
    const folderLink = document.getElementById('vFolderLink').value.trim();

    if (vendor) {
      Object.assign(vendor, { name, contacts: finalContacts, folderLink, updatedAt: new Date().toISOString() });
    } else {
      const newVendor = {
        id: genId(), name, contacts: finalContacts, folderLink,
        status: 'pending', addedBy: STATE.currentUser.email, addedAt: new Date().toISOString()
      };
      STATE.vendors.push(newVendor);
      const gc = STATE.users.find(u => u.role === 'gc');
      if (gc) sendEmail(gc.email, 'New Vendor Registration Request',
        `A new vendor has been submitted for approval by ${STATE.currentUser.name || STATE.currentUser.email}.\n\nVendor: ${name}\nContacts: ${finalContacts.map(c=>c.name+' <'+c.email+'>').join(', ')}`);
    }
    saveState();
    closeModal('vendorModal');
    renderVendors(document.getElementById('mainContent'), document.getElementById('topbarActions'));
  });
}

function approveVendor(id) {
  const v = STATE.vendors.find(x => x.id === id);
  if (!v) return;
  v.status = 'approved';
  v.reviewedAt = new Date().toISOString();
  saveState();
  sendEmail(v.addedBy, 'Vendor Approved',
    `The vendor "${v.name}" has been approved by the General Counsel and is now available for budget requests.`);
  showToast(`Vendor "${v.name}" approved.`);
  renderVendors(document.getElementById('mainContent'), document.getElementById('topbarActions'));
}

function rejectVendor(id) {
  const v = STATE.vendors.find(x => x.id === id);
  if (!v) return;
  v.status = 'rejected';
  v.reviewedAt = new Date().toISOString();
  saveState();
  sendEmail(v.addedBy, 'Vendor Registration Rejected',
    `The vendor registration for "${v.name}" has been rejected by the General Counsel.`);
  showToast(`Vendor "${v.name}" rejected.`);
  renderVendors(document.getElementById('mainContent'), document.getElementById('topbarActions'));
}

// ═══════════════════════════════════════════════════════════════
// USER MANAGEMENT (GC only)
// ═══════════════════════════════════════════════════════════════

function renderUsers(content, actions) {
  if (!isGC()) { content.innerHTML = '<p>Access denied.</p>'; return; }
  actions.innerHTML = `<button class="btn btn-primary" id="newUserBtn">+ Invite User</button>`;
  content.innerHTML = `
  <div id="usersList"></div>
  <div id="userModal" class="modal-overlay" style="display:none"></div>`;
  renderUserList();
  document.getElementById('newUserBtn').addEventListener('click', () => openUserForm());
}

function renderUserList() {
  const el = document.getElementById('usersList');
  const users = STATE.users;
  el.innerHTML = `<table class="data-table">
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${users.map(u => `<tr>
      <td><strong>${escapeHtml(u.name || '—')}</strong></td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="tag tag-role-${u.role}">${u.role === 'gc' ? 'General Counsel' : 'Legal Team'}</span></td>
      <td><span class="status-badge status-${u.active ? 'approved' : 'rejected'}">${u.active ? 'Active' : 'Inactive'}</span></td>
      <td class="actions-cell">
        ${u.email !== 'tao.guan@dragonpass.com' ? `
          <button class="btn-link edit" onclick="openUserForm('${u.id}')">Edit</button>
          <button class="btn-link ${u.active ? 'reject' : 'approve'}" onclick="toggleUser('${u.id}')">${u.active ? 'Deactivate' : 'Activate'}</button>
        ` : '<em>You</em>'}
      </td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function openUserForm(id) {
  const user = id ? STATE.users.find(u => u.id === id) : null;
  const modal = document.getElementById('userModal');
  modal.style.display = 'flex';
  modal.innerHTML = `
  <div class="modal-box">
    <div class="modal-header">
      <h2>${user ? 'Edit User' : 'Invite New User'}</h2>
      <button class="modal-close" onclick="closeModal('userModal')">✕</button>
    </div>
    <form id="userForm" class="modal-form">
      <div class="field-group">
        <label>Full Name *</label>
        <input type="text" id="uName" value="${user ? escapeHtml(user.name) : ''}" required />
      </div>
      <div class="field-group">
        <label>Email Address (Account Name) *</label>
        <input type="email" id="uEmail" value="${user ? escapeHtml(user.email) : ''}" ${user ? 'readonly' : 'required'} />
      </div>
      <div class="field-group">
        <label>${user ? 'Reset Password (leave blank to keep)' : 'Set Password *'}</label>
        <input type="password" id="uPassword" placeholder="••••••••" ${user ? '' : 'required'} />
      </div>
      <div class="field-group">
        <label>Role *</label>
        <select id="uRole" ${user && user.email === 'tao.guan@dragonpass.com' ? 'disabled' : ''}>
          <option value="member" ${user && user.role==='member' ? 'selected' : ''}>Legal Team Member</option>
          <option value="gc" ${user && user.role==='gc' ? 'selected' : ''}>General Counsel</option>
        </select>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="closeModal('userModal')">Cancel</button>
        <button type="submit" class="btn btn-primary">${user ? 'Save Changes' : 'Create Account'}</button>
      </div>
    </form>
  </div>`;

  document.getElementById('userForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const name = document.getElementById('uName').value.trim();
    const email = document.getElementById('uEmail').value.trim();
    const password = document.getElementById('uPassword').value;
    const role = document.getElementById('uRole').value;

    if (user) {
      user.name = name;
      if (password) user.password = password;
      user.role = role;
    } else {
      if (STATE.users.find(u => u.email === email)) {
        alert('A user with this email already exists.');
        return;
      }
      STATE.users.push({ id: genId(), name, email, password, role, active: true });
      sendEmail(email, 'Welcome to DragonPass Legal Budget Manager',
        `Hi ${name},\n\nYour account has been created by the General Counsel.\n\nEmail: ${email}\nPassword: ${password}\n\nPlease log in and manage your password securely.`);
    }
    saveState();
    closeModal('userModal');
    renderUserList();
  });
}

function toggleUser(id) {
  const u = STATE.users.find(x => x.id === id);
  if (!u) return;
  u.active = !u.active;
  saveState();
  renderUserList();
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

function renderNotifications(content, actions) {
  actions.innerHTML = `<button class="btn btn-secondary" onclick="markAllRead()">Mark All Read</button>`;
  const notes = isGC()
    ? STATE.notifications
    : STATE.notifications.filter(n => n.to === STATE.currentUser.email);

  content.innerHTML = `<div class="notif-list" id="notifList"></div>`;

  function renderList() {
    const el = document.getElementById('notifList');
    if (!notes.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div><p>No notifications.</p></div>';
      return;
    }
    el.innerHTML = notes.slice().reverse().map(n => `
    <div class="notif-card ${n.read ? '' : 'unread'}" onclick="markRead('${n.id}')">
      <div class="notif-meta">
        <span class="notif-to">To: ${escapeHtml(n.to)}</span>
        <span class="notif-date">${formatDate(n.sentAt)}</span>
        ${!n.read ? '<span class="notif-dot"></span>' : ''}
      </div>
      <div class="notif-subject">${escapeHtml(n.subject)}</div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
    </div>`).join('');
  }
  renderList();
}

function markRead(id) {
  const n = STATE.notifications.find(x => x.id === id);
  if (n) { n.read = true; saveState(); renderNotifications(document.getElementById('mainContent'), document.getElementById('topbarActions')); }
}

function markAllRead() {
  const user = STATE.currentUser;
  STATE.notifications.filter(n => isGC() || n.to === user.email).forEach(n => n.read = true);
  saveState();
  renderNotifications(document.getElementById('mainContent'), document.getElementById('topbarActions'));
}

// ── Helpers ──────────────────────────────────────────────────

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.style.display = 'none';
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show';
  setTimeout(() => t.className = 'toast', 2500);
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderApp();
  // Fetch exchange rates if never fetched or older than 24h
  const lastFetch = STATE.lastRateFetch;
  const shouldFetch = !lastFetch || (Date.now() - new Date(lastFetch).getTime()) > 24 * 60 * 60 * 1000;
  if (shouldFetch) {
    fetchExchangeRates();
  }
});
