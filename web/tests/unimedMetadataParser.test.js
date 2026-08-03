const {
  parseUnimedMetadata,
  buildPaymentLine,
  calculatePaymentDate,
} = require('../src/modules/unimedMetadataParser');

const SAMPLE_HEADER =
  'Prestador CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA Tipo guia: Guia de solicitação SP/SADT Dt pesquisa: 20/05/2026 a 05/06/2026';

describe('unimedMetadataParser', () => {
  test('extrai prestador e Dt pesquisa', () => {
    const metadata = parseUnimedMetadata(SAMPLE_HEADER);

    expect(metadata.prestador).toBe('CLINICA ARARA AZUL - CONSULTORIO DE PSICOLOGIA');
    expect(metadata.dtPesquisaInicio).toBe('20/05/2026');
    expect(metadata.dtPesquisaFim).toBe('05/06/2026');
  });

  test('calcula pagamento no dia 5 do mês seguinte', () => {
    expect(calculatePaymentDate('05/06/2026')).toBe('05/07/2026');
    expect(calculatePaymentDate('15/11/2026')).toBe('05/12/2026');
  });

  test('dezembro avança para janeiro do ano seguinte', () => {
    expect(calculatePaymentDate('10/12/2026')).toBe('05/01/2027');
  });

  test('monta linha de pagamento e produção', () => {
    const metadata = parseUnimedMetadata(SAMPLE_HEADER);

    expect(metadata.paymentLine).toBe(
      'UNIMED - 1º PGTO PROGRAMADO PARA 05/07/2026 - - - - - - - - PRODUÇÃO : 20/05/2026 A 05/06/2026.',
    );
    expect(buildPaymentLine(metadata)).toBe(metadata.paymentLine);
  });

  test('retorna vazio quando PDF não contém metadados', () => {
    const metadata = parseUnimedMetadata('texto sem prestador');

    expect(metadata.prestador).toBe('');
    expect(metadata.paymentLine).toBe('');
  });
});
