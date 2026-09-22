const API = {
  async request(url, options = {}) {
    const defaults = {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    const config = { ...defaults, ...options };
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }
    if (config.body instanceof FormData) {
      delete config.headers['Content-Type'];
    }
    const response = await fetch(url, config);
    const data = await response.json();
    if (!response.ok) throw { status: response.status, ...data };
    return data;
  },
  get: (url) => API.request(url),
  post: (url, body) => API.request(url, { method: 'POST', body }),
  patch: (url, body) => API.request(url, { method: 'PATCH', body }),
  delete: (url) => API.request(url, { method: 'DELETE' }),
  upload: (url, formData) => API.request(url, { method: 'POST', body: formData }),
};

function showAlert(message, type = 'info') {
  const existing = document.querySelector('.alert');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.textContent = message;
  const container = document.querySelector('.content') || document.querySelector('.auth-card') || document.body;
  container.insertBefore(div, container.firstChild);
  setTimeout(() => div.remove(), 5000);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('en-PK', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(amount) {
  return `PKR ${Number(amount).toLocaleString()}`;
}

function statusBadge(status) {
  const classes = {
    PENDING_REVIEW: 'badge-pending', SUBMITTED: 'badge-pending',
    APPROVED: 'badge-approved', REJECTED: 'badge-rejected',
    REQUEST_CLEARER_IMAGE: 'badge-warning', REVERSED: 'badge-rejected',
    ACTIVE: 'badge-active', USED: 'badge-used', EXPIRED: 'badge-rejected', CANCELLED: 'badge-rejected',
  };
  return `<span class="badge ${classes[status] || 'badge-pending'}">${status.replace(/_/g, ' ')}</span>`;
}

function initUploadArea() {
  const area = document.querySelector('.upload-area');
  if (!area) return;
  const input = area.querySelector('input[type="file"]');
  const preview = document.querySelector('.upload-preview');

  area.addEventListener('click', () => input.click());
  area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      showPreview(e.dataTransfer.files[0]);
    }
  });
  input.addEventListener('change', () => { if (input.files.length) showPreview(input.files[0]); });

  function showPreview(file) {
    if (!preview) return;
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => { preview.src = e.target.result; preview.style.display = 'block'; };
      reader.readAsDataURL(file);
    } else {
      preview.style.display = 'none';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initUploadArea();
  document.querySelectorAll('.btn-logout').forEach(btn => {
    btn.addEventListener('click', async () => {
      await API.post('/api/auth/logout');
      window.location.href = '/login';
    });
  });
});
