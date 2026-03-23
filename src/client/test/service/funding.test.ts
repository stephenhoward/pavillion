import { describe, it, expect, afterEach, vi } from 'vitest';
import axios from 'axios';
import FundingService from '@/client/service/funding';
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
    const mockStatus = { status: 'funded', subscriptionInfo: { amount: 500 } };
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: mockStatus });

    // Act
    const result = await service.getFundingStatus('cal123');

    // Assert
    expect(axiosGet).toHaveBeenCalledWith('/api/funding/v1/calendars/cal123/funding');
    expect(result).toEqual(mockStatus);
  });

  it('should return unfunded status', async () => {
    // Arrange
    const mockStatus = { status: 'unfunded' };
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: mockStatus });

    // Act
    const result = await service.getFundingStatus('cal456');

    // Assert
    expect(result.status).toBe('unfunded');
  });

  it('should return grant status with grantInfo', async () => {
    // Arrange
    const mockStatus = { status: 'grant', grantInfo: { reason: 'VIP', grantedBy: 'admin1' } };
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: mockStatus });

    // Act
    const result = await service.getFundingStatus('cal789');

    // Assert
    expect(result.status).toBe('grant');
    expect(result.grantInfo).toEqual({ reason: 'VIP', grantedBy: 'admin1' });
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockRejectedValue(new Error('Server error'));

    // Act & Assert
    await expect(service.getFundingStatus('cal123')).rejects.toThrow('Server error');
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
