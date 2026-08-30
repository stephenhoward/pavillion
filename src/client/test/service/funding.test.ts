import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { createPinia, setActivePinia } from 'pinia';
import FundingService, { fundingGateDenial } from '@/client/service/funding';
import type { FundingPlanStatus } from '@/client/service/funding';
import { useFundingStore } from '@/client/stores/fundingStore';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';

vi.mock('axios');

describe('FundingService.listGrants', () => {
  const service = new FundingService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call GET /api/funding/v1/admin/grants without includeRevoked parameter by default', async () => {
    // Arrange
    const mockGrants = [
      { id: 'grant1', accountId: 'acc1', reason: 'VIP', grantedBy: 'admin1', expiresAt: null, revokedAt: null, revokedBy: null },
      { id: 'grant2', accountId: 'acc2', reason: null, grantedBy: 'admin1', expiresAt: null, revokedAt: null, revokedBy: null },
    ];
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: mockGrants });

    // Act
    const result = await service.listGrants();

    // Assert
    expect(axiosGet).toHaveBeenCalledWith('/api/funding/v1/admin/grants', { params: { includeRevoked: false } });
    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(ComplimentaryGrant);
    expect(result[0].id).toBe('grant1');
    expect(result[0].accountId).toBe('acc1');
  });

  it('should call GET with includeRevoked=true when requested', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: [] });

    // Act
    await service.listGrants(true);

    // Assert
    expect(axiosGet).toHaveBeenCalledWith('/api/funding/v1/admin/grants', { params: { includeRevoked: true } });
  });

  it('should call GET with includeRevoked=false when explicitly passed false', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: [] });

    // Act
    await service.listGrants(false);

    // Assert
    expect(axiosGet).toHaveBeenCalledWith('/api/funding/v1/admin/grants', { params: { includeRevoked: false } });
  });

  it('should return an empty array when no grants exist', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: [] });

    // Act
    const result = await service.listGrants();

    // Assert
    expect(result).toEqual([]);
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockRejectedValue(new Error('Network error'));

    // Act & Assert
    await expect(service.listGrants()).rejects.toThrow('Network error');
  });
});

describe('FundingService.createGrant', () => {
  const service = new FundingService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call POST /api/funding/v1/admin/grants with accountId', async () => {
    // Arrange
    const accountId = 'acc123';
    const grantData = { id: 'grant1', accountId, reason: null, grantedBy: 'admin1', expiresAt: null, revokedAt: null, revokedBy: null };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ data: grantData });

    // Act
    const result = await service.createGrant(accountId);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/funding/v1/admin/grants', {
      accountId,
      reason: undefined,
      expiresAt: undefined,
      calendarId: undefined,
    });
    expect(result).toBeInstanceOf(ComplimentaryGrant);
    expect(result.id).toBe('grant1');
    expect(result.accountId).toBe(accountId);
  });

  it('should include reason and expiresAt when provided', async () => {
    // Arrange
    const accountId = 'acc123';
    const reason = 'VIP member';
    const expiresAt = new Date('2027-01-01T00:00:00.000Z');
    const grantData = { id: 'grant1', accountId, reason, grantedBy: 'admin1', expiresAt: expiresAt.toISOString(), revokedAt: null, revokedBy: null };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ data: grantData });

    // Act
    const result = await service.createGrant(accountId, reason, expiresAt);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/funding/v1/admin/grants', {
      accountId,
      reason,
      expiresAt,
      calendarId: undefined,
    });
    expect(result).toBeInstanceOf(ComplimentaryGrant);
    expect(result.reason).toBe(reason);
  });

  it('should include calendarId when provided', async () => {
    // Arrange
    const accountId = 'acc123';
    const calendarId = 'cal456';
    const grantData = { id: 'grant1', accountId, reason: null, grantedBy: 'admin1', calendarId, expiresAt: null, revokedAt: null, revokedBy: null };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ data: grantData });

    // Act
    const result = await service.createGrant(accountId, undefined, undefined, calendarId);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/funding/v1/admin/grants', {
      accountId,
      reason: undefined,
      expiresAt: undefined,
      calendarId,
    });
    expect(result).toBeInstanceOf(ComplimentaryGrant);
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockRejectedValue(new Error('API error'));

    // Act & Assert
    await expect(service.createGrant('acc123')).rejects.toThrow('API error');
  });
});

describe('FundingService.revokeGrant', () => {
  const service = new FundingService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call DELETE /api/funding/v1/admin/grants/{grantId}', async () => {
    // Arrange
    const grantId = 'grant123';
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockResolvedValue({ status: 204 });

    // Act
    await service.revokeGrant(grantId);

    // Assert
    expect(axiosDelete).toHaveBeenCalledWith(`/api/funding/v1/admin/grants/${grantId}`);
  });

  it('should return void on success', async () => {
    // Arrange
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockResolvedValue({ status: 204 });

    // Act
    const result = await service.revokeGrant('grant123');

    // Assert
    expect(result).toBeUndefined();
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockRejectedValue(new Error('Not found'));

    // Act & Assert
    await expect(service.revokeGrant('grant123')).rejects.toThrow('Not found');
  });
});

describe('FundingService.addCalendarToFundingPlan', () => {
  const service = new FundingService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call POST /api/funding/v1/calendars with calendarId and amount', async () => {
    // Arrange
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ status: 200 });

    // Act
    await service.addCalendarToFundingPlan('cal123', 500);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/funding/v1/calendars', {
      calendarId: 'cal123',
      amount: 500,
    });
  });

  it('should return void on success', async () => {
    // Arrange
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ status: 200 });

    // Act
    const result = await service.addCalendarToFundingPlan('cal123', 1000);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockRejectedValue(new Error('Failed'));

    // Act & Assert
    await expect(service.addCalendarToFundingPlan('cal123', 500)).rejects.toThrow('Failed');
  });
});

describe('FundingService.removeCalendarFromFundingPlan', () => {
  const service = new FundingService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call DELETE /api/funding/v1/calendars/:calendarId', async () => {
    // Arrange
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockResolvedValue({ status: 204 });

    // Act
    await service.removeCalendarFromFundingPlan('cal123');

    // Assert
    expect(axiosDelete).toHaveBeenCalledWith('/api/funding/v1/calendars/cal123');
  });

  it('should return void on success', async () => {
    // Arrange
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockResolvedValue({ status: 204 });

    // Act
    const result = await service.removeCalendarFromFundingPlan('cal123');

    // Assert
    expect(result).toBeUndefined();
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockRejectedValue(new Error('Not found'));

    // Act & Assert
    await expect(service.removeCalendarFromFundingPlan('cal123')).rejects.toThrow('Not found');
  });
});

describe('FundingService.getFundingStatus', () => {
  const service = new FundingService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call GET /api/funding/v1/calendars/:calendarId/funding', async () => {
    // Arrange
    const mockSummary = {
      status: 'covered',
      features: { widget_embedding: true },
    };
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: mockSummary });

    // Act
    const result = await service.getFundingStatus('cal123');

    // Assert
    expect(axiosGet).toHaveBeenCalledWith('/api/funding/v1/calendars/cal123/funding');
    expect(result).toEqual(mockSummary);
  });

  it('should return not_covered status', async () => {
    // Arrange
    const mockSummary = {
      status: 'not_covered',
      features: { widget_embedding: false },
    };
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: mockSummary });

    // Act
    const result = await service.getFundingStatus('cal456');

    // Assert
    expect(result.status).toBe('not_covered');
  });

  it('should return the feature decisions alongside a grant status', async () => {
    // The gate answer travels in `features`; `status` only names the
    // relationship. A consumer reading one without the other is guessing.
    const mockSummary = {
      status: 'grant',
      features: { widget_embedding: true },
    };
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: mockSummary });

    // Act
    const result = await service.getFundingStatus('cal789');

    // Assert
    expect(result.status).toBe('grant');
    expect(result.features).toEqual({ widget_embedding: true });
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockRejectedValue(new Error('Server error'));

    // Act & Assert
    await expect(service.getFundingStatus('cal123')).rejects.toThrow('Server error');
  });
});

describe('FundingService.getStatus', () => {
  const service = new FundingService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The exact body GET /api/funding/v1/status sends, keyed as the endpoint
   * keys it (src/server/funding/api/v1/funding-plan.ts), annotated with the
   * type the client declares for it.
   *
   * The annotation is the assertion. getStatus is a passthrough — it returns
   * `response.data` untouched — so a runtime check that the keys survive it
   * would only prove an identity function works, with the mock defining both
   * sides. What can actually go wrong is the type drifting from the wire, which
   * is precisely what happened: this type named its fields in snake_case for
   * long enough that the plan screen rendered "Invalid Date" for every date and
   * resolved no billing-cycle label at all. That is a compile-time mismatch,
   * and this is where it fails.
   *
   * The two runtime halves of the same contract are covered where they are
   * real: the server's field set by the allowlist test in
   * src/server/funding/test/api/v1/funding-plan.test.ts, and the component's
   * reads by src/client/test/components/funding-plan-cancellation.test.ts.
   */
  const wireStatus: FundingPlanStatus = {
    id: 'plan-1',
    status: 'active',
    billingCycle: 'monthly',
    amount: 1000000,
    currency: 'USD',
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    cancelledAt: null,
    cancelAt: '2026-02-01T00:00:00.000Z',
    suspendedAt: null,
  };

  it('should request the account status endpoint', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: wireStatus });

    await service.getStatus();

    expect(vi.mocked(axios.get)).toHaveBeenCalledWith('/api/funding/v1/status');
  });

  it('should answer null rather than throwing when the account has no plan', async () => {
    vi.mocked(axios.get).mockRejectedValue({ response: { status: 404 } });

    await expect(service.getStatus()).resolves.toBeNull();
  });
});

describe('FundingService.loadFundingSummary', () => {
  const service = new FundingService();

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should cache the summary in the funding store', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({
      data: {
        status: 'covered',
        features: { widget_embedding: true },
      },
    });

    // Act
    const result = await service.loadFundingSummary('cal123');

    // Assert
    const store = useFundingStore();
    expect(result.status).toBe('covered');
    expect(store.statusFor('cal123')).toBe('covered');
    expect(store.featureAccess('cal123', 'widget_embedding')).toBe(true);
  });

  it('should leave the cache untouched when the read fails', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockRejectedValue(new Error('Server error'));

    // Act & Assert
    await expect(service.loadFundingSummary('cal123')).rejects.toThrow('Server error');
    expect(useFundingStore().summaryFor('cal123')).toBeNull();
  });
});

describe('fundingGateDenial', () => {
  it('should name the feature a 402 SubscriptionRequiredError refused', () => {
    const error = {
      response: {
        status: 402,
        data: {
          error: 'subscription_required',
          errorName: 'SubscriptionRequiredError',
          feature: 'widget_embedding',
        },
      },
    };

    expect(fundingGateDenial(error)).toBe('widget_embedding');
  });

  it('should not read a 5xx as a refusal', () => {
    // An unreadable instance funding state is indeterminate, never not covered.
    const error = { response: { status: 500, data: { error: 'Internal server error' } } };

    expect(fundingGateDenial(error)).toBeNull();
  });

  // The combinations the DEC-001 property is actually about. Testing "402 with
  // the wrong errorName" and "5xx with neither marker" separately leaves the
  // guard free to key off either half alone: a 500 that merely carries a
  // `feature` field, or one carrying the refusal marker, would then close a
  // gate. An operator whose instance never enabled funding must not be sold an
  // upsell because our database hiccuped mid-sentence.
  it.each([
    ['a 500 naming a feature', 500, { feature: 'widget_embedding' }],
    ['a 503 naming a feature', 503, { feature: 'widget_embedding' }],
    [
      'a 500 carrying the refusal marker and a feature',
      500,
      { error: 'subscription_required', errorName: 'SubscriptionRequiredError', feature: 'widget_embedding' },
    ],
    [
      'a 503 carrying the refusal marker and a feature',
      503,
      { error: 'subscription_required', errorName: 'SubscriptionRequiredError', feature: 'widget_embedding' },
    ],
  ])('should not read %s as a refusal', (_label, status, data) => {
    expect(fundingGateDenial({ response: { status, data } })).toBeNull();
  });

  it('should not read a 402 without the funding errorName as a refusal', () => {
    const error = { response: { status: 402, data: { errorName: 'SomeOtherError', feature: 'widget_embedding' } } };

    expect(fundingGateDenial(error)).toBeNull();
  });

  it('should not read a refusal naming an unregistered feature', () => {
    const error = {
      response: { status: 402, data: { errorName: 'SubscriptionRequiredError', feature: 'not_a_registered_feature' } },
    };

    expect(fundingGateDenial(error)).toBeNull();
  });

  it('should not read a refusal from an error with no response at all', () => {
    expect(fundingGateDenial(new Error('Network Error'))).toBeNull();
    expect(fundingGateDenial(null)).toBeNull();
    expect(fundingGateDenial(undefined)).toBeNull();
  });

  // Membership in the registry has to mean an own key, not anything the
  // prototype chain answers to. Every name below is `in FUNDING_GATED_FEATURES`
  // and none of them is a funding-gated feature; letting one through would put
  // it in the store as a feature key, where a Vue template interpolating the
  // features map throws on it.
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'should not read a refusal naming the inherited property %s',
    (feature) => {
      const error = {
        response: { status: 402, data: { errorName: 'SubscriptionRequiredError', feature } },
      };

      expect(fundingGateDenial(error)).toBeNull();
    },
  );

  // `in` coerces its left operand, so a non-string that stringifies to a
  // registered key passes the membership test and is handed back unchanged —
  // the declared FundingGatedFeature return type would be a runtime lie.
  it.each([
    ['an array', ['widget_embedding']],
    ['an object with a matching toString', { toString: () => 'widget_embedding' }],
    ['a number', 0],
    ['a boolean', true],
  ])('should not read a refusal whose feature is %s rather than a string', (_label, feature) => {
    const error = {
      response: { status: 402, data: { errorName: 'SubscriptionRequiredError', feature } },
    };

    expect(fundingGateDenial(error)).toBeNull();
  });
});

describe('FundingService.createCheckoutSession', () => {
  const service = new FundingService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call POST /api/funding/v1/checkout-sessions with params', async () => {
    // Arrange
    const params = {
      billingCycle: 'monthly',
      returnUrl: 'http://localhost/funding',
    };
    const responseData = { clientSecret: 'cs_secret_123', sessionId: 'cs_session_123' };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ data: responseData });

    // Act
    const result = await service.createCheckoutSession(params);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/funding/v1/checkout-sessions', params);
    expect(result.clientSecret).toBe('cs_secret_123');
    expect(result.sessionId).toBe('cs_session_123');
  });

  it('should include amount and calendarIds when provided', async () => {
    // Arrange
    const params = {
      billingCycle: 'yearly',
      returnUrl: 'http://localhost/funding',
      amount: 2000000,
      calendarIds: ['cal1', 'cal2'],
    };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ data: { clientSecret: 'cs_secret', sessionId: 'cs_session' } });

    // Act
    await service.createCheckoutSession(params);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/funding/v1/checkout-sessions', params);
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockRejectedValue(new Error('Session creation failed'));

    // Act & Assert
    await expect(service.createCheckoutSession({
      billingCycle: 'monthly',
      returnUrl: 'http://localhost',
    })).rejects.toThrow('Session creation failed');
  });
});

describe('FundingService.getCheckoutSessionStatus', () => {
  const service = new FundingService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call GET /api/funding/v1/checkout-sessions/:sessionId/status', async () => {
    // Arrange
    const sessionId = 'cs_session_123';
    const responseData = { status: 'complete', customer_email: 'test@example.com' };
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: responseData });

    // Act
    const result = await service.getCheckoutSessionStatus(sessionId);

    // Assert
    expect(axiosGet).toHaveBeenCalledWith(`/api/funding/v1/checkout-sessions/${sessionId}/status`);
    expect(result.status).toBe('complete');
    expect(result.customer_email).toBe('test@example.com');
  });

  it('should return open status for pending sessions', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: { status: 'open' } });

    // Act
    const result = await service.getCheckoutSessionStatus('cs_session_456');

    // Assert
    expect(result.status).toBe('open');
    expect(result.customer_email).toBeUndefined();
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockRejectedValue(new Error('Not found'));

    // Act & Assert
    await expect(service.getCheckoutSessionStatus('invalid_session')).rejects.toThrow('Not found');
  });
});

describe('FundingService.configureStripe', () => {
  const service = new FundingService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return success and connectionVerified when API returns both', async () => {
    // Arrange
    const credentials = { publishable_key: 'pk_test_123', secret_key: 'sk_test_123', webhook_secret: 'whsec_123' };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ status: 200, data: { success: true, connectionVerified: true } });

    // Act
    const result = await service.configureStripe(credentials);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/funding/v1/admin/providers/stripe/configure', credentials);
    expect(result).toEqual({ success: true, connectionVerified: true });
  });

  it('should return connectionVerified false when API reports unverified connection', async () => {
    // Arrange
    const credentials = { publishable_key: 'pk_test_123', secret_key: 'sk_test_bad', webhook_secret: 'whsec_123' };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ status: 200, data: { success: true, connectionVerified: false } });

    // Act
    const result = await service.configureStripe(credentials);

    // Assert
    expect(result).toEqual({ success: true, connectionVerified: false });
  });

  it('should default connectionVerified to false when field is missing from response', async () => {
    // Arrange
    const credentials = { publishable_key: 'pk_test_123', secret_key: 'sk_test_123', webhook_secret: 'whsec_123' };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ status: 200, data: { success: true } });

    // Act
    const result = await service.configureStripe(credentials);

    // Assert
    expect(result).toEqual({ success: true, connectionVerified: false });
  });

  it('should return success false for non-200 status', async () => {
    // Arrange
    const credentials = { publishable_key: 'pk_test_123', secret_key: 'sk_test_123', webhook_secret: 'whsec_123' };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ status: 201, data: {} });

    // Act
    const result = await service.configureStripe(credentials);

    // Assert
    expect(result.success).toBe(false);
    expect(result.connectionVerified).toBe(false);
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const credentials = { publishable_key: 'pk_test_123', secret_key: 'sk_test_123', webhook_secret: 'whsec_123' };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockRejectedValue(new Error('Network error'));

    // Act & Assert
    await expect(service.configureStripe(credentials)).rejects.toThrow('Network error');
  });
});
