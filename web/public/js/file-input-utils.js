(function (global) {
  'use strict';

  const INPUT_ACCEPT =
    '.pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

  const EXCEL_MIME_TYPES = new Set([
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/excel',
    'application/x-excel',
    'application/x-msexcel',
    'text/csv',
    'application/octet-stream',
  ]);

  function getFileName(fileOrName) {
    if (!fileOrName) {
      return '';
    }
    if (typeof fileOrName === 'string') {
      return fileOrName;
    }
    return fileOrName.name || '';
  }

  function isAllowedInputFile(fileOrName) {
    const name = getFileName(fileOrName);
    if (/\.(pdf|xlsx|xls)$/i.test(name)) {
      return true;
    }

    // Fallback por MIME quando o SO não expõe extensão no drop (raro no Windows)
    const mime = typeof fileOrName === 'object' ? String(fileOrName.type || '').toLowerCase() : '';
    if (!mime) {
      return false;
    }
    if (mime === 'application/pdf') {
      return true;
    }
    return EXCEL_MIME_TYPES.has(mime);
  }

  function getInputFileType(fileOrName) {
    const name = getFileName(fileOrName);
    if (/\.pdf$/i.test(name)) {
      return 'pdf';
    }
    if (/\.(xlsx|xls)$/i.test(name)) {
      return 'spreadsheet';
    }

    const mime = typeof fileOrName === 'object' ? String(fileOrName.type || '').toLowerCase() : '';
    if (mime === 'application/pdf') {
      return 'pdf';
    }
    if (EXCEL_MIME_TYPES.has(mime)) {
      return 'spreadsheet';
    }
    return null;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error(`Falha ao ler ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async function traverseEntry(entry, files, filterFn) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => {
        entry.file(resolve, reject);
      });
      if (filterFn(file)) {
        files.push(file);
      }
      return;
    }

    if (!entry.isDirectory) {
      return;
    }

    const reader = entry.createReader();
    const readBatch = () =>
      new Promise((resolve, reject) => {
        reader.readEntries(async (entries) => {
          if (!entries.length) {
            resolve();
            return;
          }
          try {
            await Promise.all(entries.map((child) => traverseEntry(child, files, filterFn)));
            await readBatch();
            resolve();
          } catch (error) {
            reject(error);
          }
        }, reject);
      });

    await readBatch();
  }

  async function collectFilesFromDataTransfer(dataTransfer, filterFn = isAllowedInputFile) {
    const files = [];
    const items = dataTransfer?.items;

    if (items?.length) {
      const entries = [];
      for (const item of items) {
        if (item.kind === 'file' && item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            entries.push(entry);
          }
        }
      }

      if (entries.length) {
        await Promise.all(entries.map((entry) => traverseEntry(entry, files, filterFn)));
        if (files.length) {
          return files;
        }
      }
    }

    return [...(dataTransfer?.files || [])].filter((file) => filterFn(file));
  }

  function initDropZone(dropZone, fileInput, onFiles, onError) {
    let dragDepth = 0;

    const reportError = (error) => {
      if (typeof onError === 'function') {
        onError(error);
      }
    };

    const setActive = (active) => {
      dropZone.classList.toggle('drop-zone--active', active);
    };

    const setUploading = (uploading) => {
      dropZone.classList.toggle('drop-zone--uploading', uploading);
    };

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
        if (eventName === 'dragenter') {
          dragDepth += 1;
        }
        setActive(true);
      });
    });

    dropZone.addEventListener('dragleave', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepth -= 1;
      if (dragDepth <= 0) {
        dragDepth = 0;
        setActive(false);
      }
    });

    dropZone.addEventListener('drop', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepth = 0;
      setActive(false);

      try {
        const files = await collectFilesFromDataTransfer(event.dataTransfer);
        if (!files.length) {
          const rawNames = [...(event.dataTransfer?.files || [])].map((f) => f.name).join(', ');
          throw new Error(
            rawNames
              ? `Arquivo(s) não reconhecido(s): ${rawNames}. Use .pdf, .xlsx ou .xls.`
              : 'Nenhum PDF ou planilha (.xlsx/.xls) recebido.',
          );
        }
        setUploading(true);
        await onFiles(files);
      } catch (error) {
        reportError(error);
      } finally {
        setUploading(false);
      }
    });

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
  }

  global.fileInputUtils = {
    INPUT_ACCEPT,
    isAllowedInputFile,
    getInputFileType,
    formatFileSize,
    escapeHtml,
    arrayBufferToBase64,
    fileToBase64,
    collectFilesFromDataTransfer,
    initDropZone,
  };
})(window);
