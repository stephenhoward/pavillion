import { describe, it, expect, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import SetupService from '@/client/service/setup';

vi.mock('axios');

const REQUEST = {
  email: 'admin@example.com',
  password: 'password123',
  siteTitle: 'My Calendar',
  registrationMode: 'closed',
  defaultLanguage: 'en',
  setupToken: '0123456789abcdef0123456789abcdef',
};

function rejectWith(status: number, data: Record<string, unknown>) {
  sandbox.stub(axios, 'isAxiosError').returns(true);
  sandbox.stub(axios, 'post').rejects({ response: { status, data } });
}

const sandbox = sinon.createSandbox();

describe('SetupService.completeSetup', () => {
  afterEach(() => {
    sandbox.restore();
  });

  it('posts the setup token with the rest of the form', async () => {
    const post = sandbox.stub(axios, 'post').resolves({ data: { success: true } });

    await new SetupService().completeSetup(REQUEST);

    expect(post.calledOnceWith('/api/v1/setup', REQUEST)).toBe(true);
  });

  it('reports a rejected setup token as setup_token_invalid', async () => {
    rejectWith(403, { error: 'Invalid setup token', errorName: 'SetupTokenInvalidError' });

    await expect(new SetupService().completeSetup(REQUEST)).rejects.toThrow('setup_token_invalid');
  });

  it('still reports a completed setup as setup_already_completed', async () => {
    rejectWith(404, { error: 'Setup already completed', errorName: 'NotFoundError' });

    await expect(new SetupService().completeSetup(REQUEST)).rejects.toThrow('setup_already_completed');
  });
});
