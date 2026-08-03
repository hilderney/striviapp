function toModelDto(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id ?? row.userId ?? null,
    name: row.name,
    provider: row.provider,
    modelId: row.model_id ?? row.modelId,
    baseUrl: row.base_url ?? row.baseUrl ?? null,
    hasToken: Boolean(row.token_encrypted ?? row.tokenEncrypted),
    isDefault: Boolean(row.is_default ?? row.isDefault),
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

function toJobDto(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id ?? row.userId ?? null,
    llmModelId: row.llm_model_id ?? row.llmModelId,
    sourceFile: row.source_file ?? row.sourceFile,
    sourceType: row.source_type ?? row.sourceType,
    promptTemplate: row.prompt_template ?? row.promptTemplate ?? null,
    status: row.status,
    responseFile: row.response_file ?? row.responseFile ?? null,
    summary: row.summary ?? null,
    errorMessage: row.error_message ?? row.errorMessage ?? null,
    createdAt: row.created_at ?? row.createdAt,
    completedAt: row.completed_at ?? row.completedAt ?? null,
  };
}

function toUserDto(row) {
  if (!row) {
    return null;
  }

  const status = row.subscription_status ?? row.subscriptionStatus ?? 'none';
  const expiresAt = row.subscription_expires_at ?? row.subscriptionExpiresAt ?? null;
  const plan = row.subscription_plan ?? row.subscriptionPlan ?? null;

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    totpEnabled: Boolean(row.totp_enabled ?? row.totpEnabled),
    subscriptionStatus: status,
    subscriptionExpiresAt: expiresAt,
    subscriptionPlan: plan,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  toModelDto,
  toJobDto,
  toUserDto,
  nowIso,
};
