import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import Config from '@/client/service/config';

describe('Config Service', () => {
  const sandbox = sinon.createSandbox();
  const mockSettings = {
    registrationMode: 'invite',
  };

  beforeEach(() => {
    // Reset the static _settings property
    (Config as any)._settings = undefined;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('init', () => {
    it('should load settings when initialized for the first time', async () => {
      // Arrange
      const loadStub = sandbox.stub(Config, '_load_settings').resolves();

      // Act
      await Config.init();

      // Assert
      expect(loadStub.called).toBe(true);
    });

    it('should not reload settings if already loaded', async () => {
      // Arrange
      const getStub = sandbox.stub(axios, 'get').resolves({ data: mockSettings });

      // First init to load settings
      await Config.init();

      // Act
      await Config.init();

      // Assert
      expect(getStub.calledOnce).toBe(true);
    });

    it('should handle errors when loading settings', async () => {
      // Arrange
      sandbox.stub(axios, 'get').rejects(new Error('Network Error'));

      // Act & Assert
      await expect(Config.init()).rejects.toThrow('Network Error');
    });
  });

  describe('reload', () => {
    it('should reload settings from the server', async () => {
      // Arrange
      const getStub = sandbox.stub(axios, 'get');
      getStub.onFirstCall().resolves({ data: mockSettings });

      const config = await Config.init();

      const updatedSettings = {
        registrationMode: 'open',
      };
      getStub.onSecondCall().resolves({ data: updatedSettings });

      // Act
      await config.reload();

      // Assert
      expect(getStub.calledTwice).toBe(true);
      expect(config.settings()).toEqual(updatedSettings);
    });

    it('should handle errors when reloading settings', async () => {
      // Arrange
      const getStub = sandbox.stub(axios, 'get');
      getStub.onFirstCall().resolves({ data: mockSettings });
      const config = await Config.init();

      getStub.onSecondCall().rejects(new Error('Network Error'));

      // Act & Assert
      await expect(config.reload()).rejects.toThrow('Network Error');
      // Original settings should still be available
      expect(config.settings()).toEqual(mockSettings);
    });
  });

  describe('settings', () => {
    it('should return the current settings', async () => {
      // Arrange
      const getStub = sandbox.stub(axios, 'get').resolves({ data: mockSettings });
      const config = await Config.init();

      // Act
      const settings = config.settings();

      // Assert
      expect(settings).toEqual(mockSettings);
      expect(getStub.calledOnce).toBe(true);
    });
  });

  describe('updateSettings', () => {
    const sandbox = sinon.createSandbox();
    const mockSettings = {
      registrationMode: 'invite',
    };

    beforeEach(() => {
    // Reset the static _settings property
      (Config as any)._settings = undefined;
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should update settings successfully', async () => {
      // Arrange
      const newSettings = {
        registrationMode: 'open',
      };
      const getStub = sandbox.stub(axios, 'get').resolves({ data: mockSettings });
      const postStub = sandbox.stub(axios, 'post').resolves({ status: 200 });
      const config = await Config.init();

      getStub.resolves({ data: newSettings });

      // Act
      const result = await config.updateSettings(newSettings);

      // Assert
      expect(postStub.called).toBe(true);
      expect(getStub.calledTwice).toBe(true);
      expect(result).toBe(true);
      expect(config.settings()).toEqual(newSettings);
    });

    it('should return false when update fails with non-200 status', async () => {
      // Arrange
      const getStub = sandbox.stub(axios, 'get').resolves({ data: mockSettings });
      const config = await Config.init();

      const newSettings = {
        registrationMode: 'open',
      };

      const postStub = sandbox.stub(axios, 'post').resolves({ status: 400 });

      // Act
      const result = await config.updateSettings(newSettings);

      // Assert
      expect(postStub.called).toBe(true);
      expect(result).toBe(false);
      // Settings should not have been reloaded
      expect(getStub.calledOnce).toBe(true);
    });

    it('should return false and log error when update throws an exception', async () => {
      // Arrange
      sandbox.stub(axios, 'get').resolves({ data: mockSettings });
      const postStub = sandbox.stub(axios, 'post').rejects(new Error('Network Error'));
      const config = await Config.init();

      const newSettings = {
        registrationMode: 'open',
      };

      // Act
      const result = await config.updateSettings(newSettings);

      // Assert
      expect(postStub.called).toBe(true);
      expect(result).toBe(false);
    });
  });
});
