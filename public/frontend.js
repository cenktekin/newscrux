// public/frontend.js
const API_BASE = window.location.origin;

async function apiRequest(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json();
}

async function loadFeeds() {
  try {
    const feeds = await apiRequest('/api/feeds');
    document.getElementById('feedCount').textContent = feeds.length;
    renderFeedList(feeds);
  } catch (err) {
    console.error('Failed to load feeds:', err);
    showError('Failed to load feeds');
  }
}

function renderFeedList(feeds) {
  const container = document.getElementById('feedList');
  if (feeds.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #8b949e; padding: 20px;">No feeds configured. Add feeds or import from OPML.</p>';
    return;
  }

  container.innerHTML = feeds.map(feed => `
    <div class="feed-item" data-id="${feed.id}">
      <div class="feed-item-info">
        <h3>${escapeHtml(feed.name)}</h3>
        <p>${escapeHtml(feed.url)}</p>
        <p>Kind: ${feed.kind} | Priority: ${feed.priority}</p>
      </div>
      <div class="feed-item-actions">
        <button class="btn btn-sm btn-danger delete-feed" data-id="${feed.id}">Delete</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.delete-feed').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      if (!confirm('Delete this feed?')) return;
      try {
        await apiRequest(`/api/feeds/${id}`, { method: 'DELETE' });
        loadFeeds();
      } catch (err) {
        console.error('Failed to delete feed:', err);
        showError('Failed to delete feed');
      }
    });
  });
}

async function addFeed() {
  const name = document.getElementById('feedName').value.trim();
  const url = document.getElementById('feedUrl').value.trim();
  const kind = document.getElementById('feedKind').value;
  const priority = document.getElementById('feedPriority').value;

  if (!name || !url) {
    showError('Name and URL are required');
    return;
  }

  try {
    await apiRequest('/api/feeds', {
      method: 'POST',
      body: JSON.stringify({ name, url, kind, priority }),
    });
    document.getElementById('feedName').value = '';
    document.getElementById('feedUrl').value = '';
    loadFeeds();
  } catch (err) {
    console.error('Failed to add feed:', err);
    showError('Failed to add feed');
  }
}

async function importOpml() {
  const fileInput = document.getElementById('opmlFile');
  const titleInput = document.getElementById('opmlTitle');
  
  if (!fileInput.files.length) {
    showError('Please select an OPML file');
    return;
  }

  const file = fileInput.files[0];
  const opml = await file.text();
  const title = titleInput.value.trim();

  try {
    const result = await apiRequest('/api/feeds/import-opml', {
      method: 'POST',
      body: JSON.stringify({ opml, title }),
    });
    loadFeeds();
    fileInput.value = '';
    titleInput.value = '';
    alert(`Imported ${result.imported} feeds from OPML`);
  } catch (err) {
    console.error('Failed to import OPML:', err);
    showError('Failed to import OPML');
  }
}

async function exportOpml() {
  try {
    const response = await fetch(`${API_BASE}/api/feeds/export-opml`);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'feeds.opml';
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Failed to export OPML:', err);
    showError('Failed to export OPML');
  }
}

async function showExistingSummaries() {
  const summariesContainer = document.getElementById('summaries');
  summariesContainer.innerHTML = '<div class="loading">Loading existing summaries...</div>';

  try {
    const response = await fetch(`${API_BASE}/api/summaries`);
    const result = await response.json();
    
    renderSummaries(result.summaries || [], 'No summaries in queue yet.');
  } catch (err) {
    console.error('Failed to load summaries:', err);
    showError('Failed to load summaries');
  }
}

function renderSummaries(summaries, emptyText) {
  const summariesContainer = document.getElementById('summaries');
  if (!summaries || summaries.length === 0) {
    summariesContainer.innerHTML = `<p style="text-align: center; color: #8b949e;">${escapeHtml(emptyText)}</p>`;
    return;
  }

  summariesContainer.innerHTML = summaries.map(s => `
    <div class="summary-card">
      <div class="summary-header">
        <span class="feed-badge">${escapeHtml(s.feedName)}</span>
        ${s.isArxiv ? '<span class="arxiv-badge">arXiv</span>' : ''}
      </div>
      <h3>${escapeHtml(s.title)}</h3>
      <div class="summary-content">
        <p><strong>Ne oldu:</strong> ${escapeHtml(s.whatHappened)}</p>
        ${s.whyItMatters ? `<p><strong>Neden önemli:</strong> ${escapeHtml(s.whyItMatters)}</p>` : ''}
        ${s.keyDetail ? `<p><strong>Kritik detay:</strong> ${escapeHtml(s.keyDetail)}</p>` : ''}
      </div>
      <div class="summary-footer">
        <a href="${escapeHtml(s.link)}" target="_blank" class="read-more">Read more →</a>
      </div>
    </div>
  `).join('');
}

async function triggerPoll() {
  const btn = document.getElementById('pollBtn');
  btn.disabled = true;
  btn.textContent = 'Processing...';
  
  const summariesContainer = document.getElementById('summaries');
  summariesContainer.innerHTML = '<div class="loading">Fetching RSS feeds...</div>';

  try {
    await apiRequest('/api/poll?mode=async', { method: 'POST' });

    let status = 'running';
    let pollResult = null;
    let lastCounts = null;
    
    while (status === 'running' || status === 'idle') {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const [statusResult, queueResult] = await Promise.all([
        apiRequest('/api/poll-status'),
        apiRequest('/api/queue-status').catch(() => null),
      ]);
      status = statusResult.status;
      pollResult = statusResult.result;
      
      if (queueResult) {
        lastCounts = queueResult;
        const total = queueResult.discovered + queueResult.enriched + queueResult.summarized;
        if (total > 0) {
          summariesContainer.innerHTML = `
            <div class="loading">
              <div style="margin-bottom: 12px;">Processing articles...</div>
              <div style="font-size: 13px; color: #8b949e;">
                <div>📄 Discovered: <strong>${queueResult.discovered}</strong></div>
                <div>🔍 Enriched: <strong>${queueResult.enriched}</strong></div>
                <div>📝 Summarized: <strong>${queueResult.summarized}</strong></div>
                ${queueResult.failed > 0 ? `<div style="color: #f85149;">❌ Failed: <strong>${queueResult.failed}</strong></div>` : ''}
              </div>
            </div>`;
        }
      }
      
      if (status === 'failed') {
        throw new Error(statusResult.error || 'Poll failed');
      }
    }

    if (pollResult && pollResult.metrics) {
      const m = pollResult.metrics;
      summariesContainer.innerHTML = `
        <div class="loading" style="text-align: left; padding: 16px;">
          <div style="font-size: 16px; margin-bottom: 12px; color: #58a6ff;">✓ Poll completed</div>
          <div style="font-size: 13px; color: #8b949e; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
            <div>📄 Discovered: <strong>${m.discovered}</strong></div>
            <div>🔍 Enriched: <strong>${m.enriched}</strong></div>
            <div>✅ Passed filter: <strong>${m.relevance_passed}</strong></div>
            <div>📝 Summarized: <strong>${m.summarized}</strong></div>
            <div>📤 Sent: <strong>${m.sent}</strong></div>
            ${m.failed > 0 ? `<div style="color: #f85149;">❌ Failed: <strong>${m.send_failed}</strong></div>` : ''}
          </div>
        </div>`;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    if (pollResult && pollResult.status === 'cold_start') {
      summariesContainer.innerHTML = '<p style="text-align: center; color: #8b949e;">Cold start - no articles tracked yet. Will notify when new articles arrive.</p>';
    } else if (pollResult && pollResult.status === 'no_new_articles') {
      summariesContainer.innerHTML = '<p style="text-align: center; color: #8b949e;">No new articles found.</p>';
    } else {
      renderSummaries((pollResult && pollResult.summaries) || [], 'No summaries generated.');
    }
    
    await loadFeeds();
    btn.disabled = false;
    btn.textContent = 'Pull & Summarize';
  } catch (err) {
    console.error('Failed to trigger poll:', err);
    showError('Failed to trigger poll');
    btn.disabled = false;
    btn.textContent = 'Pull & Summarize';
  }
}

function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error';
  errorDiv.textContent = message;
  document.querySelector('.container').insertBefore(errorDiv, document.querySelector('.section'));
  setTimeout(() => errorDiv.remove(), 5000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  loadFeeds();
  
  document.getElementById('addFeedBtn').addEventListener('click', addFeed);
  document.getElementById('importBtn').addEventListener('click', importOpml);
  document.getElementById('exportBtn').addEventListener('click', exportOpml);
  document.getElementById('showSummariesBtn').addEventListener('click', showExistingSummaries);
  document.getElementById('pollBtn').addEventListener('click', triggerPoll);
});
