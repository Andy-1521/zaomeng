export function toUserFacingErrorMessage(message: string | undefined, fallbackMessage: string) {
  if (!message) return fallbackMessage;

  const trimmed = message.trim();
  if (!trimmed) return fallbackMessage;
  if (/504|timeout|超时/i.test(trimmed)) {
    return '处理时间较长，请稍后重试';
  }
  if (/api|model|upstream|gateway|502|503|504|ETIMEDOUT|AbortError/i.test(trimmed)) {
    return fallbackMessage;
  }

  return trimmed;
}

export function toUserFacingErrorFromUnknown(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : '';
  return toUserFacingErrorMessage(message, fallbackMessage);
}
