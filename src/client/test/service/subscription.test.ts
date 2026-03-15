import { describe, it, expect, afterEach, vi } from 'vitest';
import axios from 'axios';
import SubscriptionService from '@/client/service/subscription';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';

vi.mock('axios');

describe('SubscriptionService.listGrants', () => {
  const service = new SubscriptionService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call GET /api/subscription/v1/admin/grants without includeRevoked parameter by default', async () => {
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
    expect(axiosGet).toHaveBeenCalledWith('/api/subscription/v1/admin/grants', { params: { includeRevoked: false } });
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
    expect(axiosGet).toHaveBeenCalledWith('/api/subscription/v1/admin/grants', { params: { includeRevoked: true } });
  });

  it('should call GET with includeRevoked=false when explicitly passed false', async () => {
    // Arrange
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: [] });

    // Act
    await service.listGrants(false);

    // Assert
    expect(axiosGet).toHaveBeenCalledWith('/api/subscription/v1/admin/grants', { params: { includeRevoked: false } });
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

describe('SubscriptionService.createGrant', () => {
  const service = new SubscriptionService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call POST /api/subscription/v1/admin/grants with accountId', async () => {
    // Arrange
    const accountId = 'acc123';
    const grantData = { id: 'grant1', accountId, reason: null, grantedBy: 'admin1', expiresAt: null, revokedAt: null, revokedBy: null };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ data: grantData });

    // Act
    const result = await service.createGrant(accountId);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/subscription/v1/admin/grants', {
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
    expect(axiosPost).toHaveBeenCalledWith('/api/subscription/v1/admin/grants', {
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
    expect(axiosPost).toHaveBeenCalledWith('/api/subscription/v1/admin/grants', {
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

describe('SubscriptionService.revokeGrant', () => {
  const service = new SubscriptionService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call DELETE /api/subscription/v1/admin/grants/{grantId}', async () => {
    // Arrange
    const grantId = 'grant123';
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockResolvedValue({ status: 204 });

    // Act
    await service.revokeGrant(grantId);

    // Assert
    expect(axiosDelete).toHaveBeenCalledWith(`/api/subscription/v1/admin/grants/${grantId}`);
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

describe('SubscriptionService.addCalendarToSubscription', () => {
  const service = new SubscriptionService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call POST /api/subscription/v1/calendars with calendarId and amount', async () => {
    // Arrange
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ status: 200 });

    // Act
    await service.addCalendarToSubscription('cal123', 500);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/subscription/v1/calendars', {
      calendarId: 'cal123',
      amount: 500,
    });
  });

  it('should return void on success', async () => {
    // Arrange
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ status: 200 });

    // Act
    const result = await service.addCalendarToSubscription('cal123', 1000);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockRejectedValue(new Error('Failed'));

    // Act & Assert
    await expect(service.addCalendarToSubscription('cal123', 500)).rejects.toThrow('Failed');
  });
});

describe('SubscriptionService.removeCalendarFromSubscription', () => {
  const service = new SubscriptionService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call DELETE /api/subscription/v1/calendars/:calendarId', async () => {
    // Arrange
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockResolvedValue({ status: 204 });

    // Act
    await service.removeCalendarFromSubscription('cal123');

    // Assert
    expect(axiosDelete).toHaveBeenCalledWith('/api/subscription/v1/calendars/cal123');
  });

  it('should return void on success', async () => {
    // Arrange
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockResolvedValue({ status: 204 });

    // Act
    const result = await service.removeCalendarFromSubscription('cal123');

    // Assert
    expect(result).toBeUndefined();
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockRejectedValue(new Error('Not found'));

    // Act & Assert
    await expect(service.removeCalendarFromSubscription('cal123')).rejects.toThrow('Not found');
  });
});

describe('SubscriptionService.getFundingStatus', () => {
  const service = new SubscriptionService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call GET /api/subscription/v1/calendars/:calendarId/funding', async () => {
    // Arrange
    const mockStatus = { status: 'funded', subscriptionInfo: { amount: 500 } };
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: mockStatus });

    // Act
    const result = await service.getFundingStatus('cal123');

    // Assert
    expect(axiosGet).toHaveBeenCalledWith('/api/subscription/v1/calendars/cal123/funding');
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

describe('SubscriptionService.subscribe', () => {
  const service = new SubscriptionService();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call POST /api/subscription/v1/subscribe without calendarIds by default', async () => {
    // Arrange
    const params = { provider_type: 'stripe' as const, billing_cycle: 'monthly' as const };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ data: { redirectUrl: 'https://stripe.com/pay' } });

    // Act
    await service.subscribe(params);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/subscription/v1/subscribe', params);
  });

  it('should include calendarIds when provided', async () => {
    // Arrange
    const params = { provider_type: 'stripe' as const, billing_cycle: 'monthly' as const };
    const calendarIds = ['cal1', 'cal2', 'cal3'];
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ data: { redirectUrl: 'https://stripe.com/pay' } });

    // Act
    await service.subscribe(params, calendarIds);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith('/api/subscription/v1/subscribe', {
      ...params,
      calendarIds,
    });
  });

  it('should return response data', async () => {
    // Arrange
    const params = { provider_type: 'stripe' as const, billing_cycle: 'monthly' as const };
    const responseData = { redirectUrl: 'https://stripe.com/pay' };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ data: responseData });

    // Act
    const result = await service.subscribe(params);

    // Assert
    expect(result).toEqual(responseData);
  });

  it('should throw error when API call fails', async () => {
    // Arrange
    const params = { provider_type: 'stripe' as const, billing_cycle: 'monthly' as const };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockRejectedValue(new Error('Payment error'));

    // Act & Assert
    await expect(service.subscribe(params)).rejects.toThrow('Payment error');
  });
});
