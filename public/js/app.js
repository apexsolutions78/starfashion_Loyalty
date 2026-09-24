function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.content : '';
}

function setCsrfToken(token) {
  if (!token) return;
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) meta.content = token;
}

const API = {
  async request(url, options = {}) {
    const config = {
      credentials: 'same-origin',
      ...options,
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    };
    const method = String(config.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const token = getCsrfToken();
      if (token) config.headers['X-CSRF-Token'] = token;
    }
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      if (!config.headers['Content-Type'] && !config.headers['content-type']) {
        config.headers['Content-Type'] = 'application/json';
      }
      config.body = JSON.stringify(config.body);
    }
    const response = await fetch(url, config);
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: { message: text } };
      }
    }
    if (!response.ok) throw { status: response.status, ...data };
    return data;
  },
  get: (url) => API.request(url),
  post: (url, body) => API.request(url, { method: 'POST', body }),
  patch: (url, body) => API.request(url, { method: 'PATCH', body }),
  delete: (url) => API.request(url, { method: 'DELETE' }),
  upload: (url, formData) => API.request(url, { method: 'POST', body: formData }),
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showAlert(message, type = 'info') {
  const existing = document.querySelector('.alert');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.textContent = message;
  const target = document.getElementById('alert') ||
    document.querySelector('.content') ||
    document.querySelector('.auth-card') ||
    document.body;
  target.insertBefore(div, target.firstChild);
  setTimeout(() => div.remove(), 5000);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  let d;
  if (dateStr instanceof Date) {
    d = dateStr;
  } else if (typeof dateStr === 'number' || (typeof dateStr === 'string' && /^-?\d+(\.\d+)?$/.test(String(dateStr).trim()))) {
    d = new Date(Number(dateStr));
  } else {
    d = new Date(dateStr);
  }
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  let d;
  if (dateStr instanceof Date) {
    d = dateStr;
  } else if (typeof dateStr === 'number' || (typeof dateStr === 'string' && /^-?\d+(\.\d+)?$/.test(String(dateStr).trim()))) {
    d = new Date(Number(dateStr));
  } else {
    d = new Date(dateStr);
  }
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-PK', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '-';
  return `PKR ${n.toLocaleString()}`;
}

function statusBadge(status) {
  const classes = {
    PENDING_REVIEW: 'badge-pending', SUBMITTED: 'badge-pending',
    APPROVED: 'badge-approved', REJECTED: 'badge-rejected',
    REQUEST_CLEARER_IMAGE: 'badge-warning', REVERSED: 'badge-rejected',
    ACTIVE: 'badge-active', USED: 'badge-used', EXPIRED: 'badge-rejected', CANCELLED: 'badge-rejected',
    SUSPENDED: 'badge-rejected',
  };
  const raw = String(status || 'UNKNOWN');
  const key = raw.toUpperCase();
  return `<span class="badge ${classes[key] || 'badge-pending'}">${esc(key.replace(/_/g, ' '))}</span>`;
}

function initUploadArea() {
  const area = document.querySelector('.upload-area');
  if (!area) return;
  const input = area.querySelector('input[type="file"]');
  const preview = document.querySelector('.upload-preview');
  const fileNameEl = area.querySelector('.file-name');
  const allowed = (input.accept || '').split(',').map((s) => s.trim()).filter(Boolean);
  const maxBytes = Number(area.dataset.maxBytes || 8 * 1024 * 1024);

  function setFiles(fileList) {
    if (!fileList || !fileList.length) return false;
    const file = fileList[0];
    if (allowed.length && file.type && !allowed.includes(file.type)) {
      showAlert('File type not allowed. Use JPEG, PNG, or PDF.', 'danger');
      return false;
    }
    if (file.size > maxBytes) {
      showAlert('File too large. Maximum size is 8MB.', 'danger');
      return false;
    }
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch {
      input.files = fileList;
    }
    updateFileLabel(file);
    showPreview(file);
    return true;
  }

  function updateFileLabel(file) {
    if (!fileNameEl) return;
    const kb = file.size < 1024 * 1024
      ? `${Math.max(1, Math.round(file.size / 1024))} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    fileNameEl.textContent = `${file.name} (${kb})`;
    fileNameEl.hidden = false;
  }

  input.addEventListener('click', (e) => e.stopPropagation());
  area.addEventListener('click', () => input.click());
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  if (!area.hasAttribute('tabindex')) area.tabIndex = 0;

  area.addEventListener('dragenter', (e) => {
    e.preventDefault();
    area.classList.add('dragover');
  });
  area.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    area.classList.add('dragover');
  });
  area.addEventListener('dragleave', (e) => {
    if (area.contains(e.relatedTarget)) return;
    area.classList.remove('dragover');
  });
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    area.classList.remove('dragover');
    const files = e.dataTransfer && e.dataTransfer.files;
    setFiles(files);
  });

  input.addEventListener('change', () => {
    if (input.files.length) setFiles(input.files);
  });

  function showPreview(file) {
    if (!preview) return;
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        preview.src = ev.target.result;
        preview.style.display = 'block';
      };
      reader.onerror = () => {
        preview.style.display = 'none';
      };
      reader.readAsDataURL(file);
    } else {
      preview.removeAttribute('src');
      preview.style.display = 'none';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initUploadArea();
  document.querySelectorAll('.btn-logout').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await API.post('/api/auth/logout');
      } catch {
        // ignore - still redirect
      }
      window.location.href = '/login';
    });
  });
});
