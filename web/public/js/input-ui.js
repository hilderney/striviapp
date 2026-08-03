(function () {
  'use strict';

  const utils = window.fileInputUtils;
  if (!utils) {
    console.error('fileInputUtils não carregado. Verifique a ordem dos scripts.');
    return;
  }

  const pendingFiles = new Map();
  let nextFileId = 0;
  let isProcessing = false;

  function logInput(message, isError = false) {
    const el = document.getElementById('files-log');
    if (!el) return;
    const prefix = isError ? '[ERRO] ' : '';
    el.textContent += `${prefix}${message}\n`;
    el.scrollTop = el.scrollHeight;
    el.className = isError ? 'log error' : 'log';
  }

  function addPendingFiles(fileList) {
    const added = [];
    const skipped = [];

    for (const file of fileList) {
      if (!utils.isAllowedInputFile(file)) {
        skipped.push(file.name || '(sem nome)');
        continue;
      }

      const key = `f-${(nextFileId += 1)}`;
      pendingFiles.set(key, { file, selected: true, key });
      added.push(file);
      logInput(`Adicionado: ${file.name} (${utils.formatFileSize(file.size)})`);
    }

    if (skipped.length > 0) {
      logInput(`Ignorados (formato inválido): ${skipped.join(', ')}`, true);
    }

    if (fileList.length > 0 && added.length === 0) {
      throw new Error('Nenhum PDF ou planilha (.pdf, .xlsx, .xls) válido selecionado.');
    }

    renderPendingFiles();
    return added;
  }

  function removePendingFile(key) {
    const entry = pendingFiles.get(key);
    if (entry) {
      logInput(`Removido: ${entry.file.name}`);
    }
    pendingFiles.delete(key);
    renderPendingFiles();
  }

  function clearPendingFiles() {
    pendingFiles.clear();
    renderPendingFiles();
    document.getElementById('process-metadata').innerHTML = '';
  }

  function getSelectedPendingFiles() {
    return [...pendingFiles.values()].filter((entry) => entry.selected).map((entry) => entry.file);
  }

  function setProcessingState(active) {
    isProcessing = active;
    const btn = document.getElementById('btn-process-selected');
    const pickBtn = document.getElementById('btn-pick-files');
    const clearBtn = document.getElementById('btn-clear-files');
    const dropZone = document.getElementById('file-drop-zone');

    if (btn) {
      btn.disabled = active;
      btn.textContent = active ? 'Processando...' : 'Processar selecionados';
    }
    if (pickBtn) pickBtn.disabled = active;
    if (clearBtn) clearBtn.disabled = active;
    if (dropZone) dropZone.classList.toggle('drop-zone--uploading', active);
  }

  function renderPendingFiles() {
    const tbody = document.querySelector('#selected-files-table tbody');
    const selectAll = document.getElementById('select-all-files');
    if (!tbody || !selectAll) return;

    tbody.innerHTML = '';

    const entries = [...pendingFiles.values()];
    if (entries.length === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      document.getElementById('selection-summary').textContent =
        'Nenhum arquivo selecionado. Arraste arquivos ou use o botão abaixo.';
      return;
    }

    for (const entry of entries) {
      const type = utils.getInputFileType(entry.file);
      const tr = document.createElement('tr');
      tr.innerHTML = `
      <td class="col-check"><input type="checkbox" data-key="${entry.key}" ${entry.selected ? 'checked' : ''}></td>
      <td>${utils.escapeHtml(entry.file.name)}</td>
      <td><span class="type-badge type-${type}">${type === 'pdf' ? 'PDF' : 'Planilha'}</span></td>
      <td>${utils.formatFileSize(entry.file.size)}</td>
      <td><button type="button" class="btn-link btn-remove" data-remove="${entry.key}">Remover</button></td>
    `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const entry = pendingFiles.get(checkbox.dataset.key);
        if (entry) {
          entry.selected = checkbox.checked;
          updateSelectionSummary();
          updateSelectAllState();
        }
      });
    });

    tbody.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', () => removePendingFile(button.dataset.remove));
    });

    updateSelectionSummary();
    updateSelectAllState();
  }

  function updateSelectionSummary() {
    const total = pendingFiles.size;
    const selected = getSelectedPendingFiles().length;
    const pdfs = getSelectedPendingFiles().filter((f) => utils.getInputFileType(f) === 'pdf').length;
    const sheets = selected - pdfs;
    const el = document.getElementById('selection-summary');
    if (!el) return;
    el.textContent =
      total === 0
        ? 'Nenhum arquivo selecionado.'
        : `${selected} de ${total} arquivo(s) marcado(s) — ${pdfs} PDF, ${sheets} planilha(s)`;
    el.className = selected > 0 ? 'hint success' : 'hint';
  }

  function updateSelectAllState() {
    const selectAll = document.getElementById('select-all-files');
    if (!selectAll) return;
    const entries = [...pendingFiles.values()];
    const selectedCount = entries.filter((entry) => entry.selected).length;
    selectAll.checked = entries.length > 0 && selectedCount === entries.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < entries.length;
  }

  function renderProcessMetadata(results) {
    const container = document.getElementById('process-metadata');
    if (!container) return;
    const spreadsheetResults = (results || []).filter((item) => item.type === 'spreadsheet' && item.metadata);

    if (spreadsheetResults.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = spreadsheetResults
      .map(
        (item) => `
      <p><strong>${utils.escapeHtml(item.sourceFile)}</strong></p>
      <p>Prestador: ${utils.escapeHtml(item.metadata.prestador || '-')}</p>
      <p>Produção: ${utils.escapeHtml(item.metadata.dtPesquisaInicio || '-')} a ${utils.escapeHtml(item.metadata.dtPesquisaFim || '-')}</p>
      <p>Pagamento: ${utils.escapeHtml(item.metadata.paymentDate || '-')}</p>
    `,
      )
      .join('<hr>');
  }

  const ICON_OPEN =
    '<svg class="file-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  const ICON_DOWNLOAD =
    '<svg class="file-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  const ICON_DELETE =
    '<svg class="file-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

  let confirmDeleteResolver = null;

  function closeConfirmDeleteModal() {
    const modal = document.getElementById('confirm-delete-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.hidden = true;
    document.removeEventListener('keydown', onConfirmDeleteKeydown);
    if (confirmDeleteResolver) {
      const resolve = confirmDeleteResolver;
      confirmDeleteResolver = null;
      resolve(false);
    }
  }

  function onConfirmDeleteKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeConfirmDeleteModal();
    }
  }

  function confirmDeleteFile(fileName) {
    const modal = document.getElementById('confirm-delete-modal');
    const message = document.getElementById('confirm-delete-message');
    const confirmBtn = document.getElementById('confirm-delete-btn');
    if (!modal || !message || !confirmBtn) {
      return Promise.resolve(false);
    }

    if (confirmDeleteResolver) {
      confirmDeleteResolver(false);
      confirmDeleteResolver = null;
    }

    message.textContent = `Deseja excluir o arquivo "${fileName}"?`;
    modal.hidden = false;
    modal.classList.remove('hidden');
    document.removeEventListener('keydown', onConfirmDeleteKeydown);
    document.addEventListener('keydown', onConfirmDeleteKeydown);
    confirmBtn.focus();

    return new Promise((resolve) => {
      confirmDeleteResolver = resolve;
    });
  }

  function initConfirmDeleteModal() {
    const modal = document.getElementById('confirm-delete-modal');
    const confirmBtn = document.getElementById('confirm-delete-btn');
    if (!modal || !confirmBtn) return;

    modal.querySelectorAll('[data-confirm-dismiss]').forEach((el) => {
      el.addEventListener('click', () => closeConfirmDeleteModal());
    });

    confirmBtn.addEventListener('click', () => {
      const resolve = confirmDeleteResolver;
      confirmDeleteResolver = null;
      modal.classList.add('hidden');
      modal.hidden = true;
      document.removeEventListener('keydown', onConfirmDeleteKeydown);
      if (resolve) resolve(true);
    });
  }

  async function refreshOutputFilesTable() {
    const tbody = document.querySelector('#output-files-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    try {
      const { files } = await api.listFiles();
      for (const file of files) {
        const tr = document.createElement('tr');
        const safeName = utils.escapeHtml(file.name);
        const authorizedUrl = api.withAuthQuery(file.url);
        tr.innerHTML = `
        <td>${safeName}</td>
        <td>
          <div class="file-actions">
            <a class="file-action" href="${authorizedUrl}" target="_blank" rel="noopener">${ICON_OPEN}<span>Abrir</span></a>
            <a class="file-action file-download" href="${authorizedUrl}" download="${safeName}">${ICON_DOWNLOAD}<span>Download</span></a>
            <button type="button" class="file-action file-delete" data-delete-file="${safeName}">${ICON_DELETE}<span>Excluir</span></button>
          </div>
        </td>`;

        const deleteBtn = tr.querySelector('[data-delete-file]');
        deleteBtn.addEventListener('click', async () => {
          const confirmed = await confirmDeleteFile(file.name);
          if (!confirmed) return;
          try {
            await api.deleteFile(file.name);
            logInput(`Arquivo excluído: ${file.name}`);
            await refreshOutputFilesTable();
            window.dispatchEvent(new CustomEvent('files-updated'));
          } catch (error) {
            logInput(error.message || 'Falha ao excluir arquivo.', true);
          }
        });

        tbody.appendChild(tr);
      }
    } catch (error) {
      logInput(error.message, true);
    }
  }

  async function processSelectedFiles() {
    if (isProcessing) {
      return;
    }

    const selected = getSelectedPendingFiles();
    if (selected.length === 0) {
      throw new Error('Marque ao menos um arquivo para processar.');
    }

    setProcessingState(true);
    logInput(`Preparando ${selected.length} arquivo(s)...`);

    try {
      const payloadFiles = [];
      for (const file of selected) {
        logInput(`Lendo ${file.name}...`);
        const data = await utils.fileToBase64(file);
        payloadFiles.push({ name: file.name, data });
      }

      logInput('Enviando e processando no servidor...');
      const summary = await api.inputRun(payloadFiles);

      logInput(`Concluído: ${summary.processed} processado(s), ${summary.failed} falha(s).`);

      for (const item of summary.results || []) {
        if (item.type === 'pdf') {
          logInput(`PDF ${item.sourceFile}: ${item.extracted} extraído(s).`);
        } else {
          logInput(`Planilha ${item.sourceFile}: ${item.rowCount} linha(s).`);
        }
      }

      for (const item of summary.errors || []) {
        logInput(`${item.sourceFile}: ${item.error}`, true);
      }

      renderProcessMetadata(summary.results);
      await refreshOutputFilesTable();
      window.dispatchEvent(new CustomEvent('files-updated'));
      return summary;
    } finally {
      setProcessingState(false);
    }
  }

  function handleIncomingFiles(files) {
    try {
      addPendingFiles(files);
    } catch (error) {
      logInput(error.message, true);
    }
  }

  function initInputUi() {
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('file-drop-zone');
    const selectAll = document.getElementById('select-all-files');

    if (!fileInput || !dropZone || !selectAll) {
      console.error('Elementos da UI de arquivos não encontrados no DOM.');
      return;
    }

    utils.initDropZone(
      dropZone,
      fileInput,
      (files) => handleIncomingFiles(files),
      (error) => logInput(error.message || 'Falha ao receber arquivos.', true),
    );

    document.getElementById('btn-pick-files').addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      if (!fileInput.files?.length) {
        return;
      }
      handleIncomingFiles([...fileInput.files]);
      fileInput.value = '';
    });

    selectAll.addEventListener('change', () => {
      for (const entry of pendingFiles.values()) {
        entry.selected = selectAll.checked;
      }
      renderPendingFiles();
    });

    document.getElementById('btn-clear-files').addEventListener('click', () => {
      clearPendingFiles();
      logInput('Seleção limpa.');
    });

    document.getElementById('btn-process-selected').addEventListener('click', async () => {
      try {
        await processSelectedFiles();
      } catch (error) {
        logInput(error.message || 'Falha ao processar arquivos.', true);
        setProcessingState(false);
      }
    });

    initConfirmDeleteModal();
    refreshOutputFilesTable();
  }

  window.initInputUi = initInputUi;
  window.refreshOutputFilesTable = refreshOutputFilesTable;
})();
