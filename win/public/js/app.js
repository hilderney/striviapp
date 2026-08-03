document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// As abas só são inicializadas depois do login (evita chamadas 401 no boot).
function bootstrapAppModules() {
  if (typeof window.initInputUi === 'function') {
    window.initInputUi();
  } else {
    console.error('initInputUi não definido — verifique /js/input-ui.js e /js/file-input-utils.js');
  }

  if (typeof window.initLlmUi === 'function') {
    window.initLlmUi();
  } else {
    console.error('initLlmUi não definido — verifique /js/llm-ui.js');
  }

  if (typeof window.initLogsUi === 'function') {
    window.initLogsUi();
  } else {
    console.error('initLogsUi não definido — verifique /js/logs-ui.js');
  }
}

if (typeof window.initAuthUi === 'function') {
  window.initAuthUi({ onAuthenticated: bootstrapAppModules });
} else {
  console.error('initAuthUi não definido — verifique /js/auth-ui.js');
}
