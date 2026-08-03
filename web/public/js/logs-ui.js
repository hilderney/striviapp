(function (global) {
  'use strict';

  let logsData = [];
  let selectedLogs = new Set();
  let currentLog = null;
  let searchDebounce = null;

  function formatModifiedAt(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function getSortParts() {
    const value = document.getElementById('log-sort')?.value || 'date-desc';
    const [sort, order] = value.split('-');
    return { sort, order };
  }

  function getVisibleLogs() {
    const search = (document.getElementById('log-search')?.value || '').trim().toLowerCase();
    const { sort, order } = getSortParts();
    let visible = logsData.slice();

    if (search) {
      visible = visible.filter((entry) => entry.name.toLowerCase().includes(search));
    }

    const direction = order === 'asc' ? 1 : -1;
    visible.sort((left, right) => {
      if (sort === 'name') {
        return left.name.localeCompare(right.name) * direction;
      }
      return String(left.modifiedAt).localeCompare(String(right.modifiedAt)) * direction;
    });

    return visible;
  }

  function updateSelectionUI() {
    const visible = getVisibleLogs();
    const deleteBtn = document.getElementById('log-delete-selected');
    const countEl = document.getElementById('log-count');
    if (deleteBtn) {
      deleteBtn.disabled = selectedLogs.size === 0;
    }
    if (countEl) {
      countEl.textContent = `${selectedLogs.size} de ${visible.length} arquivos selecionados`;
    }
    updateSelectAllCheckbox();
  }

  function updateSelectAllCheckbox() {
    const selectAll = document.getElementById('log-select-all');
    if (!selectAll) {
      return;
    }
    const visible = getVisibleLogs();
    if (visible.length === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      return;
    }
    const selectedVisible = visible.filter((entry) => selectedLogs.has(entry.name)).length;
    selectAll.checked = selectedVisible === visible.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
  }

  function renderLogTableRow(entry) {
    const utils = global.fileInputUtils || {};
    const size = utils.formatFileSize ? utils.formatFileSize(entry.sizeBytes) : `${entry.sizeBytes} B`;
    const escapeHtml = utils.escapeHtml || ((value) => String(value));
    const checked = selectedLogs.has(entry.name) ? 'checked' : '';
    return `
      <tr data-log-name="${escapeHtml(entry.name)}">
        <td class="col-check">
          <input type="checkbox" class="log-row-check" data-name="${escapeHtml(entry.name)}" ${checked} aria-label="Selecionar ${escapeHtml(entry.name)}">
        </td>
        <td>${escapeHtml(entry.name)}</td>
        <td>${escapeHtml(size)}</td>
        <td>${escapeHtml(formatModifiedAt(entry.modifiedAt))}</td>
        <td><button type="button" class="btn-secondary log-open-btn" data-name="${escapeHtml(entry.name)}">Abrir</button></td>
      </tr>
    `;
  }

  function renderLogsTable() {
    const tbody = document.querySelector('#log-table tbody');
    if (!tbody) {
      return;
    }
    const visible = getVisibleLogs();
    tbody.innerHTML = visible.map(renderLogTableRow).join('');
    updateSelectionUI();
  }

  async function loadLogs() {
    const payload = await global.api.listLogs();
    logsData = payload.logs || [];
    const existing = new Set(logsData.map((entry) => entry.name));
    selectedLogs = new Set([...selectedLogs].filter((name) => existing.has(name)));
    if (currentLog && !existing.has(currentLog)) {
      clearLogViewer();
    }
    renderLogsTable();
  }

  function clearLogViewer() {
    currentLog = null;
    const title = document.getElementById('log-content-title');
    const content = document.getElementById('log-content');
    if (title) {
      title.hidden = true;
      title.textContent = '';
    }
    if (content) {
      content.textContent = '';
    }
  }

  async function openLog(filename) {
    const payload = await global.api.readLog(filename);
    currentLog = payload.name;
    const title = document.getElementById('log-content-title');
    const content = document.getElementById('log-content');
    if (title) {
      title.hidden = false;
      title.textContent = payload.name;
    }
    if (content) {
      content.textContent = payload.content || '';
    }
  }

  async function deleteSelected() {
    const names = [...selectedLogs];
    if (names.length === 0) {
      return;
    }
    if (!global.confirm(`Excluir ${names.length} arquivo${names.length === 1 ? '' : 's'} de log?`)) {
      return;
    }
    await global.api.deleteLogsBatch(names);
    selectedLogs.clear();
    if (currentLog && names.includes(currentLog)) {
      clearLogViewer();
    }
    await loadLogs();
  }

  function bindEvents() {
    const search = document.getElementById('log-search');
    const sort = document.getElementById('log-sort');
    const selectAll = document.getElementById('log-select-all');
    const deleteBtn = document.getElementById('log-delete-selected');
    const table = document.getElementById('log-table');

    if (search) {
      search.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => renderLogsTable(), 300);
      });
    }

    if (sort) {
      sort.addEventListener('change', () => renderLogsTable());
    }

    if (selectAll) {
      selectAll.addEventListener('change', () => {
        const visible = getVisibleLogs();
        if (selectAll.checked) {
          visible.forEach((entry) => selectedLogs.add(entry.name));
        } else {
          visible.forEach((entry) => selectedLogs.delete(entry.name));
        }
        renderLogsTable();
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        deleteSelected().catch((error) => {
          global.alert(error.message || 'Falha ao excluir logs');
        });
      });
    }

    if (table) {
      table.addEventListener('change', (event) => {
        const checkbox = event.target.closest('.log-row-check');
        if (!checkbox) {
          return;
        }
        const name = checkbox.dataset.name;
        if (checkbox.checked) {
          selectedLogs.add(name);
        } else {
          selectedLogs.delete(name);
        }
        updateSelectionUI();
      });

      table.addEventListener('click', (event) => {
        const button = event.target.closest('.log-open-btn');
        if (!button) {
          return;
        }
        openLog(button.dataset.name).catch((error) => {
          global.alert(error.message || 'Falha ao abrir log');
        });
      });
    }

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === 'logs') {
          loadLogs().catch((error) => {
            global.alert(error.message || 'Falha ao carregar logs');
          });
        }
      });
    });
  }

  function initLogsUi() {
    bindEvents();
    updateSelectionUI();
  }

  global.initLogsUi = initLogsUi;
})(window);
