export type ServiceError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  name?: string;
};

function hasStringProperty(value: unknown, key: string): value is Record<string, string> {
  return typeof value === "object" && value !== null && key in value && typeof (value as Record<string, unknown>)[key] === "string";
}

export function normalizeServiceError(error: unknown): ServiceError | null {
  if (!error) return null;

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name
    };
  }

  if (hasStringProperty(error, "message")) {
    return {
      message: error.message,
      code: hasStringProperty(error, "code") ? error.code : undefined,
      details: hasStringProperty(error, "details") ? error.details : undefined,
      hint: hasStringProperty(error, "hint") ? error.hint : undefined,
      name: hasStringProperty(error, "name") ? error.name : undefined
    };
  }

  return {
    message: String(error)
  };
}
