const MAX_SUMMARY_LENGTH = 500;

function extractJsonFromMarkdown(content) {
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function extractSummary(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const trimmed = content.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.summary === 'string' && parsed.summary.trim()) {
      return truncateSummary(parsed.summary.trim());
    }
  } catch {
    // not raw JSON
  }

  const fromMarkdown = extractJsonFromMarkdown(trimmed);
  if (fromMarkdown && typeof fromMarkdown.summary === 'string' && fromMarkdown.summary.trim()) {
    return truncateSummary(fromMarkdown.summary.trim());
  }

  return truncateSummary(trimmed);
}

function truncateSummary(text) {
  if (text.length <= MAX_SUMMARY_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_SUMMARY_LENGTH - 3)}...`;
}

function parseStructuredData(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fromMarkdown = extractJsonFromMarkdown(trimmed);
    return fromMarkdown;
  }
}

module.exports = {
  extractSummary,
  parseStructuredData,
  truncateSummary,
  MAX_SUMMARY_LENGTH,
};
