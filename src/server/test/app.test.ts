import main from '../app';
import { describe, it, expect } from 'vitest';
import { countRoutes } from '../common/test/lib/express';
import sinon from 'sinon';
import express from 'express';

describe('Main App', () => {
    it('should start', () => {
        let app = express();
        let listenStub = sinon.stub(app, 'listen');
        main(app);

        expect(countRoutes(app)).toBeGreaterThan(0);
        expect(listenStub.called).toBe(true);
    });
});
