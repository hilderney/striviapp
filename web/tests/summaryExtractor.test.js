const { extractSummary, MAX_SUMMARY_LENGTH } = require('../src/modules/summaryExtractor');

describe('summaryExtractor', () => {
  test('[F2-41] deve extrair campo summary se JSON LLM contiver { summary: "..." }', () => {
    const content = JSON.stringify({ summary: 'Resumo claro', data: { total: 1 } });
    expect(extractSummary(content)).toBe('Resumo claro');
  });

  test('[F2-42] deve gerar summary truncado (max 500 chars) se LLM retornar texto livre', () => {
    const longText = 'a'.repeat(600);
    const summary = extractSummary(longText);
    expect(summary.length).toBe(MAX_SUMMARY_LENGTH);
    expect(summary.endsWith('...')).toBe(true);
  });

  test('[F2-43] deve tentar parsear JSON dentro de markdown code block ```json', () => {
    const content = 'Here is the result:\n```json\n{"summary":"From markdown"}\n```';
    expect(extractSummary(content)).toBe('From markdown');
  });
});
