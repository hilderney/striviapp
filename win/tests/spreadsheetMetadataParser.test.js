const path = require('path');
const {
  deriveSpreadsheetMetadata,
  parseAtendimentoDate,
  modeValue,
} = require('../src/modules/spreadsheetMetadataParser');

describe('spreadsheetMetadataParser', () => {
  const sampleRows = [
    {
      local_exec: 'CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA',
      atendimento: '09/06/2026',
    },
    {
      local_exec: 'CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA',
      atendimento: '10/06/2026',
    },
    {
      local_exec: 'OUTRO LOCAL',
      atendimento: '08/06/2026',
    },
  ];

  test('[F3-22] deve extrair prestador como moda de Local exec', () => {
    const metadata = deriveSpreadsheetMetadata(sampleRows);
    expect(metadata.prestador).toBe('CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA');
  });

  test('[F3-23] deve calcular dtPesquisaInicio como data mínima de Atendimento', () => {
    const metadata = deriveSpreadsheetMetadata(sampleRows);
    expect(metadata.dtPesquisaInicio).toBe('08/06/2026');
  });

  test('[F3-24] deve calcular dtPesquisaFim como data máxima de Atendimento', () => {
    const metadata = deriveSpreadsheetMetadata(sampleRows);
    expect(metadata.dtPesquisaFim).toBe('10/06/2026');
  });

  test('[F3-25] deve calcular paymentDate como dia 5 do mês seguinte ao fim', () => {
    const metadata = deriveSpreadsheetMetadata(sampleRows);
    expect(metadata.paymentDate).toBe('05/07/2026');
  });

  test('[F3-26] deve montar paymentLine no formato UNIMED padrão', () => {
    const metadata = deriveSpreadsheetMetadata(sampleRows);
    expect(metadata.paymentLine).toContain('UNIMED - 1º PGTO PROGRAMADO PARA 05/07/2026');
    expect(metadata.paymentLine).toContain('PRODUÇÃO : 08/06/2026 A 10/06/2026');
  });

  test('[F3-27] deve retornar campos vazios para array de rows vazio', () => {
    const metadata = deriveSpreadsheetMetadata([]);
    expect(metadata).toEqual({
      prestador: '',
      dtPesquisaInicio: '',
      dtPesquisaFim: '',
      paymentDate: '',
      paymentLine: '',
    });
  });

  test('[F3-28] deve parsear datas DD/MM/YYYY corretamente', () => {
    const parsed = parseAtendimentoDate('19/06/2026');
    expect(parsed).toEqual({
      day: 19,
      month: 6,
      year: 2026,
      sortKey: 20260619,
    });
  });

  test('modeValue retorna valor mais frequente', () => {
    expect(modeValue(['A', 'A', 'B'])).toBe('A');
  });
});
