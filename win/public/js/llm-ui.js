const SUPPORTED_SOURCE = /\.(txt|csv|xlsx)$/i;

function fillModelSelects(models) {
  const selects = [
    document.getElementById('llm-model-select'),
  ];

  for (const select of selects) {
    const current = select.value;
    select.innerHTML = '<option value="">Selecione...</option>';
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.name} (${model.provider})`;
      if (model.isDefault) {
        option.selected = true;
      }
      select.appendChild(option);
    }
    if (current) {
      select.value = current;
    }
  }
}

async function refreshSourceFiles() {
  const select = document.getElementById('source-file-select');
  select.innerHTML = '<option value="">Selecione...</option>';

  const { files } = await api.listFiles();
  for (const file of files) {
    if (!SUPPORTED_SOURCE.test(file.name)) {
      continue;
    }
    const option = document.createElement('option');
    option.value = file.name;
    option.textContent = file.name;
    select.appendChild(option);
  }
}

function resetModelForm() {
  document.getElementById('model-id').value = '';
  document.getElementById('model-form').reset();
  updateTokenFieldHint(null);
}

function formatTokenStatus(model) {
  if (model.provider !== 'openrouter') {
    return '—';
  }
  if (model.hasToken) {
    return '<span class="token-badge token-ok" title="Token criptografado no banco">Configurado ✓</span>';
  }
  return '<span class="token-badge token-missing">Pendente</span>';
}

function updateTokenFieldHint(model) {
  const hint = document.getElementById('model-token-hint');
  if (!hint) {
    return;
  }

  if (!model) {
    hint.textContent = '';
    hint.hidden = true;
    return;
  }

  if (model.provider !== 'openrouter') {
    hint.textContent = 'Ollama não usa token.';
    hint.hidden = false;
    return;
  }

  if (model.hasToken) {
    hint.textContent =
      'Token salvo (não exibido por segurança). Deixe em branco para manter ou preencha para substituir.';
  } else {
    hint.textContent = 'Informe o token OpenRouter para salvar.';
  }
  hint.hidden = false;
}

function describeHealthCheckFailure(result, model) {
  if (result.code === 'TOKEN_DECRYPT_FAILED') {
    return (
      'O token está salvo, mas não pôde ser lido.\n\n' +
      'Isso costuma ocorrer quando APP_SECRET_KEY não está definida no .env ' +
      'e o servidor gerou uma chave temporária ao reiniciar.\n\n' +
      'Solução: defina APP_SECRET_KEY no .env (veja .env.example) e informe o token novamente em Editar.'
    );
  }

  if (result.ok) {
    return 'Conexão OK';
  }

  if (model?.provider === 'openrouter' && model.hasToken) {
    return (
      'Falha na conexão com o token salvo.\n\n' +
      'Verifique se o token ainda é válido no OpenRouter ou informe um novo token em Editar.'
    );
  }

  return 'Falha na conexão';
}

function describeProcessError(error) {
  if (error.payload?.code === 'TOKEN_DECRYPT_FAILED' || /não pôde ser lido/i.test(error.message)) {
    return (
      'Erro: token salvo não pôde ser lido. Defina APP_SECRET_KEY no .env ' +
      'e informe o token novamente em Modelos LLM → Editar.'
    );
  }
  return `Erro: ${error.message}`;
}

async function refreshModelsTable() {
  const tbody = document.querySelector('#models-table tbody');
  tbody.innerHTML = '';

  const { models } = await api.listModels();
  fillModelSelects(models);

  for (const model of models) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${model.name}${model.isDefault ? ' ★' : ''}</td>
      <td>${model.provider}</td>
      <td>${model.modelId}</td>
      <td>${formatTokenStatus(model)}</td>
      <td>
        <button type="button" data-edit="${model.id}">Editar</button>
        <button type="button" data-health="${model.id}">Testar</button>
        <button type="button" data-delete="${model.id}">Excluir</button>
      </td>`;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const model = models.find((item) => item.id === btn.dataset.edit);
      if (!model) return;
      document.getElementById('model-id').value = model.id;
      document.getElementById('model-name').value = model.name;
      document.getElementById('model-provider').value = model.provider;
      document.getElementById('model-model-id').value = model.modelId;
      document.getElementById('model-base-url').value = model.baseUrl || '';
      document.getElementById('model-default').checked = model.isDefault;
      document.getElementById('model-token').value = '';
      updateTokenFieldHint(model);
    });
  });

  tbody.querySelectorAll('[data-health]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const model = models.find((item) => item.id === btn.dataset.health);
      try {
        const result = await api.healthCheck(btn.dataset.health);
        alert(describeHealthCheckFailure(result, model));
      } catch (error) {
        alert(describeProcessError(error));
      }
    });
  });

  tbody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir este modelo?')) return;
      try {
        await api.deleteModel(btn.dataset.delete);
        await refreshModelsTable();
      } catch (error) {
        alert(`Erro: ${error.message}`);
      }
    });
  });
}

function initLlmUi() {
  document.getElementById('model-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      name: document.getElementById('model-name').value.trim(),
      provider: document.getElementById('model-provider').value,
      modelId: document.getElementById('model-model-id').value.trim(),
      baseUrl: document.getElementById('model-base-url').value.trim() || null,
      isDefault: document.getElementById('model-default').checked,
    };

    const token = document.getElementById('model-token').value.trim();
    if (token) {
      payload.token = token;
    }

    const id = document.getElementById('model-id').value;
    try {
      if (id) {
        await api.updateModel(id, payload);
      } else {
        await api.createModel(payload);
      }
      resetModelForm();
      await refreshModelsTable();
    } catch (error) {
      alert(`Erro: ${error.message}`);
    }
  });

  document.getElementById('btn-reset-model').addEventListener('click', resetModelForm);

  document.getElementById('model-provider').addEventListener('change', () => {
    const id = document.getElementById('model-id').value;
    if (!id) {
      updateTokenFieldHint({
        provider: document.getElementById('model-provider').value,
        hasToken: false,
      });
    }
  });

  document.getElementById('btn-process').addEventListener('click', async () => {
    const llmModelId = document.getElementById('llm-model-select').value;
    const sourceFile = document.getElementById('source-file-select').value;
    const promptTemplate = document.getElementById('prompt-template').value.trim();

    if (!llmModelId || !sourceFile) {
      alert('Selecione modelo e arquivo.');
      return;
    }

    const summaryEl = document.getElementById('llm-summary');
    const linkEl = document.getElementById('llm-response-link');
    summaryEl.textContent = 'Processando...';
    linkEl.textContent = '';

    try {
      const result = await api.processLlm({
        llmModelId,
        sourceFile,
        promptTemplate: promptTemplate || undefined,
      });

      summaryEl.textContent = result.summary || '(sem resumo)';
      linkEl.href = result.responseUrl ? api.withAuthQuery(result.responseUrl) : '#';
      linkEl.textContent = result.responseUrl ? 'Abrir resposta JSON' : '';
      await refreshOutputFilesTable();
    } catch (error) {
      summaryEl.textContent = describeProcessError(error);
      summaryEl.className = 'summary card error';
    }
  });

  window.addEventListener('files-updated', refreshSourceFiles);
  refreshModelsTable();
  refreshSourceFiles();
}

window.initLlmUi = initLlmUi;
