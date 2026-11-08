import test from 'node:test';
import assert from 'node:assert/strict';
import { homeDebtFreeEstimateDate } from '../src/onboarding-domain.ts';

test('Home estimate keeps the payoff date and removes only the entered-debt qualifier', () => {
  assert.equal(homeDebtFreeEstimateDate('Entered debts projected paid off: Oct 2028'), 'Oct 2028');
  assert.equal(homeDebtFreeEstimateDate('Add accounts to estimate payoff'), 'Add accounts to estimate payoff');
});
