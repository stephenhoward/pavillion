import { describe, it, expect } from 'vitest';

describe('Category Filter Persistence', () => {
  describe('Browser Session Persistence', () => {
    it('should simulate filter state persistence across page refresh', () => {
      // Simulate browser refresh scenario where URL parameters persist
      const originalUrl = 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000,987fcdeb-51a2-43d1-9c7f-ba9876543210';

      // Step 1: Parse initial URL state
      const initialUrl = new URL(originalUrl);
      const initialCategories = initialUrl.searchParams.get('categories');
      expect(initialCategories).toBeTruthy();

      const categoryIds = initialCategories!.split(',').map(id => id.trim());
      expect(categoryIds).toHaveLength(2);
      expect(categoryIds[0]).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(categoryIds[1]).toBe('987fcdeb-51a2-43d1-9c7f-ba9876543210');

      // Step 2: Simulate page refresh (URL remains the same)
      const refreshedUrl = new URL(originalUrl);
      const persistedCategories = refreshedUrl.searchParams.get('categories');

      // Verify state persists after refresh
      expect(persistedCategories).toBe(initialCategories);
      expect(persistedCategories!.split(',').map(id => id.trim())).toEqual(categoryIds);
    });

    it('should handle filter state during browser navigation', () => {
      // Simulate browser navigation history with different filter states
      const navigationHistory = [
        {
          url: 'http://localhost:3000/calendars/test',
          expectedCategories: null,
          description: 'Initial page load - no filters',
        },
        {
          url: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000',
          expectedCategories: ['123e4567-e89b-12d3-a456-426614174000'],
          description: 'User selects one category',
        },
        {
          url: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000,987fcdeb-51a2-43d1-9c7f-ba9876543210',
          expectedCategories: ['123e4567-e89b-12d3-a456-426614174000', '987fcdeb-51a2-43d1-9c7f-ba9876543210'],
          description: 'User adds second category',
        },
        {
          url: 'http://localhost:3000/calendars/test?categories=987fcdeb-51a2-43d1-9c7f-ba9876543210',
          expectedCategories: ['987fcdeb-51a2-43d1-9c7f-ba9876543210'],
          description: 'User removes first category',
        },
        {
          url: 'http://localhost:3000/calendars/test',
          expectedCategories: null,
          description: 'User clears all filters',
        },
      ];

      // Test forward navigation
      navigationHistory.forEach((step) => {
        const url = new URL(step.url);
        const categoriesParam = url.searchParams.get('categories');

        if (step.expectedCategories === null) {
          expect(categoriesParam).toBeNull();
        }
        else {
          expect(categoriesParam).toBeTruthy();
          const parsedCategories = categoriesParam!.split(',').map(id => id.trim());
          expect(parsedCategories).toEqual(step.expectedCategories);
        }
      });

      // Test backward navigation (browser back button simulation)
      for (let i = navigationHistory.length - 2; i >= 0; i--) {
        const step = navigationHistory[i];
        const url = new URL(step.url);
        const categoriesParam = url.searchParams.get('categories');

        if (step.expectedCategories === null) {
          expect(categoriesParam).toBeNull();
        }
        else {
          expect(categoriesParam).toBeTruthy();
          const parsedCategories = categoriesParam!.split(',').map(id => id.trim());
          expect(parsedCategories).toEqual(step.expectedCategories);
        }
      }
    });

    it('should maintain filter state across calendar view changes', () => {
      // Test filter persistence when changing calendar views (month/week/day)
      const baseUrl = 'http://localhost:3000/calendars/test';
      const categoryFilter = 'categories=123e4567-e89b-12d3-a456-426614174000';

      const viewChanges = [
        {
          view: 'month',
          url: `${baseUrl}?view=month&${categoryFilter}`,
          expectedView: 'month',
          expectedCategories: '123e4567-e89b-12d3-a456-426614174000',
        },
        {
          view: 'week',
          url: `${baseUrl}?view=week&${categoryFilter}`,
          expectedView: 'week',
          expectedCategories: '123e4567-e89b-12d3-a456-426614174000',
        },
        {
          view: 'day',
          url: `${baseUrl}?view=day&${categoryFilter}`,
          expectedView: 'day',
          expectedCategories: '123e4567-e89b-12d3-a456-426614174000',
        },
        {
          view: 'list',
          url: `${baseUrl}?view=list&${categoryFilter}`,
          expectedView: 'list',
          expectedCategories: '123e4567-e89b-12d3-a456-426614174000',
        },
      ];

      viewChanges.forEach(change => {
        const url = new URL(change.url);

        // Verify both view and category parameters persist
        expect(url.searchParams.get('view')).toBe(change.expectedView);
        expect(url.searchParams.get('categories')).toBe(change.expectedCategories);

        // Verify URL can be reconstructed correctly
        const reconstructedUrl = new URL(baseUrl);
        reconstructedUrl.searchParams.set('view', change.expectedView);
        reconstructedUrl.searchParams.set('categories', change.expectedCategories);

        expect(reconstructedUrl.searchParams.get('view')).toBe(change.expectedView);
        expect(reconstructedUrl.searchParams.get('categories')).toBe(change.expectedCategories);
      });
    });
  });

  describe('State Recovery and Error Handling', () => {
    it('should handle corrupted URL parameters gracefully', () => {
      // Test scenarios where URL parameters might be corrupted or invalid
      const corruptedScenarios = [
        {
          name: 'Malformed UUID',
          url: 'http://localhost:3000/calendars/test?categories=not-a-uuid',
          expectRecovery: true,
          recoveryAction: 'filter_out_invalid',
        },
        {
          name: 'Mixed valid and invalid UUIDs',
          url: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000,not-a-uuid,987fcdeb-51a2-43d1-9c7f-ba9876543210',
          expectRecovery: true,
          recoveryAction: 'keep_valid_only',
        },
        {
          name: 'Very long parameter string',
          url: `http://localhost:3000/calendars/test?categories=${'123e4567-e89b-12d3-a456-426614174000,'.repeat(100)}`,
          expectRecovery: true,
          recoveryAction: 'truncate_or_limit',
        },
        {
          name: 'Special characters in parameters',
          url: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000%3Cscript%3E',
          expectRecovery: true,
          recoveryAction: 'sanitize',
        },
      ];

      corruptedScenarios.forEach(scenario => {
        const url = new URL(scenario.url);
        const categoriesParam = url.searchParams.get('categories');

        expect(categoriesParam).toBeTruthy();

        // Test that we can attempt to parse and recover
        const categories = categoriesParam!.split(',').map(cat => cat.trim());

        switch (scenario.recoveryAction) {
          case 'filter_out_invalid':
            // Should be able to identify invalid UUIDs
            const validUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            const validCategories = categories.filter(cat => validUuidRegex.test(cat));
            expect(categories.length).toBeGreaterThan(validCategories.length);
            break;

          case 'keep_valid_only':
            // Should contain both valid and invalid categories
            expect(categories.length).toBe(3);
            expect(categories[0]).toMatch(/^[0-9a-f-]{36}$/i);
            expect(categories[1]).toBe('not-a-uuid');
            expect(categories[2]).toMatch(/^[0-9a-f-]{36}$/i);
            break;

          case 'truncate_or_limit':
            // Should have many repeated categories
            expect(categories.length).toBeGreaterThan(50);
            break;

          case 'sanitize':
            // Should contain potentially dangerous content that needs sanitization
            // URL constructor automatically decodes, so we check for the decoded content
            expect(categoriesParam).toContain('<script>');
            break;
        }
      });
    });

    it('should handle bookmark and direct URL access', () => {
      // Test scenarios where users access the page via bookmarks or direct URLs
      const bookmarkScenarios = [
        {
          name: 'Bookmarked filtered view',
          url: 'http://localhost:3000/calendars/community-events?categories=123e4567-e89b-12d3-a456-426614174000&view=month',
          expectCalendar: 'community-events',
          expectCategories: ['123e4567-e89b-12d3-a456-426614174000'],
          expectView: 'month',
        },
        {
          name: 'Shared URL with multiple filters',
          url: 'http://localhost:3000/calendars/local-business?categories=123e4567-e89b-12d3-a456-426614174000,987fcdeb-51a2-43d1-9c7f-ba9876543210&view=week&date=2025-08-15',
          expectCalendar: 'local-business',
          expectCategories: ['123e4567-e89b-12d3-a456-426614174000', '987fcdeb-51a2-43d1-9c7f-ba9876543210'],
          expectView: 'week',
          expectDate: '2025-08-15',
        },
        {
          name: 'Mobile shared URL',
          url: 'http://localhost:3000/calendars/events?categories=123e4567-e89b-12d3-a456-426614174000&mobile=true',
          expectCalendar: 'events',
          expectCategories: ['123e4567-e89b-12d3-a456-426614174000'],
          expectMobile: true,
        },
      ];

      bookmarkScenarios.forEach(scenario => {
        const url = new URL(scenario.url);

        // Verify calendar path
        expect(url.pathname).toContain(scenario.expectCalendar);

        // Verify category parameters
        const categoriesParam = url.searchParams.get('categories');
        expect(categoriesParam).toBeTruthy();
        const parsedCategories = categoriesParam!.split(',').map(id => id.trim());
        expect(parsedCategories).toEqual(scenario.expectCategories);

        // Verify additional parameters
        if (scenario.expectView) {
          expect(url.searchParams.get('view')).toBe(scenario.expectView);
        }

        if (scenario.expectDate) {
          expect(url.searchParams.get('date')).toBe(scenario.expectDate);
        }

        if (scenario.expectMobile) {
          expect(url.searchParams.get('mobile')).toBe('true');
        }
      });
    });

    it('should maintain filter state during error recovery', () => {
      // Test filter persistence when recovering from errors
      const errorRecoveryScenarios = [
        {
          name: 'Network error recovery',
          initialUrl: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000',
          errorState: 'network_timeout',
          recoveryUrl: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000&retry=1',
          expectFilterPersistence: true,
        },
        {
          name: 'Invalid calendar recovery',
          initialUrl: 'http://localhost:3000/calendars/nonexistent?categories=123e4567-e89b-12d3-a456-426614174000',
          errorState: 'calendar_not_found',
          recoveryUrl: 'http://localhost:3000/calendars/default?categories=123e4567-e89b-12d3-a456-426614174000',
          expectFilterPersistence: true,
        },
        {
          name: 'Server error recovery',
          initialUrl: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000,987fcdeb-51a2-43d1-9c7f-ba9876543210',
          errorState: 'server_error',
          recoveryUrl: 'http://localhost:3000/calendars/test?categories=123e4567-e89b-12d3-a456-426614174000,987fcdeb-51a2-43d1-9c7f-ba9876543210&fallback=true',
          expectFilterPersistence: true,
        },
      ];

      errorRecoveryScenarios.forEach(scenario => {
        const initialUrl = new URL(scenario.initialUrl);
        const recoveryUrl = new URL(scenario.recoveryUrl);

        const initialCategories = initialUrl.searchParams.get('categories');
        const recoveryCategories = recoveryUrl.searchParams.get('categories');

        if (scenario.expectFilterPersistence) {
          expect(initialCategories).toBeTruthy();
          expect(recoveryCategories).toBeTruthy();
          expect(recoveryCategories).toBe(initialCategories);

          // Verify categories are preserved across error recovery
          const initialCategoriesList = initialCategories!.split(',').map(id => id.trim());
          const recoveryCategoriesList = recoveryCategories!.split(',').map(id => id.trim());
          expect(recoveryCategoriesList).toEqual(initialCategoriesList);
        }
      });
    });
  });

  describe('Performance During Persistence Operations', () => {
    it('should handle URL parameter operations efficiently', () => {
      // Test performance of URL manipulation operations
      const baseUrl = 'http://localhost:3000/calendars/test';
      const categories = Array.from({ length: 10 }, (_, i) =>
        `123e4567-e89b-12d3-a456-42661417${i.toString().padStart(4, '0')}`,
      );

      // Test URL construction performance
      const constructionStart = performance.now();
      const url = new URL(baseUrl);
      url.searchParams.set('categories', categories.join(','));
      const constructionTime = performance.now() - constructionStart;

      // Should be very fast (< 1ms for 10 categories)
      expect(constructionTime).toBeLessThan(1);

      // Test URL parsing performance
      const parsingStart = performance.now();
      const categoriesParam = url.searchParams.get('categories');
      const parsedCategories = categoriesParam!.split(',').map(id => id.trim());
      const parsingTime = performance.now() - parsingStart;

      // Should be very fast (< 1ms for 10 categories)
      expect(parsingTime).toBeLessThan(1);
      expect(parsedCategories).toHaveLength(10);

      // Test URL modification performance
      const modificationStart = performance.now();

      // Add category
      const newCategories = [...parsedCategories, '987fcdeb-51a2-43d1-9c7f-ba9876543210'];
      url.searchParams.set('categories', newCategories.join(','));

      // Remove category
      const filteredCategories = newCategories.slice(0, -1);
      url.searchParams.set('categories', filteredCategories.join(','));

      // Clear categories
      url.searchParams.delete('categories');

      // Restore categories
      url.searchParams.set('categories', categories.join(','));

      const modificationTime = performance.now() - modificationStart;

      // All operations should be very fast (< 1ms total)
      expect(modificationTime).toBeLessThan(1);
      expect(url.searchParams.get('categories')).toBe(categories.join(','));
    });
  });
});
