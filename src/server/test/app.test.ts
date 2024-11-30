import main from '../app';
import { describe, it, expect } from 'vitest';
import { countRoutes } from '../common/test/lib/express';

describe('Main App', () => {
    it('should start', () => {
        let app = main();

        expect(app).toBeDefined();
        expect(countRoutes(app)).toBeGreaterThan(0);
    });
});
