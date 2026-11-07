import { TRANSACTION_STATUS } from "@/utils/constants";
import logger from "@/logger";

//  pending → processing 
//  pending → success 
//  pending → failed 
//  pending → reversed 
//  processing → success 
//  processing → failed 
//  processing → reversed 
//  success → (terminal, no transitions) 
//  failed → (terminal, no transitions) 
//  reversed → (terminal, no transitions) 
export class TransactionStateValidator {
  private readonly VALID_TRANSITIONS: Record<string, string[]> = {
    [TRANSACTION_STATUS.PENDING]: [
      TRANSACTION_STATUS.PROCESSING,
      TRANSACTION_STATUS.SUCCESS,
      TRANSACTION_STATUS.FAILED,
      TRANSACTION_STATUS.REVERSED,
    ],
    [TRANSACTION_STATUS.PROCESSING]: [
      TRANSACTION_STATUS.SUCCESS,
      TRANSACTION_STATUS.FAILED,
      TRANSACTION_STATUS.REVERSED,
    ],
    // Terminal states - no transitions allowed from these
    [TRANSACTION_STATUS.SUCCESS]: [],
    [TRANSACTION_STATUS.FAILED]: [],
    [TRANSACTION_STATUS.REVERSED]: [],
  };

  // Check if transition is valid

  validateTransition(
    fromStatus: string,
    toStatus: string,
  ): { isValid: boolean; error?: string } {
    // Same state - allow (idempotent)
    if (fromStatus === toStatus) {
      return { isValid: true };
    }

    // Check if transition exists in valid transitions
    const allowedTransitions = this.VALID_TRANSITIONS[fromStatus];

    if (!allowedTransitions) {
      return {
        isValid: false,
        error: `Unknown transaction status: "${fromStatus}"`,
      };
    }

    if (!allowedTransitions.includes(toStatus)) {
      return {
        isValid: false,
        error: `Invalid state transition: ${fromStatus} → ${toStatus}. Allowed transitions: ${allowedTransitions.join(", ") || "(none - terminal state)"}`,
      };
    }

    return { isValid: true };
  }

  // Assert transition is valid, throw if not

  assertValidTransition(fromStatus: string, toStatus: string): void {
    const result = this.validateTransition(fromStatus, toStatus);
    if (!result.isValid) {
      logger.error("Invalid transaction state transition attempted", {
        from: fromStatus,
        to: toStatus,
        error: result.error,
      });
      throw new Error(result.error);
    }
  }

   // Check if status is a terminal state (no further transitions allowed)
 
  isTerminalState(status: string): boolean {
    return this.VALID_TRANSITIONS[status]?.length === 0;
  }

   // Get allowed next states for current status
 
  getAllowedTransitions(status: string): string[] {
    return this.VALID_TRANSITIONS[status] || [];
  }

   // Check if transaction is in a final/completed state

  isCompleted(status: "success" | "failed" | "reversed"): boolean {
    return [
      TRANSACTION_STATUS.SUCCESS,
      TRANSACTION_STATUS.FAILED,
      TRANSACTION_STATUS.REVERSED,
    ].includes(status);
  }

   // Get human-readable transition validation message
  getValidationMessage(fromStatus: string, toStatus: string): string {
    const result = this.validateTransition(fromStatus, toStatus);

    if (result.isValid) {
      return `Transition ${fromStatus} → ${toStatus} is valid`;
    }

    return result.error || "Invalid transition";
  }
}

// Singleton instance
let validatorInstance: TransactionStateValidator | null = null;

export function getTransactionStateValidator(): TransactionStateValidator {
  if (!validatorInstance) {
    validatorInstance = new TransactionStateValidator();
  }
  return validatorInstance;
}
