export interface BudgetItemForCalculation {
  estimatedAmount: number;
  actualAmount?: number | null;
  paidAmount?: number | null;
}
export interface BudgetSummary {
  estimatedTotal: number;
  actualOrEstimatedTotal: number;
  paidTotal: number;
  remainingToPay: number;
  varianceFromEstimate: number;
  overEstimateBy: number;
}

function validCurrency(value: number | null | undefined, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative amount.`);
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function currency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateBudget(items: readonly BudgetItemForCalculation[]): BudgetSummary {
  let estimatedTotal = 0;
  let actualOrEstimatedTotal = 0;
  let paidTotal = 0;

  for (const item of items) {
    const estimated = validCurrency(item.estimatedAmount, "Estimated amount") ?? 0;
    const actual = validCurrency(item.actualAmount, "Actual amount");
    const paid = validCurrency(item.paidAmount, "Paid amount") ?? 0;
    estimatedTotal += estimated;
    actualOrEstimatedTotal += actual ?? estimated;
    paidTotal += paid;
  }

  const remaining = Math.max(0, actualOrEstimatedTotal - paidTotal);
  const variance = actualOrEstimatedTotal - estimatedTotal;

  return {
    estimatedTotal: currency(estimatedTotal),
    actualOrEstimatedTotal: currency(actualOrEstimatedTotal),
    paidTotal: currency(paidTotal),
    remainingToPay: currency(remaining),
    varianceFromEstimate: currency(variance),
    overEstimateBy: currency(Math.max(0, variance)),
  };
}
