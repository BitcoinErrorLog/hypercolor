import {
  finishConnectDelegation,
  resetConnectDelegationForTests,
  tryBeginConnectDelegation,
} from '../connectDelegationStart';

describe('connectDelegationStart', () => {
  beforeEach(() => {
    resetConnectDelegationForTests();
  });

  it('does not let Welcome focus release an in-flight Awaiting token', () => {
    const awaitingToken = tryBeginConnectDelegation();
    expect(awaitingToken).not.toBeNull();
    expect(tryBeginConnectDelegation()).toBeNull();
    finishConnectDelegation(-1);
    expect(tryBeginConnectDelegation()).toBeNull();
    finishConnectDelegation(awaitingToken as number);
    expect(tryBeginConnectDelegation()).not.toBeNull();
  });

  it("does not let Awaiting finally release Welcome's later token", () => {
    const awaitingToken = tryBeginConnectDelegation();
    finishConnectDelegation(awaitingToken as number);
    const welcomeToken = tryBeginConnectDelegation();
    expect(welcomeToken).not.toBeNull();
    finishConnectDelegation(awaitingToken as number);
    expect(tryBeginConnectDelegation()).toBeNull();
    finishConnectDelegation(welcomeToken as number);
    expect(tryBeginConnectDelegation()).not.toBeNull();
  });
});
