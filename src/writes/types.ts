export const writeOperations = [
  "contact.change",
  "opportunity.change",
  "quotation.create",
  "quotation.update",
] as const;

export type WriteOperation = (typeof writeOperations)[number];

export interface NormalizedWrite {
  targetId?: number;
  changes: Record<string, unknown>;
}

export interface WriteUpstream {
  read(
    operation: WriteOperation,
    targetId: number,
  ): Promise<Record<string, unknown> | null>;
  write(operation: WriteOperation, change: NormalizedWrite): Promise<unknown>;
}

export interface WriteReceipt {
  [key: string]: unknown;
  status: "succeeded";
  operation: WriteOperation;
  idempotencyKey: string;
}
